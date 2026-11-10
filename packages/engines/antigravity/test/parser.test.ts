import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { eventFactory } from '@harness-x/kernel';
import { HarnessEventSchema } from '@harness-x/protocol';
import { describe, expect, it } from 'vitest';
import { classifyAgyStructured, parseAgyErrorLine } from '../src/errors.js';
import { AgyStreamParser } from '../src/parser.js';

const fx = (n: string) => readFileSync(fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url)), 'utf8');

function replay(name: string) {
  const p = new AgyStreamParser();
  const bodies = fx(name)
    .split('\n')
    .flatMap((l) => p.line(l));
  return { p, bodies };
}

describe('16.2 출력 파서 (실제 녹화 리플레이)', () => {
  it('hi.real.jsonl: text_delta → partial + final, usage, turn_end', () => {
    const { p, bodies } = replay('hi.real.jsonl');
    expect(p.sessionId()).toBe('f121ee74-e0ce-4faa-bb1d-4516d573aa23');
    expect(bodies).toEqual([
      { type: 'assistant_text', text: 'hi', partial: true },
      { type: 'assistant_text', text: 'hi', partial: false },
      { type: 'usage', inputTokens: 6836, outputTokens: 5, cacheReadTokens: 0 },
      { type: 'turn_end', reason: 'completed' },
    ]);
  });

  it('tool-denied.real.jsonl: tool_call → 헤드리스 자동 거부(denied_actions) → tool_result ok=false', () => {
    const { bodies } = replay('tool-denied.real.jsonl');
    expect(bodies).toEqual([
      {
        type: 'tool_call',
        callId: 'accf46a4-0c0d-4752-adc9-4276afe13310:2',
        tool: 'run_command',
        input: { CommandLine: 'ls -la' },
      },
      {
        type: 'tool_result',
        callId: 'accf46a4-0c0d-4752-adc9-4276afe13310:2',
        ok: false,
        output: { denied: true },
      },
      { type: 'usage', inputTokens: 6848, outputTokens: 68, cacheReadTokens: 0 },
      { type: 'turn_end', reason: 'completed' },
    ]);
    const ev = eventFactory({ sessionId: 's1', engineId: 'antigravity' });
    for (const b of [...bodies, ...replay('hi.real.jsonl').bodies])
      expect(() => HarnessEventSchema.parse(ev(b))).not.toThrow();
  });

  it('거부되지 않은 도구는 ok=true', () => {
    const p = new AgyStreamParser();
    const step = (state: string) =>
      JSON.stringify({
        event: 'step_update',
        step_update: {
          conversation_id: 'c1',
          step_index: 3,
          state,
          step_type: 'tool',
          tool_name: 'view_file',
          tool_info: { name: 'view_file', parameters: { AbsolutePath: '/w/a.txt' } },
        },
      });
    expect(p.line(step('ACTIVE'))).toEqual([
      { type: 'tool_call', callId: 'c1:3', tool: 'view_file', input: { AbsolutePath: '/w/a.txt' } },
    ]);
    expect(p.line(step('DONE'))).toEqual([]);
    const end = p.line(
      JSON.stringify({ event: 'result', result: { conversation_id: 'c1', status: 'SUCCESS', usage: {} } }),
    );
    expect(end[0]).toEqual({ type: 'tool_result', callId: 'c1:3', ok: true, output: null });
  });
});

describe('16.2 AGY_ERROR: {...} 구조화 에러 분류', () => {
  const samples = fx('agy-errors.txt').split('\n').filter(Boolean);
  it.each([
    [0, 'auth_required'],
    [1, 'quota_exceeded'],
    [2, 'rate_limited'],
    [3, 'invalid_request'],
    [4, 'network'],
    [5, 'unknown'],
  ] as const)('샘플 %i → %s', (i, code) => {
    const e = parseAgyErrorLine(samples[i]!);
    expect(e).toBeDefined();
    expect(classifyAgyStructured(e!).code).toBe(code);
  });

  it('stdout·stderr 어느 쪽 AGY_ERROR든 error 이벤트, 결과 없이 종료되면 turn_end(error)', () => {
    const p = new AgyStreamParser();
    expect(p.stderrLine(samples[1]!)).toEqual([
      {
        type: 'error',
        code: 'quota_exceeded',
        message: 'Quota exceeded for model gemini-3-pro. Resets in 3h.',
        retryable: false,
      },
    ]);
    expect(p.line(samples[2]!)).toEqual([]); // 첫 오류만
    expect(p.finish(1, '')).toEqual([{ type: 'turn_end', reason: 'error' }]);
  });

  it('AGY_ERROR가 아닌 줄은 undefined, 깨진 JSON은 message로', () => {
    expect(parseAgyErrorLine('hello')).toBeUndefined();
    expect(parseAgyErrorLine('AGY_ERROR: {oops}')).toEqual({ message: '{oops}' });
  });

  it('result status가 SUCCESS가 아니면 error + turn_end(error)', () => {
    const p = new AgyStreamParser();
    const out = p.line(
      JSON.stringify({ event: 'result', result: { status: 'ERROR', error: 'model overloaded', usage: {} } }),
    );
    expect(out.slice(-2)).toEqual([
      { type: 'error', code: 'rate_limited', message: 'model overloaded', retryable: true },
      { type: 'turn_end', reason: 'error' },
    ]);
  });
});
