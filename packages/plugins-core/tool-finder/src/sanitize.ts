import { SECRET_PATTERNS } from '@harness-x/kernel';

/**
 * P3-B.3 검색어에는 능력 설명만. 코드·파일 내용·경로·주소·비밀은 들어가지 않는다.
 * - 줄바꿈 이후(붙여 넣은 내용)는 버린다
 * - 비밀 패턴·경로·주소·이메일·코드 기호가 섞인 낱말은 버린다
 * - 80자로 자른다
 * 남는 게 없으면 SearchQueryError (검색하지 않는다)
 */

export const MAX_QUERY_CHARS = 80;

export class SearchQueryError extends Error {
  readonly code = 'UNSAFE_QUERY';
  constructor(message = '찾을 내용을 쉬운 말로 짧게 적어 주세요.') {
    super(message);
    this.name = 'SearchQueryError';
  }
}

const CODE_CHARS = /[{}[\]<>;=`$\\|]|=>|::|\(\)/;
const PATH_LIKE =
  /^(~|\.{1,2})?[/\\]|^[A-Za-z]:[\\/]|[/\\].*[/\\]|\.(ts|js|py|json|ya?ml|env|pem|key|txt|md|cfg|ini|toml)$/i;
const URL_LIKE = /^[a-z][a-z0-9+.-]*:\/\/|^www\./i;
const EMAIL = /\S+@\S+\.\S+/;
/** 키처럼 생긴 긴 무작위 문자열 */
const KEYISH = /^[A-Za-z0-9_\-+/=]{24,}$/;

function isSecret(word: string): boolean {
  return SECRET_PATTERNS.some(({ re }) => new RegExp(re.source, re.flags.replace('g', '')).test(word));
}

/** 낱말 하나가 검색어로 괜찮은가 */
export function isSafeWord(w: string): boolean {
  if (!w) return false;
  if (isSecret(w) || KEYISH.test(w)) return false;
  if (CODE_CHARS.test(w) || PATH_LIKE.test(w) || URL_LIKE.test(w) || EMAIL.test(w)) return false;
  return true;
}

/** 능력 설명 → 안전한 검색어 */
export function sanitizeQuery(capability: string): string {
  const firstLine = capability.normalize('NFC').split(/\r?\n/)[0] ?? '';
  const words = firstLine
    .split(/\s+/)
    .map((w) => w.replace(/^["'“”‘’(]+|["'“”‘’),.!?]+$/g, ''))
    .filter(isSafeWord);
  let q = words.join(' ').trim();
  if (q.length > MAX_QUERY_CHARS) q = q.slice(0, MAX_QUERY_CHARS).replace(/\s+\S*$/, '');
  if (q.length < 2) throw new SearchQueryError();
  return q;
}

/** 공급자로 나가기 직전 마지막 검사 (sanitizeQuery를 거치지 않은 값이면 거부) */
export function assertSafeQuery(q: string): string {
  if (q.length > MAX_QUERY_CHARS || /\r|\n/.test(q) || !q.split(/\s+/).every(isSafeWord))
    throw new SearchQueryError('검색어에 능력 설명이 아닌 내용이 섞여 있어요.');
  return q;
}
