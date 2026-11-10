import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ChecklistLedger,
  runWithStopGuard,
  StopGuard,
  workspaceLedgerResolver,
  type ChecklistItemInput,
} from '@harness-x/checklist-ledger';
import {
  EventLog,
  HookBus,
  PluginLoader,
  recoverSession,
  registerRecoveryRoutes,
  startApiServer,
  toEngineRun,
  type ResumePlan,
} from '@harness-x/kernel';
import type { EngineAdapter, EngineRunOptions, HarnessEvent } from '@harness-x/protocol';
import { describe, expect, it } from 'vitest';

/** T-061 61.2 상태 재구성 · 61.3 "이어서 하기" → 다음 미완료 항목부터 재개 (E2E, 가짜 엔진) */
const item = (id: string, extra: Partial<ChecklistItemInput> = {}): ChecklistItemInput => ({
  id,
  title: `항목 ${id} 구현`,
  artifactId: `art.item-${id}`,
  acceptance: [{ type: 'test', run: `pnpm test item-${id}` }],
  ...extra,
});

let n = 0;
const ev = (sessionId: string, body: Record<string, unknown>): HarnessEvent =>
  ({
    id: `ev-${++n}`,
    ts: new Date(Date.UTC(2026, 10, 11, 0, 0, 0, n)).toISOString(),
    sessionId,
    engineId: 'claude-code',
    ...body,
  }) as HarnessEvent;

const finish = (l: ChecklistLedger, id: string) => {
  l.transition(id, 'doing');
  l.transition(id, 'verifying');
  l.transition(id, 'done');
};

/** 크래시 직전 상태: 항목 1 완료, 항목 2 진행 중 도구 호출에서 끊김 */
function crashedSession(dir: string) {
  const ws = join(dir, 'ws');
  const log = new EventLog({ root: join(dir, 'logs') });
  const ledger = new ChecklistLedger({
    dir: join(ws, '.harness-x', 'sessions', 's9'),
    sessionId: 's9',
    log,
    engineId: 'claude-code',
  });
  ledger.create([item('1'), item('2', { deps: ['1'] }), item('3'), item('4')]);
  log.append(ev('s9', { type: 'assistant_text', text: '항목 1', itemId: '1' }));
  finish(ledger, '1');
  log.append(ev('s9', { type: 'file_change', path: 'src/one.ts', change: 'create', itemId: '1' }));
  log.append(ev('s9', { type: 'usage', inputTokens: 100, outputTokens: 20 }));
  log.append(ev('s9', { type: 'turn_end', reason: 'completed' }));
  // 2턴: 항목 2 시작 → 파일 변경 → 도구 호출 중 크래시
  ledger.transition('2', 'doing');
  ledger.transition('4', 'blocked');
  ledger.revise([item('1'), item('2', { deps: ['1'] }), item('4'), item('5')]); // 3 제거, 5 추가
  log.append(ev('s9', { type: 'file_change', path: 'src/two.ts', change: 'modify', itemId: '2' }));
  log.append(ev('s9', { type: 'usage', inputTokens: 50, outputTokens: 5 }));
  log.append(ev('s9', { type: 'tool_call', callId: 't1', tool: 'Bash', input: {}, itemId: '2' }));
  log.flush();
  return { ws, log, ledger };
}

