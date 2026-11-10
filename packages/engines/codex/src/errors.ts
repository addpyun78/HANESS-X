import { classifyByRules, type ErrorRule } from '@harness-x/kernel';
import type { EngineErrorCode } from '@harness-x/protocol';

const RULES: ErrorRule[] = [
  [
    /usage limit|usageLimitExceeded|hit your (usage )?limit|quota|insufficient_quota|sessionBudgetExceeded/i,
    'quota_exceeded',
  ],
  [
    /unauthorized|\b401\b|invalid_jwt|refresh token|sign(ing)? in again|log ?in again|not logged in|codex login|authentication/i,
    'auth_required',
  ],
  [/rate.?limit|too many requests|\b429\b|server ?overloaded/i, 'rate_limited', true],
  [
    /stream disconnected|error sending request|connection (failed|refused|reset)|network|timed out|ENOTFOUND|ECONNREFUSED/i,
    'network',
    true,
  ],
  [/context ?window|bad ?request|\b400\b|invalid_request/i, 'invalid_request'],
];

export function classifyCodexError(text: string): { code: EngineErrorCode; retryable: boolean } {
  return classifyByRules(text, RULES);
}

/** app-server TurnError.codexErrorInfo → 분류 코드 */
export function classifyCodexErrorInfo(info: unknown): EngineErrorCode | undefined {
  const key =
    typeof info === 'string' ? info : info && typeof info === 'object' ? Object.keys(info)[0] : undefined;
  switch (key) {
    case 'usageLimitExceeded':
    case 'sessionBudgetExceeded':
      return 'quota_exceeded';
    case 'unauthorized':
      return 'auth_required';
    case 'rateLimitExceeded':
    case 'serverOverloaded':
      return 'rate_limited';
    case 'httpConnectionFailed':
    case 'responseStreamConnectionFailed':
    case 'responseStreamDisconnected':
    case 'responseTooManyFailedAttempts':
      return 'network';
    case 'contextWindowExceeded':
    case 'badRequest':
      return 'invalid_request';
    case 'internalServerError':
    case 'sandboxError':
    case 'other':
      return 'unknown';
    default:
      return undefined;
  }
}
