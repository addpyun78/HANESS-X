/**
 * 비밀 마스킹 필터 — 이벤트 로그에 쓰기 전에 적용한다.
 * 키 원문은 디스크·로그 어디에도 남기지 않는다.
 */

export interface SecretPattern {
  name: string;
  re: RegExp;
}

export const SECRET_PATTERNS: readonly SecretPattern[] = [
  // Anthropic (sk-ant-...), OpenAI (sk-..., sk-proj-...), 기타 sk- 계열
  { name: 'sk', re: /\bsk-[A-Za-z0-9_-]{16,}/g },
  // Google API 키
  { name: 'google', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  // GitHub 토큰
  { name: 'github', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g },
  { name: 'github', re: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g },
  // Slack 토큰
  { name: 'slack', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  // AWS 액세스 키
  { name: 'aws', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  // Bearer 헤더
  { name: 'bearer', re: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/g },
];

export function maskSecrets(text: string): string {
  let out = text;
  for (const { name, re } of SECRET_PATTERNS) {
    out = out.replace(re, `[REDACTED:${name}]`);
  }
  return out;
}

/** 값 전체(객체·배열 포함)의 문자열을 마스킹한 복사본 */
export function maskDeep<T>(value: T): T {
  if (typeof value === 'string') return maskSecrets(value) as T;
  if (Array.isArray(value)) return value.map((v) => maskDeep(v)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[maskSecrets(k)] = maskDeep(v);
    return out as T;
  }
  return value;
}
