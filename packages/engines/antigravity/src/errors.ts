import { classifyByRules, type ErrorRule } from '@harness-x/kernel';
import type { EngineErrorCode } from '@harness-x/protocol';

const RULES: ErrorRule[] = [
  [
    /unauthenticated|unauthori[sz]ed|not (logged|signed) in|log ?in required|sign ?in|login|auth(entication)? required|credentials|\b401\b|permission_denied.*token/i,
    'auth_required',
  ],
  [/quota|resource_exhausted|usage limit|limit reached|out of credits/i, 'quota_exceeded'],
  [/rate.?limit|too many requests|\b429\b|overloaded|unavailable|\b503\b/i, 'rate_limited', true],
  [/network|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|deadline.exceeded|timed out|connection/i, 'network', true],
  [/invalid_argument|invalid request|bad request|\b400\b|unknown model/i, 'invalid_request'],
];

export function classifyAgyError(text: string): { code: EngineErrorCode; retryable: boolean } {
  return classifyByRules(text, RULES);
}

/** 16.4 헤드리스 미로그인 안내 */
export const AGY_LOGIN_HINT =
  '터미널에서 `agy`를 한 번 실행해 로그인한 뒤 다시 시도하세요 (헤드리스 -p 모드에서는 로그인할 수 없습니다)';

export interface AgyStructuredError {
  code?: string;
  message?: string;
  [k: string]: unknown;
}

/** 16.2 `AGY_ERROR: {...}` 줄 파싱 (없으면 undefined) */
export function parseAgyErrorLine(line: string): AgyStructuredError | undefined {
  const m = /AGY_ERROR:\s*(\{.*\})\s*$/.exec(line);
  if (!m) return undefined;
  try {
    const v = JSON.parse(m[1]!) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as AgyStructuredError) : undefined;
  } catch {
    return { message: m[1] };
  }
}

/** 구조화 에러 → 분류 (code 필드 우선, 없으면 메시지) */
export function classifyAgyStructured(e: AgyStructuredError): { code: EngineErrorCode; retryable: boolean } {
  const byCode = e.code ? classifyAgyError(String(e.code)) : undefined;
  if (byCode && byCode.code !== 'unknown') return byCode;
  return classifyAgyError(`${e.message ?? ''} ${e.type ?? ''} ${e.status ?? ''}`);
}