describe('61.2 이벤트 로그 + 원장으로 세션 상태 재구성', () => {
  it('재구성 결과가 원장·기록과 일치', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hx-recover2-'));
    const { log, ledger } = crashedSession(dir);
    try {
      log.close();
      const fresh = new EventLog({ root: join(dir, 'logs') }); // 재시작
      const s = recoverSession(fresh, 's9', ledger);
      fresh.close();
      expect(s).toMatchObject({
        sessionId: 's9',
        unfinished: true,
        engineId: 'claude-code',
        turns: 1,
        lastEvent: { type: 'tool_call' },
        lastItemId: '2',
        pendingToolCalls: [{ callId: 't1', tool: 'Bash' }],
        filesChanged: ['src/one.ts', 'src/two.ts'],
        usage: { inputTokens: 150, outputTokens: 25 },
        checklist: { total: 4, done: 1, remaining: 3, next: { id: '2', status: 'doing' } },
        consistent: true,
      });
      // checklist_change 재생 결과 == 원장 현재 상태 (제거된 3은 없음, 추가된 5는 todo)
      const statuses = Object.fromEntries(ledger.get().items.map((i) => [i.id, i.status]));
      expect(s.itemStatusFromEvents).toEqual(statuses);
      expect(statuses).toEqual({ '1': 'done', '2': 'doing', '4': 'blocked', '5': 'todo' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('61.3 "이어서 하기" 카드 → 다음 미완료 항목부터 재개 (E2E)', () => {
  it('GET /api/recovery 카드 → POST resume → 가짜 엔진이 항목 2부터 이어 받아 완료 → 미종료 목록 비움', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hx-recover3-'));
    const crashed = crashedSession(dir);
    crashed.log.close();
    // ── 하네스 재시작 ──
    const log = new EventLog({ root: join(dir, 'logs') });
    const ledgerFor = workspaceLedgerResolver(crashed.ws);
    const runs: EngineRunOptions[] = [];
    let ran: Promise<void> = Promise.resolve();
    const engine: EngineAdapter = {
      id: 'claude-code',
      displayName: 'fake',
      capabilities: { nativeStopHook: false, resume: true, mcp: false, interrupt: true },
      run: (o) => {
        runs.push(o);
        const l = ledgerFor('s9')!;
        const cur = l.currentItem();
        if (cur) {
          if (cur.status === 'todo') l.transition(cur.id, 'doing');
          l.transition(cur.id, 'verifying');
          l.transition(cur.id, 'done');
        }
        return toEngineRun(async function* () {
          yield ev('s9', { type: 'assistant_text', text: `${cur?.id} 완료`, itemId: cur?.id });
          yield ev('s9', { type: 'turn_end', reason: 'completed' });
        });
      },
    };
    const resume = (plan: ResumePlan) => {
      ran = (async () => {
        const l = ledgerFor(plan.sessionId)!;
        for await (const e of runWithStopGuard({
          engine,
          run: {
            sessionId: plan.sessionId,
            prompt: plan.prompt,
            cwd: crashed.ws,
            itemId: plan.itemId ?? undefined,
          },
          guard: new StopGuard(l),
        }))
          log.append(e);
      })();
    };
    const loader = new PluginLoader({ hooks: new HookBus(), log, roots: [], lockFile: join(dir, 'lock') });
    const server = await startApiServer({
      loader,
      log,
      port: 0,
      tokenFile: join(dir, 'token'),
      routes: (app) => registerRecoveryRoutes(app, { log, ledgerFor, resume }),
    });
    const auth = { authorization: `Bearer ${server.token}` };
    try {
      const cards = (await (await fetch(`${server.url}/api/recovery`, { headers: auth })).json()) as {
        sessions: unknown[];
      };
      expect(cards.sessions).toEqual([
        {
          sessionId: 's9',
          engineId: 'claude-code',
          lastEventAt: expect.any(String),
          remaining: 3,
          nextItemId: '2',
          nextItemTitle: '항목 2 구현',
        },
      ]);
      // 카드의 [이어서 하기]
      const res = await fetch(`${server.url}/api/recovery/s9/resume`, { method: 'POST', headers: auth });
      expect(res.status).toBe(202);
      const { plan } = (await res.json()) as { plan: ResumePlan };
      expect(plan).toMatchObject({ sessionId: 's9', itemId: '2', engineId: 'claude-code' });
      await ran;
      // 재개 첫 턴은 항목 2부터: 프롬프트·itemId
      expect(runs[0]!.itemId).toBe('2');
      expect(runs[0]!.prompt).toContain('다음 미완료 항목 2: 항목 2 구현');
      expect(runs[0]!.prompt).toContain('끊긴 도구 호출(결과 없음): Bash');
      // 이어서 5까지 자동 진행 (4는 blocked) → 2턴
      expect(runs).toHaveLength(2);
      expect(
        ledgerFor('s9')!
          .get()
          .items.map((i) => [i.id, i.status]),
      ).toEqual([
        ['1', 'done'],
        ['2', 'done'],
        ['4', 'blocked'],
        ['5', 'done'],
      ]);
      const after = (await (await fetch(`${server.url}/api/recovery`, { headers: auth })).json()) as {
        sessions: unknown[];
      };
      expect(after.sessions).toEqual([]);
      expect(
        (await fetch(`${server.url}/api/recovery/s9/resume`, { method: 'POST', headers: auth })).status,
      ).toBe(404);
    } finally {
      await server.close();
      log.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('실행기가 없으면 session_resume 기록을 남긴다 (러너가 /ws/events로 받는다)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hx-recover4-'));
    const crashed = crashedSession(dir);
    try {
      type Reply = { code(n: number): { send(b: unknown): unknown } };
      const routes: Record<string, (req: { params: unknown }, reply: Reply) => Promise<unknown>> = {};
      const app = {
        get: (p: string, h: (typeof routes)[string]) => (routes[`GET ${p}`] = h),
        post: (p: string, h: (typeof routes)[string]) => (routes[`POST ${p}`] = h),
      };
      registerRecoveryRoutes(app, { log: crashed.log, ledgerFor: workspaceLedgerResolver(crashed.ws) });
      let status = 0;
      const reply = { code: (c: number) => ((status = c), { send: (b: unknown) => b }) };
      await routes['POST /api/recovery/:session/resume']!({ params: { session: 's9' } }, reply);
      expect(status).toBe(202);
      const rec = crashed.log.query({ sessionId: 's9', type: 'session_resume' });
      expect(rec).toHaveLength(1);
      expect(rec[0]).toMatchObject({ itemId: '2', engineId: 'claude-code' });
      expect(String(rec[0]!.prompt)).toContain('다음 미완료 항목 2');
    } finally {
      crashed.log.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
