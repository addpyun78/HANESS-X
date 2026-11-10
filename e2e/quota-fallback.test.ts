import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ChecklistLedger, type ChecklistItemInput } from '@harness-x/checklist-ledger';
import { createClaudeCodeEngine } from '@harness-x/engine-claude-code';
import { createCodexEngine } from '@harness-x/engine-codex';
import {
  aggregateUsage,
  EventLog,
  parseResetAt,
  runChecklistWithFailover,
  type FailoverRunInput,
  type FailoverRunResult,
  type LogRecord,
} from '@harness-x/kernel';
import type { EngineAdapter, HarnessEvent } from '@harness-x/protocol';
import { describe, expect, it } from 'vitest';
import { fixture, repoPath, tempDir } from './helpers.js';

/**
 * T-064 64.3 Claude Code 한도 초과 → Codex 폴백 → 완료 (시뮬레이션)
 * 실제 어댑터(engine-claude-code·engine-codex)를 가짜 바이너리 + 녹화 픽스처로 돌린다.
 * claude 구독 한도는 성공 1턴 뒤 소진된다. 쿼터 라우팅(kernel quota.ts)이 codex로 폴백하고,
 * codex는 체크리스트의 "다음 미완료 항목"부터 이어서 끝낸다.
 */

const S = 's-quota-e2e';
const CODEX_FX = (n: string) => repoPath(`packages/engines/codex/test/fixtures/${n}`);
const CLAUDE_FX = (n: string) => repoPath(`packages/engines/claude-code/test/fixtures/${n}`);

const item = (id: string): ChecklistItemInput => ({
  id,
  title: `항목 ${id}`,
  artifactId: `art.item-${id.replace(/\./g, '-')}`,
  acceptance: [{ type: 'test', run: `pnpm test item-${id}` }],
});

const readLines = (file: string) =>
  existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>)
    : [];

