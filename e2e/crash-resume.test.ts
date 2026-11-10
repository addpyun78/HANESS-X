import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ChecklistLedger } from '@harness-x/checklist-ledger';
import {
  EventLog,
  HookBus,
  PluginLoader,
  findUnfinishedSessions,
  recoverSession,
  registerRecoveryRoutes,
  resumePlan,
  runAgentLoop,
  startApiServer,
  type ResumePlan,
} from '@harness-x/kernel';
import { describe, expect, it } from 'vitest';
import { callTool, fixture, repoPath, reply, scriptedModel, tempDir } from './helpers.js';

/**
 * T-064 64.4 크래시 후 재개 (E2E)
 * 자식 프로세스가 가짜 엔진(커널 도구 루프 + 대본 모델)으로 세션을 돌리다 항목 2 도중 SIGKILL로 죽는다.
 * 하네스 재시작 → 미종료 세션 탐지(recover.ts) → POST /api/recovery/:session/resume → 남은 항목을 끝낸다.
 * 자식은 빌드된 dist를 쓴다 (pnpm -r build 필요 — packages/kernel/test/recover.detect.test.ts와 같다).
 */

const S = 's-crash-e2e';
const ENGINE = 'fake-api';
const KERNEL_DIST = repoPath('packages/kernel/dist/index.js');
const LEDGER_DIST = repoPath('packages/plugins-core/checklist-ledger/dist/index.js');

