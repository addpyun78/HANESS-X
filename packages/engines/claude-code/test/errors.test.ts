import { describe, expect, it } from 'vitest';
import { classifyClaudeError, classifyClaudeErrorField } from '../src/errors.js';
import { ClaudeStreamParser } from '../src/parser.js';

describe('14.5 claude 오류 분류', () => {
  it.each([
    ['Claude AI usage limit reached|1794330600', 'quota_exceeded'],
    ["You've hit your limit · resets 3pm (Asia/Seoul)", 'quota_exceeded'],
    ["You're out of extra usage · resets Nov 12", 'quota_exceeded'],
    ['Credit balance is too low', 'quota_exceeded'],
    ['Invalid API key · Please run /login', 'auth_required'],
    ['Not logged in · Please run /login', 'auth_required'],
    ['OAuth token has expired. Please obtain a new token or refresh your existing token.', 'auth_required'],
    [
      'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
      'auth_required',
    ],
    ['API Error: 429 {"type":"error","error":{"type":"rate_limit_error"}}', 'rate_limited'],
    [
      'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
      'rate_limited',
    ],
    ['API Error: Connection error. (ECONNREFUSED)', 'network'],
    ['Prompt is too long', 'invalid_request'],
    ['something odd happened', 'unknown'],
  ])('%s → %s', (text, code) => {
    expect(classifyClaudeError(text).code).toBe(code);
  });

  it('rate_limited·network는 retryable', () => {
    expect(classifyClaudeError('429 rate_limit_error').retryable).toBe(true);
    expect(classifyClaudeError('Not logged in').retryable).toBe(false);
  });

  it('assistant error 필드 분류', () => {
    expect(classifyClaudeErrorField('authentication_failed')).toBe('auth_required');
    expect(classifyClaudeErrorField('billing_error')).toBe('quota_exceeded');
    expect(classifyClaudeErrorField('rate_limit')).toBe('rate_limited');
  });

  it('result 오류 문구가 모호하면 assistant error 필드로 분류', () => {
    const p = new ClaudeStreamParser();
    p.line(
      JSON.stringify({
        type: 'assistant',
        error: 'billing_error',
        message: { content: [{ type: 'text', text: 'Request failed' }] },
      }),
    );
    const out = p.line(
      JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Request failed' }),
    );
    expect(out).toContainEqual(expect.objectContaining({ type: 'error', code: 'quota_exceeded' }));
  });

  it('구독 한도 초과 result → quota_exceeded + turn_end(error)', () => {
    const p = new ClaudeStreamParser();
    const out = p.line(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: true,
        result: "You've hit your limit · resets 3pm",
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
    );
    expect(out.slice(-2)).toEqual([
      {
        type: 'error',
        code: 'quota_exceeded',
        message: "You've hit your limit · resets 3pm",
        retryable: false,
      },
      { type: 'turn_end', reason: 'error' },
    ]);
  });

  it('result 없이 stderr만 남기고 죽으면 stderr로 분류', () => {
    const p = new ClaudeStreamParser();
    expect(p.finish(1, 'Error: Invalid API key · Please run /login')[0]).toMatchObject({
      type: 'error',
      code: 'auth_required',
    });
  });
});