describe('64.3 Claude Code 한도 초과 → Codex 폴백 → 완료', () => {
  it('claude-code(구독, API 키 없음)가 1.2에서 한도 → codex가 1.2부터 이어서 1.3까지 완료', async () => {
    const t = tempDir('hx-e2e-quota-');
    const ws = join(t.dir, 'ws');
    const log = new EventLog({ root: join(t.dir, 'logs') });
    const ledger = new ChecklistLedger({ dir: join(ws, '.harness-x', 'sessions', S), sessionId: S, log });
    ledger.create([item('1.1'), item('1.2'), item('1.3')]);

    const budgetFile = join(t.dir, 'claude-budget');
    writeFileSync(budgetFile, '1'); // 구독 한도: 성공 1턴
    const claudeLog = join(t.dir, 'claude.log');
    const codexLog = join(t.dir, 'codex.log');
    const env = {
      ...process.env,
      HX_FAKE_CLAUDE_BUDGET: budgetFile,
      HX_FAKE_CLAUDE_OK: CLAUDE_FX('tool-write.jsonl'),
      HX_FAKE_CLAUDE_LIMIT: fixture('claude-usage-limit.jsonl'),
      HX_FAKE_REPLAY: CODEX_FX('app-server-turn.jsonl'),
      HX_FAKE_RATELIMITS: CODEX_FX('ratelimits-ok.json'),
    };
    const engines: Record<string, Pick<EngineAdapter, 'run'>> = {
      'claude-code': createClaudeCodeEngine({
        command: process.execPath,
        prefixArgs: [fixture('fake-claude.mjs')],
      }),
      codex: createCodexEngine({
        command: process.execPath,
        prefixArgs: [CODEX_FX('fake-codex.mjs')],
        transport: 'app-server',
      }),
    };

    const all: HarnessEvent[] = [];
    const runItem = async ({ selection, item: it, prompt }: FailoverRunInput): Promise<FailoverRunResult> => {
      const engine = engines[selection.engineId];
      if (!engine) return { status: 'failed', message: `엔진 없음: ${selection.engineId}` };
      if (ledger.item(it.id).status === 'todo') ledger.transition(it.id, 'doing');
      const run = engine.run({
        sessionId: S,
        cwd: ws,
        prompt,
        itemId: it.id,
        permission: 'workspace-write',
        env: { ...env, HX_FAKE_LOG: selection.engineId === 'codex' ? codexLog : claudeLog },
      });
      const evs: HarnessEvent[] = [];
      for await (const e of run.events) {
        log.append(e);
        evs.push(e);
      }
      await run.done;
      all.push(...evs);
      const err = evs.find((e) => e.type === 'error');
      if (err?.type === 'error' && err.code === 'quota_exceeded') {
        const resetAt = parseResetAt(err.message);
        return { status: 'quota_exceeded', message: err.message, ...(resetAt ? { resetAt } : {}) };
      }
      const end = evs.at(-1);
      if (err || end?.type !== 'turn_end' || end.reason !== 'completed')
        return { status: 'failed', message: err?.type === 'error' ? err.message : 'turn_end 없음' };
      ledger.transition(it.id, 'verifying');
      ledger.transition(it.id, 'done');
      return { status: 'done' };
    };

    const sleeps: (Date | undefined)[] = [];
    try {
      const r = await runChecklistWithFailover({
        ledger,
        start: { engineId: 'claude-code', mode: 'subscription' },
        route: {
          settings: {
            engines: {
              'claude-code': { mode: 'subscription', fallback: ['codex'] },
              codex: { mode: 'subscription', fallback: [] },
            },
          },
          hasApiKey: () => false, // 같은 엔진 API 모드로는 못 바꾼다 → 폴백 엔진
          available: (id) => id in engines,
        },
        runItem,
        sleepUntil: async (d) => void sleeps.push(d),
      });

      // ── 완료: 일시정지 없이 폴백으로 끝까지 ──
      expect(r.status).toBe('completed');
      expect(sleeps).toEqual([]);
      expect(r.runs.map((x) => `${x.selection.engineId}@${x.itemId}:${x.status}`)).toEqual([
        'claude-code@1.1:done',
        'claude-code@1.2:quota_exceeded',
        'codex@1.2:done',
        'codex@1.3:done',
      ]);
      expect(r.decisions).toEqual([
        {
          action: 'fallback',
          from: { engineId: 'claude-code', mode: 'subscription' },
          to: { engineId: 'codex', mode: 'subscription' },
        },
      ]);
      expect(ledger.get().items.map((i) => [i.id, i.status])).toEqual([
        ['1.1', 'done'],
        ['1.2', 'done'],
        ['1.3', 'done'],
      ]);

      // ── 어댑터가 한도 문구를 quota_exceeded로 분류했고 쿼터 미터가 claude를 소진으로 본다 ──
      const quotaErr = all.find((e) => e.type === 'error');
      expect(quotaErr).toMatchObject({ engineId: 'claude-code', itemId: '1.2', code: 'quota_exceeded' });
      const usage = aggregateUsage(log.query({ sessionId: S }));
      expect(usage.find((u) => u.engineId === 'claude-code')).toMatchObject({ exceeded: true, ratio: 1 });
      expect(usage.find((u) => u.engineId === 'codex')).toMatchObject({ exceeded: false });

      // ── 가짜 바이너리가 받은 지시: claude 2회(1.1, 1.2), codex는 1.2부터 ──
      const claudePrompts = readLines(claudeLog).map((m) => String((m.argv as string[]).at(-1)));
      expect(claudePrompts).toHaveLength(2);
      expect(claudePrompts[0]).toContain('다음 미완료 항목 1.1');
      expect(claudePrompts[1]).toContain('다음 미완료 항목 1.2');
      const codexTurns = readLines(codexLog).filter((m) => m.method === 'turn/start');
      const codexPrompts = codexTurns.map(
        (m) => ((m.params as { input: { text: string }[] }).input[0] ?? { text: '' }).text,
      );
      expect(codexPrompts).toHaveLength(2);
      expect(codexPrompts[0]).toMatch(/^체크리스트의 다음 미완료 항목 1\.2 "항목 1\.2"부터/);
      expect(codexPrompts[0]).toContain('완료(done)된 항목은 다시 하지 마세요');
      expect(codexPrompts[1]).toContain('다음 미완료 항목 1.3');

      // ── 리플레이: 끝난 항목은 다시 하지 않고, 1.2는 엔진이 바뀌어도 처음부터 다시 시작하지 않는다 ──
      const replayed: LogRecord[] = [];
      for await (const e of log.replay(S)) replayed.push(e);
      const toDoing = (id: string) =>
        replayed.filter((e) => e.type === 'checklist_change' && e.changedItemId === id && e.to === 'doing');
      expect(toDoing('1.1')).toHaveLength(1);
      expect(toDoing('1.2')).toHaveLength(1);
      const enginesFor = (id: string) => [
        ...new Set(replayed.filter((e) => e.itemId === id && e.engineId).map((e) => e.engineId)),
      ];
      expect(enginesFor('1.1')).toEqual(['claude-code']);
      expect(enginesFor('1.2')).toEqual(['claude-code', 'codex']);
      expect(enginesFor('1.3')).toEqual(['codex']);
    } finally {
      log.close();
      t.cleanup();
    }
  });
});