/** 세션을 돌리다 "ready"(항목 2 도중)에서 SIGKILL */
function crashSession(logRoot: string, ws: string): Promise<void> {
  return new Promise((ok, fail) => {
    const child = spawn(
      process.execPath,
      [fixture('crash-session.mjs'), KERNEL_DIST, LEDGER_DIST, logRoot, ws, S],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    child.stdout.on('data', (b: Buffer) => {
      if (b.toString().includes('ready')) child.kill('SIGKILL');
    });
    child.on('exit', (code, signal) =>
      signal === 'SIGKILL'
        ? ok()
        : fail(new Error(`자식이 크래시 전에 끝남 (code ${code}, signal ${signal})`)),
    );
    child.on('error', fail);
  });
}

describe('64.4 크래시 후 재개', () => {
  it(
    'SIGKILL로 항목 2 도중 죽은 세션 → 재시작 후 탐지 → [이어서 하기] → 2·3 완료',
    { timeout: 240_000 },
    async () => {
      const t = tempDir('hx-e2e-crash-');
      const ws = join(t.dir, 'ws');
      const logRoot = join(t.dir, 'logs');
      await crashSession(logRoot, ws);

      // ── 하네스 재시작 ──
      const log = new EventLog({ root: logRoot });
      const sessionDir = join(ws, '.harness-x', 'sessions', S);
      const ledgerFor = (id: string) =>
        id === S ? new ChecklistLedger({ dir: sessionDir, sessionId: S, log, engineId: ENGINE }) : null;

      // 61.1 미종료 세션: 마지막 턴 이벤트가 turn_end가 아니다
      const unfinished = findUnfinishedSessions(log);
      expect(unfinished.map((u) => u.sessionId)).toEqual([S]);
      expect(unfinished[0]!.lastEvent.type).not.toBe('turn_end');
      expect(unfinished[0]!.lastEvent).toMatchObject({ type: 'tool_result', itemId: '2', ok: true });

      // 61.2 상태 재구성: 항목 1 완료, 항목 2 진행 중(파일은 이미 썼음), 원장과 이벤트 재생이 일치
      const state = recoverSession(log, S, ledgerFor(S));
      expect(state).toMatchObject({
        unfinished: true,
        engineId: ENGINE,
        turns: 1,
        lastItemId: '2',
        pendingToolCalls: [],
        filesChanged: ['part-1.txt', 'part-2.txt'],
        checklist: { total: 3, done: 1, remaining: 2, next: { id: '2', status: 'doing' } },
        consistent: true,
      });
      expect(resumePlan(state)).toMatchObject({ itemId: '2', engineId: ENGINE });

      // ── 재개 실행기: 같은 가짜 엔진으로 다음 미완료 항목부터 끝까지 ──
      const prompts: { itemId: string; prompt: string }[] = [];
      let ran: Promise<void> = Promise.resolve();
      const resume = (plan: ResumePlan) => {
        ran = (async () => {
          const ledger = ledgerFor(plan.sessionId)!;
          let prompt = plan.prompt;
          for (let cur = ledger.currentItem(); cur; cur = ledger.currentItem()) {
            const id = cur.id;
            prompts.push({ itemId: id, prompt });
            if (cur.status === 'todo') ledger.transition(id, 'doing');
            const { client } = scriptedModel((step) =>
              step === 0
                ? callTool('write_file', { path: `part-${id}.txt`, content: `${id}\n` })
                : reply(`${id} 완료`),
            );
            for await (const e of runAgentLoop({
              client,
              sessionId: plan.sessionId,
              cwd: ws,
              prompt,
              engineId: plan.engineId ?? ENGINE,
              itemId: id,
            }))
              log.append(e);
            ledger.transition(id, 'verifying');
            ledger.transition(id, 'done');
            prompt = `항목 ${ledger.currentItem()?.id ?? '-'}`;
          }
          log.flush();
        })();
      };

      const loader = new PluginLoader({
        hooks: new HookBus({ log }),
        log,
        roots: [],
        lockFile: join(t.dir, 'lock'),
      });
      const server = await startApiServer({
        loader,
        log,
        port: 0,
        tokenFile: join(t.dir, 'run', 'token'),
        routes: (app) => registerRecoveryRoutes(app, { log, ledgerFor, resume }),
      });
      const auth = { authorization: `Bearer ${server.token}` };
      try {
        const cards = (await (await fetch(`${server.url}/api/recovery`, { headers: auth })).json()) as {
          sessions: unknown[];
        };
        expect(cards.sessions).toEqual([
          {
            sessionId: S,
            engineId: ENGINE,
            lastEventAt: expect.any(String),
            remaining: 2,
            nextItemId: '2',
            nextItemTitle: '항목 2 구현',
          },
        ]);

        const res = await fetch(`${server.url}/api/recovery/${S}/resume`, { method: 'POST', headers: auth });
        expect(res.status).toBe(202);
        expect(((await res.json()) as { plan: ResumePlan }).plan).toMatchObject({
          sessionId: S,
          itemId: '2',
        });
        await ran;

        // 재개는 항목 2부터 (1은 다시 하지 않음), 이어서 3까지
        expect(prompts.map((p) => p.itemId)).toEqual(['2', '3']);
        expect(prompts[0]!.prompt).toContain('다음 미완료 항목 2: 항목 2 구현');
        expect(prompts[0]!.prompt).toContain('이미 바뀐 파일: part-1.txt, part-2.txt');
        expect(
          ledgerFor(S)!
            .get()
            .items.map((i) => [i.id, i.status]),
        ).toEqual([
          ['1', 'done'],
          ['2', 'done'],
          ['3', 'done'],
        ]);
        for (const id of ['1', '2', '3'])
          expect(readFileSync(join(ws, `part-${id}.txt`), 'utf8')).toBe(`${id}\n`);
        const doing1 = log
          .query({ sessionId: S, type: 'checklist_change' })
          .filter((e) => e.changedItemId === '1' && e.to === 'doing');
        expect(doing1).toHaveLength(1);

        // 미종료 목록이 비고, 같은 세션을 다시 재개할 수 없다
        expect(findUnfinishedSessions(log)).toEqual([]);
        const after = (await (await fetch(`${server.url}/api/recovery`, { headers: auth })).json()) as {
          sessions: unknown[];
        };
        expect(after.sessions).toEqual([]);
        expect(
          (await fetch(`${server.url}/api/recovery/${S}/resume`, { method: 'POST', headers: auth })).status,
        ).toBe(404);
        expect(recoverSession(log, S, ledgerFor(S))).toMatchObject({ unfinished: false, consistent: true });
        expect(existsSync(log.sessionFile(S))).toBe(true);
      } finally {
        await server.close();
        log.close();
        t.cleanup();
      }
    },
  );
});
