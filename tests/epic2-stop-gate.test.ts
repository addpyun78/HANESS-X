import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ChecklistLedger,
  ingestBridgeLog,
  runWithStopGuard,
  StopGuard,
  stopBridgeCommand,
  type ChecklistItemInput,
} from '@harness-x/checklist-ledger';
import { createAntigravityEngine } from '@harness-x/engine-antigravity';
import { createClaudeCodeEngine } from '@harness-x/engine-claude-code';
import { createCodexEngine } from '@harness-x/engine-codex';
import { EventLog, HookBus } from '@harness-x/kernel';
import type { EngineAdapter, HarnessEvent } from '@harness-x/protocol';
import { describe, expect, it } from 'vitest';

/**
 * 28.6 EPIC 2 게이트: 미완료 체크리스트에서 3개 엔진(claude-code·codex·antigravity) 모두 종료가 차단된다.
 *  - claude-code: settings.local.json Stop 훅 → stop-bridge.mjs (가짜 claude가 실제 CLI처럼 훅 실행)
 *  - codex: .codex/hooks.json Stop 훅 → stop-bridge.mjs (+ 하네스 재주입 폴백)
 *  - antigravity: 훅 없음 → 하네스 stop.before 재주입 (가짜 agy 리플레이)
 * 모든 block 판단은 이벤트 로그의 hook_result(stop.before)로 남는다.
 */
const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const FAKE = join(root, 'tests/fixtures/fake-stop-engine.mjs');
const BRIDGE = join(root, 'scripts/hooks/stop-bridge.mjs');
const AGY_FX = join(root, 'packages/engines/antigravity/test/fixtures');

const item = (id: string): ChecklistItemInput => ({
  id,
  title: `항목 ${id} 구현`,
  artifactId: `art.item-${id}`,
  acceptance: [{ type: 'test', run: `pnpm test item-${id}` }],
});

const engines: { id: string; make: () => EngineAdapter; config?: string }[] = [
  {
    id: 'claude-code',
    make: () => createClaudeCodeEngine({ command: process.execPath, prefixArgs: [FAKE, 'claude'] }),
    config: '.claude/settings.local.json',
  },
  {
    id: 'codex',
    make: () =>
      createCodexEngine({ command: process.execPath, prefixArgs: [FAKE, 'codex'], transport: 'exec' }),
    config: '.codex/hooks.json',
  },
  {
    id: 'antigravity',
    make: () =>
      createAntigravityEngine({ command: process.execPath, prefixArgs: [join(AGY_FX, 'fake-agy.mjs')] }),
  },
];

describe('28.6 EPIC 2 게이트: 3개 엔진 미완료 종료 차단', () => {
  it('claude-code·codex·antigravity 모두 block 로그를 남기고, 훅 설정 파일은 세션 후 원상태', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hx-epic2-'));
    const log = new EventLog({ root: join(dir, 'logs') });
    try {
      const hooks = new HookBus({ log });
      const blocked: Record<string, HarnessEvent[]> = {};
      for (const e of engines) {
        const ws = join(dir, e.id);
        const sessionDir = join(ws, '.harness-x', 'sessions', 's1');
        const ledger = new ChecklistLedger({ dir: sessionDir, sessionId: 's1' });
        ledger.create([item('1'), item('2')]);
        const guard = new StopGuard(ledger);
        const off = guard.install(hooks);
        const bridgeLog = join(dir, `${e.id}.bridge.jsonl`);
        const hookLog = join(dir, `${e.id}.hooks.jsonl`);
        const events: HarnessEvent[] = [];
        try {
          for await (const ev of runWithStopGuard({
            engine: e.make(),
            run: {
              sessionId: 's1',
              prompt: '체크리스트를 진행하세요',
              cwd: ws,
              env: {
                ...process.env,
                HX_FAKE_HOOK_LOG: hookLog,
                HX_FAKE_STDOUT: join(AGY_FX, 'hi.real.jsonl'),
              },
            },
            guard,
            hooks,
            maxAutoTurns: 3,
            bridge: {
              command: stopBridgeCommand({
                script: BRIDGE,
                dir: sessionDir,
                logFile: bridgeLog,
                engineId: e.id,
                sessionId: 's1',
              }),
            },
          }))
            events.push(ev);
        } finally {
          off();
        }
        ingestBridgeLog(bridgeLog, log, 's1');
        blocked[e.id] = events;
        if (e.config) {
          // 엔진이 실제로 훅을 실행했고 block을 받았다
          const calls = readFileSync(hookLog, 'utf8')
            .trim()
            .split('\n')
            .map((l) => JSON.parse(l) as { res: unknown });
          expect(calls[0]).toMatchObject({ active: false, res: { decision: 'block' } });
          expect(calls.at(-1)).toMatchObject({ active: true, res: null }); // 무진척 → 통과
          // 하네스가 만든 설정 파일은 세션 후 사라진다 (원래 없었음)
          expect(existsSync(join(ws, e.config))).toBe(false);
        }
      }

      const blocks = log
        .query({ sessionId: 's1', type: 'hook_result' })
        .filter((r) => r.hook === 'stop.before' && r.decision === 'block');
      const byEngine = new Set(blocks.map((r) => r.engineId));
      console.log(
        JSON.stringify(
          blocks.map((r) => ({
            engineId: r.engineId,
            hookId: r.hookId,
            decision: r.decision,
            itemId: r.itemId,
          })),
        ),
      );
      expect([...byEngine].sort()).toEqual(['antigravity', 'claude-code', 'codex']);
      for (const b of blocks) expect(String(b.reason)).toMatch(/^다음 항목 1: 항목 1 구현/);
      // 브리지 경로(claude-code·codex)는 stop-bridge, 재주입 경로(antigravity)는 stop-guard 훅이 판단
      expect(blocks.find((b) => b.engineId === 'claude-code')?.hookId).toBe('stop-bridge');
      expect(blocks.find((b) => b.engineId === 'antigravity')?.hookId).toBe('checklist-ledger:stop-guard');
      // 재주입 경로는 UI용 turn_end(blocked)를 낸다
      expect(blocked.antigravity!.find((e) => e.type === 'turn_end' && e.reason === 'blocked')).toMatchObject(
        {
          remaining: 2,
          nextItemId: '1',
          nextItemTitle: '항목 1 구현',
        },
      );
    } finally {
      log.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
