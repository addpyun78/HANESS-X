import { classifyByRules, type ErrorRule } from '@harness-x/kernel';
import type { EngineErrorCode } from '@harness-x/protocol';

/**
 * 14.5 claude 오류 문구 분류
 * 구독 한도 초과 → quota_exceeded, 로그인/키 문제 → auth_required
 */
const RULES: ErrorRule[] = [
  [
    /usage limit reached|hit your (usage )?limit|out of extra usage|limit reached\s*[|∙·]|credit balance is too low|billing_error|spend limit/i,
    'quota_exceeded',
  ],
  [
    /invalid api key|please run \/login|not logged in|log ?in again|oauth token (has )?expired|authentication_error|authentication_failed|invalid bearer token|token revoked|unauthorized|\b401\b/i,
    'auth_required',
  ],
  [/rate_limit|rate limit|too many requests|\b429\b|overloaded|\b529\b/i, 'rate_limited', true],
  [
    /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|network|fetch failed|connection error|socket hang up/i,
    'network',
    true,
  ],
  [/invalid_request|prompt is too long|context (window|length)|max_tokens/i, 'invalid_request'],
];

export function classifyClaudeError(text: string): { code: EngineErrorCode; retryable: boolean } {
  return classifyByRules(text, RULES);
}

/** assistant 메시지의 error 필드 (예: "authentication_failed", "rate_limit", "billing_error") */
export function classifyClaudeErrorField(field: string): EngineErrorCode {
  switch (field) {
    case 'authentication_failed':
      return 'auth_required';
    case 'billing_error':
      return 'quota_exceeded';
    case 'rate_limit':
      return 'rate_limited';
    case 'invalid_request':
      return 'invalid_request';
    default:
      return classifyClaudeError(field).code;
  }
}
