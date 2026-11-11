import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  ChecklistLedger,
  Escalator,
  ManifestStore,
  ensureProjectGlossary,
  loadGlossary,
  type ChecklistItemInput,
  type VerdictKind,
} from '@harness-x/checklist-ledger';
import {
  EventLog,
  HookBus,
  PluginLoader,
  runAgentLoop,
  startApiServer,
  type ModelClient,
} from '@harness-x/kernel';
import { installPlanGate, PATH_CORRECTED_KIND } from '@harness-x/permission-gate';
import type { HarnessEvent } from '@harness-x/protocol';
import { runLadder, runLadderL4 } from '@harness-x/verifier-ladder';
import { describe, expect, it } from 'vitest';
import { callTool, lastToolMessage, reply, scriptedModel, tempDir } from './helpers.js';

/**
 * T-064 64.1 경로 동치 회귀 (E2E)
 * 계획(manifest)은 표시 이름 "하네스/모바일"(정식 경로 harness/mobile), 엔진은 ai/mobile에 쓰려 한다.
 * 결과는 반드시 둘 중 하나여야 하고 실패 판정은 0건이어야 한다.
 *   (가) 판정 사다리 L1~L3 → L4 off → L5 승인 카드 → POST /api/approvals/:id equivalent → 항목 done
 *   (나) 한 번 동치로 인정된 뒤에는 쓰는 순간 plan-gate(tool.before)가 harness/mobile로 교정
 * 엔진은 커널 도구 루프(runAgentLoop) + 대본 모델(실제 API 호출 없음)이다.
 */

const S = 's-path-eq';
const ENGINE = 'fake-api';
const FAILURE_VERDICTS: readonly VerdictKind[] = ['wrong', 'missing'];

const item = (id: string, symbol: string): ChecklistItemInput => ({
  id,
  title: `모바일 앱 ${symbol}`,
  artifactId: 'art.mobile-app',
  acceptance: [{ type: 'symbol', symbol }],
});

/** 도구 결과의 "canonical path: X"를 읽어 다시 쓰는 정상 엔진처럼 행동하는 대본 */
function writerModel(firstPath: string, content: string): { client: ModelClient; attempts: string[] } {
  const attempts: string[] = [];
  const { client } = scriptedModel((_step, req) => {
    const last = lastToolMessage(req.messages);
    if (!last) {
      attempts.push(firstPath);
      return callTool('write_file', { path: firstPath, content }, `${firstPath}에 씁니다`);
    }
    const canonical = /canonical path: (\S+)/.exec(last.content)?.[1];
    if (last.content.startsWith('Tool call denied') && canonical) {
      attempts.push(canonical);
      return callTool('write_file', { path: canonical, content }, `정식 경로 ${canonical}로 다시 씁니다`);
    }
    return reply('완료');
  });
  return { client, attempts };
}

