import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EngineAdapter, HarnessEvent } from '@harness-x/protocol';
import { ChecklistLedger } from '../src/ledger.js';
import {
  injectClaudeStopHook,
  injectCodexStopHook,
  runWithStopGuard,
  StopGuard,
  stopBridgeCommand,
} from '../src/stop-guard.js';
import { item, tempDir } from './helpers.js';

const CMD = stopBridgeCommand({ node: 'node', script: '/opt/hx/stop-bridge.mjs', dir: '/ws/.harness-x/s1' });

const cases = [
  { name: '28.2 Claude Code', inject: injectClaudeStopHook, rel: ['.claude', 'settings.local.json'] },
  { name: '28.3 Codex', inject: injectCodexStopHook, rel: ['.codex', 'hooks.json'] },
] as const;

describe.each(cases)('$name Stop 훅 브리지 임시 주입', ({ inject, rel }) => {
  it('기존 파일: 세션 중 Stop 훅 추가(기존 설정·훅 보존) → 종료 후 바이트 그대로 원복', () => {
    const { dir, cleanup } = tempDir();
    try {
      const file = join(dir, ...rel);
      mkdirSync(join(dir, rel[0]), { recursive: true });
      // 들여쓰기·키 순서·끝 줄바꿈 없음까지 그대로 돌아와야 한다
      const original =
        '{"permissions":{"allow":["Bash(ls)"]},\n   "hooks":{"Stop":[{"hooks":[{"type":"command","command":"echo user"}]}]}}';
      writeFileSync(file, original);
      const before = readFileSync(file);

      const h = inject(dir, CMD);
      const during = JSON.parse(readFileSync(file, 'utf8')) as {
        permissions: unknown;
        hooks: { Stop: { hooks: { type: string; command: string; timeout?: number }[] }[] };
      };
      expect(during.permissions).toEqual({ allow: ['Bash(ls)'] });
      expect(during.hooks.Stop).toHaveLength(2);
      expect(during.hooks.Stop[0]!.hooks[0]!.command).toBe('echo user');
      expect(during.hooks.Stop[1]!.hooks).toEqual([{ type: 'command', command: CMD, timeout: 30 }]);

      h.restore();
      expect(readFileSync(file).equals(before)).toBe(true);
      h.restore(); // 두 번 불러도 안전
      expect(readFileSync(file).equals(before)).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('파일·폴더가 없었으면 세션 후 둘 다 지운다', () => {
    const { dir, cleanup } = tempDir();
    try {
      const file = join(dir, ...rel);
      const h = inject(dir, CMD);
      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file, 'utf8')).toContain('stop-bridge.mjs');
      h.restore();
      expect(existsSync(file)).toBe(false);
      expect(existsSync(join(dir, rel[0]))).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('폴더는 있고 파일만 없었으면 파일만 지운다 (폴더 안 다른 파일 보존)', () => {
    const { dir, cleanup } = tempDir();
    try {
      mkdirSync(join(dir, rel[0]));
      writeFileSync(join(dir, rel[0], 'other.json'), '{}');
      const h = inject(dir, CMD);
      h.restore();
      expect(existsSync(join(dir, ...rel))).toBe(false);
      expect(readFileSync(join(dir, rel[0], 'other.json'), 'utf8')).toBe('{}');
    } finally {
      cleanup();
    }
  });
});

describe('stopBridgeCommand', () => {
  it('공백·따옴표 경로를 셸 인용', () => {
    expect(
      stopBridgeCommand({ node: '/usr/bin/node', script: "/a b/it's.mjs", dir: '/w', engineId: 'codex' }),
    ).toBe(`/usr/bin/node '/a b/it'\\''s.mjs' --dir /w --engine codex`);
  });
});

describe('세션 단위 주입: runWithStopGuard가 시작 시 주입하고 끝나면 원복', () => {
  it.each([
    ['claude-code', '.claude/settings.local.json', true],
    ['codex', '.codex/hooks.json', false],
  ] as const)('%s: 실행 중에는 브리지가 보이고, 세션 후 원상태', async (engineId, rel, native) => {
    const { dir, cleanup } = tempDir();
    try {
      const file = join(dir, rel);
      mkdirSync(join(dir, rel.split('/')[0]!));
      writeFileSync(file, '{ "keep": 1 }\n');
      const before = readFileSync(file);
      const ledger = new ChecklistLedger({ dir: join(dir, 'session'), sessionId: 's1' });
      ledger.create([item('1')]);
      let seen = '';
      const engine: EngineAdapter = {
        id: engineId,
        displayName: engineId,
        capabilities: { nativeStopHook: native, resume: true, mcp: true, interrupt: true },
        run(o) {
          seen = readFileSync(file, 'utf8');
          const ev: HarnessEvent = {
            id: 'e',
            ts: new Date().toISOString(),
            sessionId: o.sessionId,
            type: 'turn_end',
            reason: 'interrupted',
          };
          return {
            events: (async function* () {
              yield ev;
            })(),
            engineSessionId: () => undefined,
            interrupt: async () => {},
            done: Promise.resolve({ exitCode: 0 }),
          };
        },
      };
      for await (const e of runWithStopGuard({
        engine,
        run: { sessionId: 's1', prompt: 'go', cwd: dir },
        guard: new StopGuard(ledger),
        bridge: { command: CMD },
      }))
        void e;
      expect(seen).toContain('stop-bridge.mjs');
      expect(JSON.parse(seen)).toMatchObject({ keep: 1 });
      expect(readFileSync(file).equals(before)).toBe(true);
    } finally {
      cleanup();
    }
  });
});
