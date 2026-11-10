import { glossaryIndex, normalizeWord, type Glossary, type GlossaryIndex } from './glossary.js';

/**
 * 이름 정책 (22.2): 표시 이름(한글 허용) → 정식 경로(영문 kebab-case).
 * - 구분자 / 또는 \ 로 경로 조각을 나눈다.
 * - 조각을 단어로 쪼갠다: 공백·_·-·., camelCase 경계, 한글↔영문 경계.
 * - 각 단어는 glossary가 우선. 띄어쓰기 없는 한글 합성어는 glossary 별칭 최장 일치로 분해한다.
 * - glossary에 없는 영문 단어는 소문자로, 없는 한글 단어는 unknown으로 모은다(Lock 단계에서 사용자 확인).
 */

export interface NamingOptions {
  /** 'file'이면 마지막 조각의 확장자(.kt 등)를 보존 */
  kind?: 'file' | 'dir';
  /** glossary에 없는 단어 → 영문 이름 (사용자 응답) */
  overrides?: Record<string, string>;
}

export interface SegmentResult {
  /** 변환된 조각 (unknown 단어는 NFC 원문 그대로 남는다) */
  value: string;
  /** glossary·overrides에 없는 비라틴 단어 */
  unknown: string[];
}

export interface PathResult {
  /** unknown이 없으면 정식 경로, 있으면 null */
  path: string | null;
  /** unknown을 원문 그대로 둔 경로 (진단·비교용) */
  partial: string;
  unknown: string[];
}

const SPLIT_RE = /[\s_\-.·]+/u;

/** 조각을 단어 단위로 쪼갠다 */
export function splitWords(segment: string): string[] {
  return segment
    .normalize('NFC')
    .split(SPLIT_RE)
    .flatMap((w) =>
      w
        // 한글 ↔ 라틴/숫자 경계
        .replace(/(\p{Script=Hangul})(?=[A-Za-z0-9])|([A-Za-z0-9])(?=\p{Script=Hangul})/gu, '$1$2 ')
        // camelCase / PascalCase / 약어 경계 (APIServer → API Server)
        .replace(/([a-z0-9])(?=[A-Z])|([A-Z])(?=[A-Z][a-z])/g, '$1$2 ')
        .split(' '),
    )
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
}

/** 한글 합성어를 glossary 별칭 최장 일치로 분해. 완전히 분해되지 않으면 null */
function decompose(word: string, idx: GlossaryIndex): string[] | null {
  const out: string[] = [];
  let rest = normalizeWord(word);
  while (rest.length > 0) {
    const hit = idx.hangulAliases.find((a) => rest.startsWith(a));
    if (!hit) return null;
    out.push(idx.lookup(hit)!);
    rest = rest.slice(hit.length);
  }
  return out;
}

function mapWord(word: string, idx: GlossaryIndex, overrides: Record<string, string>): string | null {
  const ov = overrides[word] ?? overrides[normalizeWord(word)];
  if (ov) return toKebab(ov);
  const hit = idx.lookup(word);
  if (hit) return hit;
  if (/^[A-Za-z0-9]+$/.test(word)) return word.toLowerCase();
  if (/^[\p{Script=Hangul}]+$/u.test(word)) {
    const parts = decompose(word, idx);
    if (parts) return parts.join('-');
  }
  return null;
}

function toKebab(s: string): string {
  return splitWords(s)
    .map((w) => w.toLowerCase())
    .join('-');
}

/** 경로 조각 1개 변환 (판정 사다리 L2도 이 함수로 양쪽을 같은 형태로 만든다) */
export function canonicalizeSegment(
  segment: string,
  glossary: Glossary | GlossaryIndex,
  overrides: Record<string, string> = {},
): SegmentResult {
  const idx = glossaryIndex(glossary);
  const unknown: string[] = [];
  const words = splitWords(segment).map((w) => {
    const m = mapWord(w, idx, overrides);
    if (m === null) {
      unknown.push(w);
      return w.toLowerCase();
    }
    return m;
  });
  return { value: words.join('-'), unknown };
}

/** 표시 이름 → 정식 경로 */
export function toCanonicalPath(
  displayName: string,
  glossary: Glossary | GlossaryIndex,
  opts: NamingOptions = {},
): PathResult {
  const segs = displayName
    .normalize('NFC')
    .split(/[\\/]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const unknown: string[] = [];
  const out = segs.map((seg, k) => {
    let base = seg;
    let ext = '';
    if (opts.kind === 'file' && k === segs.length - 1) {
      const m = /^(.+?)(\.[A-Za-z0-9]+)$/.exec(seg);
      if (m) {
        base = m[1]!;
        ext = m[2]!.toLowerCase();
      }
    }
    const r = canonicalizeSegment(base, glossary, opts.overrides);
    unknown.push(...r.unknown);
    return r.value + ext;
  });
  const partial = out.join('/');
  const uniq = [...new Set(unknown)];
  return { path: uniq.length === 0 ? partial : null, partial, unknown: uniq };
}
