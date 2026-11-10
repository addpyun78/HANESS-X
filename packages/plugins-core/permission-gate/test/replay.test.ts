import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runAgentLoop, type ChatMessage, type ModelClient, type ModelRequest } from '@harness-x/kernel';
import type { HarnessEvent } from '@harness-x/protocol';
import { gateFixture, type GateFixture } from './helpers.js';

/**
 * 24.4 매칭 성공·경로 다름 → 정식 경로로 고쳐 쓰라는 deny + reason, 엔진이 두 번째 시도에서 정식 경로 사용.
 * 리플레이: 커널 도구 루프(runAgentLoop)에 스크립트된 가짜 모델을 붙인다.
 * 1회차: 표시 이름 경로(하네스/모바일/a.kt)로 write_file → 게이트 deny
 * 2회차: 직전 tool 메시지의 "canonical path: …"를 읽어 그 경로로 다시 write_file → 허용
 * 3회차: 도구 호출 없이 종료
 */
function scriptedModel(): ModelClient & { requests: ChatMessage[][] } {
  const requests: ChatMessage[][] = [];
  let n = 0;
  return {
    requests,
    async complete(req: ModelRequest) {
      requests.push(req.messages);
      n++;
      if (n === 1)
        return {
          text: '',
          toolCalls: [
            {
              id: 'c1',
              name: 'write_file',
              arguments: { path: '하네스/모바일/a.kt', content: 'fun main() {}\n' },
            },
          ],
        };
      if (n === 2) {
        const last = req.messages.at(-1);
        const m = last?.role === 'tool' ? /canonical path: (\S+)/.exec(last.content) : null;
        if (!m) return { text: 'no canonical path given', toolCalls: [] };
        return {
          text: '',
          toolCalls: [
            { id: 'c2', name: 'write_file', arguments: { path: m[1], content: 'fun main() {}\n' } },
          ],
        };
      }
      return { text: 'done', toolCalls: [] };
    },
  };
}

describe('24.4 path_mismatch deny → 엔진 재시도 (replay)', () => {
  let f: GateFixture;
  afterEach(() => f.cleanup());

  it('두 번째 시도에서 정식 경로 harness/mobile/a.kt에 쓴다', async () => {
    f = gateFixture();
    f.lockPlan();
    const client = scriptedModel();
    const events: HarnessEvent[] = [];
    for await (const e of runAgentLoop({
      client,
      sessionId: 's1',
      cwd: f.ws,
      prompt: '모바일 앱 main 작성',
      hooks: f.bus,
    }))
      events.push(e);

    const results = events.filter((e) => e.type === 'tool_result');
    expect(results).toHaveLength(2);
    const first = results[0] as Extract<HarnessEvent, { type: 'tool_result' }>;
    expect(first.ok).toBe(false);
    expect(first.output).toMatchObject({
      denied: true,
      decision: 'deny',
      hookId: 'permission-gate:plan-gate',
    });
    expect(String((first.output as { reason: string }).reason)).toContain(
      'canonical path: harness/mobile/a.kt',
    );
    expect((results[1] as { ok: boolean }).ok).toBe(true);

    const toolMsg = client.requests[1]!.at(-1)!;
    expect(toolMsg.role).toBe('tool');
    expect(events.filter((e) => e.type === 'file_change')).toMatchObject([
      { path: 'harness/mobile/a.kt', change: 'create' },
    ]);
    expect(readFileSync(join(f.ws, 'harness/mobile/a.kt'), 'utf8')).toBe('fun main() {}\n');
    expect(existsSync(join(f.ws, '하네스'))).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', reason: 'completed' });
  });

  it('쓰기형 Bash도 정식 경로를 알려 준다', async () => {
    f = gateFixture();
    f.lockPlan();
    const r = await f.tool('Bash', { command: 'mkdir -p 하네스/모바일 && echo x > 하네스/모바일/b.kt' });
    expect(r.decision).toBe('deny');
    expect(r.reason).toMatch(/^path_mismatch/);
    expect(r.reason).toContain('canonical path: harness/mobile/b.kt');
    expect(r.reason).toContain('canonical path: harness/mobile');
  });
});
