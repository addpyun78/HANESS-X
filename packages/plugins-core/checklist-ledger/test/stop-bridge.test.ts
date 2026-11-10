import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ChecklistLedger } from '../src/ledger.js';
import { readBridgeLog } from '../src/stop-guard.js';
import { item, tempDir } from './helpers.js';

const BRIDGE = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../../scripts/hooks/stop-bridge.mjs',
);

function bridge(dir: string, input: unknown, extra: string[] = []) {
  const r = spawnSync(process.execPath, [BRIDGE, '--dir', dir, ...extra], {
    input: JSON.stringify(input),
    encoding: 'utf8',
  });
  return { code: r.status, stdout: r.stdout.trim(), stderr: r.stderr };
}

function finish(l: ChecklistLedger, id: string) {
  l.transition(id, 'doing');
  l.transition(id, 'verifying');
  l.transition(id, 'done');
}

describe('28.4 stop-bridge.mjs 입력 3종', () => {
  it('① 미완료 + stop_hook_active=false → {"decision":"block","reason":"다음 항목 …"}', () => {
    const { dir, cleanup } = tempDir();
    try {
      const l = new ChecklistLedger({ dir, sessionId: 's1' });
      l.create([item('1'), item('2')]);
      const log = join(dir, 'bridge.jsonl');
      const r = bridge(dir, { session_id: 'x', hook_event_name: 'Stop', stop_hook_active: false }, [
        '--log',
        log,
        '--engine',
        'claude-code',
      ]);
      expect(r.code).toBe(0);
      const out = JSON.parse(r.stdout) as { decision: string; reason: string };
      expect(out.decision).toBe('block');
      expect(out.reason).toMatch(/^다음 항목 1: 항목 1 구현 — .*미완료 항목 2개/);
      expect(readBridgeLog(log)).toMatchObject([
        { decision: 'block', engineId: 'claude-code', remaining: 2, nextItemId: '1', stopHookActive: false },
      ]);
    } finally {
      cleanup();
    }
  });

  it('② stop_hook_active=true이고 직전 block 뒤 진척 없음 → 통과 (진척 있으면 다시 block)', () => {
    const { dir, cleanup } = tempDir();
    try {
      const l = new ChecklistLedger({ dir, sessionId: 's1' });
      l.create([item('1'), item('2')]);
      expect(JSON.parse(bridge(dir, { stop_hook_active: false }).stdout)).toMatchObject({
        decision: 'block',
      });
      const pass = bridge(dir, { stop_hook_active: true });
      expect(pass.code).toBe(0);
      expect(pass.stdout).toBe('');
      expect(pass.stderr).toContain('진척 없음');
      // 진척(항목 1 완료) 뒤에는 stop_hook_active여도 다음 항목으로 block
      expect(JSON.parse(bridge(dir, { stop_hook_active: false }).stdout)).toMatchObject({
        decision: 'block',
      });
      finish(l, '1');
      const again = JSON.parse(bridge(dir, { stop_hook_active: true }).stdout) as { reason: string };
      expect(again.reason).toMatch(/^다음 항목 2:/);
    } finally {
      cleanup();
    }
  });

  it('③ 모두 완료 → 통과 (체크리스트 없음도 통과)', () => {
    const { dir, cleanup } = tempDir();
    try {
      const none = bridge(dir, { stop_hook_active: false });
      expect(none).toMatchObject({ code: 0, stdout: '' });
      const l = new ChecklistLedger({ dir, sessionId: 's1' });
      l.create([item('1')]);
      finish(l, '1');
      const r = bridge(dir, { stop_hook_active: false });
      expect(r).toMatchObject({ code: 0, stdout: '' });
      expect(r.stderr).toContain('모든 항목 완료');
    } finally {
      cleanup();
    }
  });
});
