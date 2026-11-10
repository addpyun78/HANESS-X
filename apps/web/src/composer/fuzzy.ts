/**
 * 퍼지 검색 (한글 초성 포함).
 * - 검색어 글자가 대상 안에 순서대로 들어 있으면 일치(부분 순서열), 붙어 있을수록·앞일수록 점수가 높다.
 * - 검색어의 자음(ㄱ~ㅎ)은 대상 음절의 초성과 맞춘다: ㄷㅈㅇ → 디자인, ㄷㅈ인 → 디자인.
 * - 대소문자 무시.
 */

const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;

/** 음절의 초성 (한글 음절이 아니면 undefined) */
export function choseong(ch: string): string | undefined {
  const c = ch.charCodeAt(0);
  if (c < HANGUL_START || c > HANGUL_END) return undefined;
  return CHO[Math.floor((c - HANGUL_START) / 588)];
}

/** 문자열의 초성 문자열 (한글이 아닌 글자는 그대로) */
export function toChoseong(s: string): string {
  return Array.from(s, (ch) => choseong(ch) ?? ch).join('');
}

const isCho = (ch: string) => CHO.includes(ch);

function charMatches(q: string, t: string): boolean {
  if (q === t) return true;
  return isCho(q) && choseong(t) === q;
}

/**
 * 점수 (일치하지 않으면 undefined, 높을수록 좋음).
 * 연속 일치 +보너스, 첫 글자·낱말 시작 일치 +보너스, 빈 칸(건너뛴 글자) −감점.
 */
export function fuzzyScore(query: string, target: string): number | undefined {
  const q = Array.from(query.trim().toLowerCase());
  if (q.length === 0) return 0;
  const t = Array.from(target.toLowerCase());
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (const qc of q) {
    if (qc === ' ') continue;
    while (ti < t.length && !charMatches(qc, t[ti]!)) ti++;
    if (ti >= t.length) return undefined;
    score += 1;
    if (ti === prev + 1) score += 3;
    if (ti === 0 || /[\s\-_/:.]/.test(t[ti - 1]!)) score += 2;
    if (prev >= 0) score -= Math.min(ti - prev - 1, 3) * 0.5;
    prev = ti;
    ti++;
  }
  // 짧은 대상일수록 조금 더
  return score - t.length * 0.01;
}

/** 연속 일치(부분 문자열, 초성 포함) 여부 — 긴 설명문처럼 순서열 일치가 너무 느슨한 필드용 */
export function containsMatch(query: string, target: string): boolean {
  const q = Array.from(query.trim().toLowerCase());
  const t = Array.from(target.toLowerCase());
  if (q.length === 0) return true;
  for (let i = 0; i + q.length <= t.length; i++)
    if (q.every((c, j) => charMatches(c, t[i + j]!))) return true;
  return false;
}

/** 여러 필드 중 가장 좋은 점수 (뒤 필드일수록 가중치를 낮춘다) */
export function bestScore(query: string, fields: readonly (string | undefined)[]): number | undefined {
  let best: number | undefined;
  fields.forEach((f, i) => {
    if (!f) return;
    const s = fuzzyScore(query, f);
    if (s === undefined) return;
    const w = s - i * 0.5;
    if (best === undefined || w > best) best = w;
  });
  return best;
}

/** 점수순 정렬 필터 (같은 점수면 원래 순서) */
export function fuzzyFilter<T>(
  items: readonly T[],
  query: string,
  fields: (x: T) => (string | undefined)[],
): T[] {
  if (!query.trim()) return [...items];
  return items
    .map((x, i) => ({ x, i, s: bestScore(query, fields(x)) }))
    .filter((r): r is { x: T; i: number; s: number } => r.s !== undefined)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((r) => r.x);
}
