import { maskSecrets, SECRET_PATTERNS } from '@harness-x/kernel';

/**
 * P4-A.9 비밀·코드 제외 필터.
 * 인벤토리의 모든 문자열에 T-004 마스킹(kernel secrets-mask)을 적용하고,
 * 코드 블록(``` … ```)·들여쓴 코드 줄·여러 줄 본문을 지워 한 줄 요약(최대 300자)만 남긴다.
 * 필드 이름은 스키마가 정한 것뿐이라 그대로 둔다.
 */

export const MAX_TEXT = 300;

/** 비밀처럼 보이는 키=값 (password=…, token: … 등) */
const KEY_VALUE_SECRET = /\b(api[_-]?key|token|secret|password|passwd|authorization)\b\s*[:=]\s*\S+/gi;
/** 코드 펜스 (닫히지 않았으면 끝까지) */
const CODE_FENCE = /```[\s\S]*?(```|$)/g;
/** 들여쓴 코드 줄 (4칸·탭) */
const INDENTED_CODE = /(^|\n)( {4}|\t)[^\n]*/g;

export function sanitizeText(s: string): string {
  let out = s.replace(CODE_FENCE, ' ').replace(INDENTED_CODE, ' ');
  out = maskSecrets(out).replace(KEY_VALUE_SECRET, (_m, k: string) => `${k}=[REDACTED]`);
  out = out.replace(/`/g, '').replace(/\s+/g, ' ').trim();
  return out.length > MAX_TEXT ? out.slice(0, MAX_TEXT - 1) + '…' : out;
}

/** 값 전체를 정리한 복사본 (문자열만 바뀐다) */
export function sanitizeDeep<T>(value: T): T {
  if (typeof value === 'string') return sanitizeText(value) as T;
  if (Array.isArray(value)) return value.map((v) => sanitizeDeep(v)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = sanitizeDeep(v);
    return out as T;
  }
  return value;
}

/** 직렬화된 인벤토리에 비밀 패턴·코드 블록이 남았는지 (테스트·방어용) */
export function findLeaks(json: string): string[] {
  const leaks: string[] = [];
  for (const { name, re } of SECRET_PATTERNS) {
    if (new RegExp(re.source, re.flags.replace('g', '')).test(json)) leaks.push(`secret:${name}`);
  }
  if (json.includes('```')) leaks.push('code-fence');
  return leaks;
}