describe('64.1 경로 동치 회귀: 하네스/모바일 vs ai/mobile', () => {
  it('L5 승인 카드로 동치 인정 → 다음부터는 쓰는 순간 harness/mobile로 교정, 실패 판정 0건', async () => {
    const t = tempDir('hx-e2e-pathq-');
    const ws = t.dir;
    const sessionDir = join(ws, '.harness-x', 'sessions', S);
    const glossaryFile = join(ws, '.harness-x', 'glossary.json');
    const log = new EventLog({ root: join(ws, 'logs') });
    const ledger = new ChecklistLedger({ dir: sessionDir, sessionId: S, log, engineId: ENGINE });
    const manifest = new ManifestStore({ dir: sessionDir, sessionId: S, log });
    const glossary = ensureProjectGlossary(glossaryFile);

    // ── 계획 확정: 항목 2개가 같은 산출물(하네스/모바일)을 쓴다 ──
    ledger.create([item('1', 'MainActivity'), item('2', 'SettingsActivity')]);
    const locked = manifest.lock(
      [{ artifactId: 'art.mobile-app', displayName: '하네스/모바일', kind: 'dir' }],
      {
        glossary,
      },
    );
    expect(locked.status).toBe('locked');
    expect(manifest.read()!.artifacts['art.mobile-app']).toMatchObject({ path: 'harness/mobile' });

    // ── 커널 HookBus tool.before에 계획 게이트 설치 (default 모드: manifest 밖이면 사용자에게 묻는다) ──
    const bus = new HookBus({ log });
    const asks: string[][] = [];
    installPlanGate(bus, {
      ledger,
      manifest,
      glossary,
      workspace: ws,
      log,
      sessionId: S,
      mode: 'default',
      // 사용자가 쓰기 자체는 허용 (경로가 맞는지는 판정 사다리가 본다)
      approve: (a) => (asks.push(a.paths), true),
    });

    const escalator = new Escalator({ dir: sessionDir, sessionId: S, log, ledger, manifest, glossaryFile });
    const loader = new PluginLoader({ hooks: bus, log, roots: [], lockFile: join(ws, 'lock') });
    const server = await startApiServer({
      loader,
      log,
      port: 0,
      token: 'e2e-path-equivalence-token-000000',
      tokenFile: join(ws, 'run', 'token'),
      approvals: escalator,
    });

    const verdicts: { itemId: string; level: number; verdict: VerdictKind }[] = [];
    const events: HarnessEvent[] = [];

    /** 엔진 1턴: 커널 도구 루프 → 이벤트 로그 */
    async function engineTurn(itemId: string, client: ModelClient) {
      const turn: HarnessEvent[] = [];
      for await (const e of runAgentLoop({
        client,
        sessionId: S,
        cwd: ws,
        prompt: `항목 ${itemId}: 하네스/모바일에 작성`,
        engineId: ENGINE,
        itemId,
        hooks: bus,
      })) {
        log.append(e);
        turn.push(e);
      }
      events.push(...turn);
      expect(turn.at(-1)).toMatchObject({ type: 'turn_end', reason: 'completed' });
      return turn;
    }

    /** 판정 사다리: L1~L3 → (escalate면) L4 off → L5 */
    async function verify(itemId: string, turn: HarnessEvent[]) {
      const entry = manifest.read()!.artifacts['art.mobile-app']!;
      const it = ledger.item(itemId);
      const l3 = await runLadder({
        expected: { path: entry.path, kind: 'dir', ...(entry.aliases ? { aliases: entry.aliases } : {}) },
        changes: turn.filter((e) => e.type === 'file_change'),
        acceptance: it.acceptance,
        root: ws,
        glossary: loadGlossary(glossaryFile),
      });
      verdicts.push({ itemId, level: l3.level, verdict: l3.verdict });
      const r = await runLadderL4(l3, { judge: null, itemTitle: it.title });
      if (r.level === 4) verdicts.push({ itemId, level: 4, verdict: r.verdict });
      return { l3, r };
    }

    try {
      // ══ (가) 첫 항목: 엔진이 ai/mobile에 쓴다 ══
      ledger.transition('1', 'doing');
      const w1 = writerModel('ai/mobile/MainActivity.kt', 'class MainActivity\n');
      const turn1 = await engineTurn('1', w1.client);
      // manifest 밖 → 게이트가 승인을 물었고(approval_request), 사용자가 허용해 ai/mobile에 써졌다
      expect(asks).toEqual([['ai/mobile/MainActivity.kt']]);
      expect(existsSync(join(ws, 'ai/mobile/MainActivity.kt'))).toBe(true);
      ledger.transition('1', 'verifying');

      const v1 = await verify('1', turn1);
      expect(v1.l3).toMatchObject({
        level: 3,
        verdict: 'relocated',
        actualPath: 'ai/mobile',
        escalate: true,
      });
      expect(v1.r).toMatchObject({ level: 4, decision: 'skipped', escalate: true }); // L4 off → L5

      const out = await escalator.escalate({
        itemId: '1',
        artifactId: 'art.mobile-app',
        itemTitle: ledger.item('1').title,
        expectedPath: v1.r.expectedPath,
        actualPath: v1.r.actualPath!,
        reason: v1.r.reason,
        writerEngineId: ENGINE,
        symbols: ['MainActivity'],
      });
      if (out.status !== 'pending') throw new Error(`L5 승인 카드가 필요합니다 (받은 결과 ${out.status})`);
      // 승인 카드: 예상 경로 / 실제 경로 / 버튼 3개
      const card = log
        .query({ sessionId: S, type: 'approval_request' })
        .find((e) => (e as { approvalId?: string }).approvalId === out.approvalId);
      expect(card).toMatchObject({
        kind: 'ladder.l5',
        detail: { expectedPath: 'harness/mobile', actualPath: 'ai/mobile' },
        options: ['equivalent', 'move', 'fail'],
      });

      // 사람이 카드에서 [동치 인정]
      const res = await fetch(`${server.url}/api/approvals/${out.approvalId}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${server.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'equivalent' }),
      });
      expect(res.status).toBe(200);
      const it1 = ledger.item('1');
      expect(it1.status).toBe('done');
      expect(it1.verdict).toMatchObject({ level: 5, verdict: 'equal' });
      verdicts.push({ itemId: '1', level: 5, verdict: it1.verdict!.verdict });
      // 사전 학습: manifest 별칭 ai/mobile, glossary harness ⇐ ai
      expect(manifest.read()!.artifacts['art.mobile-app']!.aliases).toContain('ai/mobile');
      expect(loadGlossary(glossaryFile).terms.find((w) => w.canonical === 'harness')?.aliases).toContain(
        'ai',
      );

      // ══ (나) 다음 항목: 엔진이 또 ai/mobile에 쓰려 함 → 쓰는 순간 harness/mobile로 교정 ══
      ledger.transition('2', 'doing');
      const w2 = writerModel('ai/mobile/SettingsActivity.kt', 'class SettingsActivity\n');
      const turn2 = await engineTurn('2', w2.client);
      expect(w2.attempts).toEqual(['ai/mobile/SettingsActivity.kt', 'harness/mobile/SettingsActivity.kt']);
      expect(asks).toHaveLength(1); // 이번에는 사람에게 묻지 않았다
      const denied = turn2.find((e) => e.type === 'tool_result' && !e.ok);
      expect(JSON.stringify(denied)).toContain('path_mismatch');
      expect(existsSync(join(ws, 'ai/mobile/SettingsActivity.kt'))).toBe(false);
      expect(existsSync(join(ws, 'harness/mobile/SettingsActivity.kt'))).toBe(true);
      expect(turn2.filter((e) => e.type === 'file_change').map((e) => e.path)).toEqual([
        'harness/mobile/SettingsActivity.kt',
      ]);
      // 교정 내역이 항목 evidence에 남는다
      expect(ledger.item('2').evidence.find((e) => e.kind === PATH_CORRECTED_KIND)).toMatchObject({
        from: 'ai/mobile/SettingsActivity.kt',
        to: 'harness/mobile/SettingsActivity.kt',
      });

      ledger.transition('2', 'verifying');
      const v2 = await verify('2', turn2);
      expect(v2.r).toMatchObject({ level: 1, verdict: 'equal', escalate: false });
      ledger.transition('2', 'done', {
        verdict: { level: 1, verdict: v2.r.verdict, confidence: v2.r.confidence, reason: v2.r.reason },
      });

      // ══ 실패 판정 0건 ══
      expect(verdicts.filter((v) => FAILURE_VERDICTS.includes(v.verdict))).toEqual([]);
      expect(ledger.get().items.map((i) => [i.id, i.status])).toEqual([
        ['1', 'done'],
        ['2', 'done'],
      ]);
      expect(
        log
          .query({ sessionId: S, type: 'checklist_change' })
          .filter((e) => (e as { to?: string }).to === 'failed'),
      ).toEqual([]);
      expect(events.some((e) => e.type === 'error')).toBe(false);
    } finally {
      await server.close();
      log.close();
      t.cleanup();
    }
  });
});
