import { readFileSync } from 'node:fs';
import { eventFactory } from '@harness-x/kernel';
import { HarnessEventSchema } from '@harness-x/protocol';
import { describe, expect, it } from 'vitest';
import { ClaudeStreamParser } from '../src/parser.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

function replay(name: string) {
  const p = new ClaudeStreamParser();
  const bodies = fixture(name)
    .split('\n')
    .flatMap((l) => p.line(l));
  return { p, bodies };
}

describe('14.2 stream-json 리플레이', () => {
  it('hi.real.jsonl (실제 녹화): 텍스트 → usage → turn_end', () => {
    const { p, bodies } = replay('hi.real.jsonl');
    expect(p.sessionId()).toBe('311bf072-baaf-4e15-b501-4a9629e4d3ec');
    expect(bodies).toEqual([
      { type: 'assistant_text', text: 'hi', partial: false },
      {
        type: 'usage',
        inputTokens: 2,
        outputTokens: 48,
        cacheReadTokens: 11266,
        costUsd: 0.14993320000000002,
        quotaRatio: 0.08,
      },
      { type: 'turn_end', reason: 'completed' },
    ]);
  });

  it('tool-write.jsonl: tool_call/tool_result/file_change, 오류 도구 결과 ok=false', () => {
    const { p, bodies } = replay('tool-write.jsonl');
    expect(p.sessionId()).toBe('7c0f4d7e-2a51-4f4e-9d0a-5b1c2e3f4a5b');
    expect(p.initTools).toContain('mcp__harness__checklist.list');
    expect(bodies).toEqual([
      { type: 'assistant_text', text: "I'll create the file.", partial: false },
      {
        type: 'tool_call',
        callId: 'toolu_01Write',
        tool: 'Write',
        input: { file_path: '/tmp/hx-fixture/hello.txt', content: 'hello\n' },
      },
      {
        type: 'tool_result',
        callId: 'toolu_01Write',
        ok: true,
        output: 'File created successfully at: /tmp/hx-fixture/hello.txt',
      },
      { type: 'file_change', path: '/tmp/hx-fixture/hello.txt', change: 'create' },
      {
        type: 'tool_call',
        callId: 'toolu_01Bash',
        tool: 'Bash',
        input: { command: 'cat hello.txt && false', description: 'Show file' },
      },
      { type: 'tool_result', callId: 'toolu_01Bash', ok: false, output: 'hello\nError: Exit code 1' },
      { type: 'assistant_text', text: 'Created hello.txt.', partial: false },
      {
        type: 'usage',
        inputTokens: 10,
        outputTokens: 116,
        cacheReadTokens: 30000,
        costUsd: 0.0412,
        quotaRatio: 0.82,
      },
      { type: 'turn_end', reason: 'completed' },
    ]);
  });

  it('auth-error.jsonl: 미로그인 → error(auth_required) + turn_end(error)', () => {
    const { bodies } = replay('auth-error.jsonl');
    expect(bodies).toEqual([
      { type: 'assistant_text', text: 'Not logged in · Please run /login', partial: false },
      { type: 'usage', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 },
      {
        type: 'error',
        code: 'auth_required',
        message: 'Not logged in · Please run /login',
        retryable: false,
      },
      { type: 'turn_end', reason: 'error' },
    ]);
  });

  it('모든 리플레이 이벤트가 HarnessEvent 스키마 통과', () => {
    const ev = eventFactory({ sessionId: 's1', engineId: 'claude-code', itemId: 'i1' });
    for (const f of ['hi.real.jsonl', 'tool-write.jsonl', 'auth-error.jsonl'])
      for (const b of replay(f).bodies) expect(() => HarnessEventSchema.parse(ev(b))).not.toThrow();
  });

  it('JSON이 아닌 줄·알 수 없는 타입은 무시', () => {
    const p = new ClaudeStreamParser();
    expect(p.line('not json')).toEqual([]);
    expect(p.line('{"type":"stream_event","event":{}}')).toEqual([]);
    expect(p.line('')).toEqual([]);
  });

  it('result 없이 종료되면 finish가 error + turn_end', () => {
    const p = new ClaudeStreamParser();
    expect(p.finish(1, '')).toEqual([
      expect.objectContaining({ type: 'error', code: 'engine_crashed' }),
      { type: 'turn_end', reason: 'error' },
    ]);
  });
});
