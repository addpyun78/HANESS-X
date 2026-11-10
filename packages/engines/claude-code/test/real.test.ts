import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HarnessEvent } from '@harness-x/protocol';
import { describe, expect, it } from 'vitest';
import { createClaudeCodeEngine } from '../src/engine.js';

/**
 * 실제 claude 바이너리로 실행하는 테스트 ("실제 1회" 항목용). 구독 사용량을 쓰므로 기본은 건너뛴다.
 * 실행: HX_REAL_CLAUDE=1 pnpm exec vitest run packages/engines/claude-code/test/real.test.ts
 */
const REAL = process.env.HX_REAL_CLAUDE === '1';

async function collect(events: AsyncIterable<HarnessEvent>): Promise<HarnessEvent[]> {
  const out: HarnessEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

describe.skipIf(!REAL)('14.3 실제 2턴 실행 (--resume)', () => {
  it('두 번째 턴이 같은 세션을 이어 첫 턴의 단어를 기억한다', { timeout: 300_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hx-claude-real-'));
    try {
      const engine = createClaudeCodeEngine();
      const r1 = engine.run({
        sessionId: 'hx-real',
        cwd: dir,
        permission: 'read-only',
        prompt: 'Remember the word kiwi. Reply with just: ok',
      });
      const e1 = await collect(r1.events);
      await r1.done;
      const id1 = r1.engineSessionId();
      expect(id1).toMatch(/^[0-9a-f-]{36}$/);
      expect(e1.at(-1)).toMatchObject({ type: 'turn_end', reason: 'completed' });

      const r2 = engine.run({
        sessionId: 'hx-real',
        cwd: dir,
        permission: 'read-only',
        resumeId: id1,
        prompt: 'What word did I ask you to remember? Reply with just the word.',
      });
      const e2 = await collect(r2.events);
      await r2.done;
      const text = e2
        .filter((e) => e.type === 'assistant_text')
        .map((e) => (e.type === 'assistant_text' ? e.text : ''))
        .join(' ');
      console.log(
        JSON.stringify({
          id1,
          id2: r2.engineSessionId(),
          turn1: e1.map((e) => e.type),
          turn2: e2.map((e) => e.type),
          text,
        }),
      );
      expect(r2.engineSessionId()).toBe(id1);
      expect(text.toLowerCase()).toContain('kiwi');
      expect(e2.at(-1)).toMatchObject({ type: 'turn_end', reason: 'completed' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
