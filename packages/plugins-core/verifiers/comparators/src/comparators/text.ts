import {
  asText,
  inDictionary,
  result,
  type CompareCtx,
  type CompareDiff,
  type Comparator,
} from '../types.js';
import { numberConflict, statusConflict } from '../guards.js';

/**
 * C.4~C.6 text
 * 정규화: CRLF·CR → LF, 줄 끝 공백 제거, 마지막 빈 줄 제거, NFC, 연속 공백 1개(collapseSpaces 기본 켜짐),
 *        ignoreCase(기본 꺼짐)면 소문자.
 * 모드: equals(전체 일치) / contains(실제값 안에 기대값) / lines(줄 단위, ignoreOrder면 순서 무시)
 * 정규화·사전으로 같다고 못 하면 uncertain → 의미 판단 칸에 넘긴다.
 */
export interface TextOptions {
  mode?: 'equals' | 'contains' | 'lines';
  /** lines 모드에서 줄 순서 무시 (기본 false) */
  ignoreOrder?: boolean;
  /** 연속 공백·탭을 공백 1개로 (기본 true) */
  collapseSpaces?: boolean;
  /** 대소문자 무시 (기본 false) */
  ignoreCase?: boolean;
  [k: string]: unknown;
}

const HSPACE = /[ \t\f\v\u00a0]/u;

export function normalizeText(input: string, opts: TextOptions = {}): string {
  let lines = input
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(new RegExp(`${HSPACE.source}+$`, 'u'), ''));
  if (opts.collapseSpaces ?? true)
    lines = lines.map((l) => l.replace(new RegExp(`${HSPACE.source}{2,}`, 'gu'), ' '));
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const s = lines.join('\n');
  return opts.ignoreCase ? s.toLowerCase() : s;
}

function firstDiffLine(a: string, b: string): CompareDiff {
  const al = a.split('\n');
  const bl = b.split('\n');
  for (let k = 0; k < Math.max(al.length, bl.length); k++)
    if (al[k] !== bl[k]) return { at: `line ${k + 1}`, expected: al[k], actual: bl[k] };
  return { at: 'text' };
}

export const textComparator: Comparator<TextOptions> = {
  kind: 'text',
  normalize: (v, _ctx, o) => normalizeText(asText(v), o),
  equals(a, b, ctx: CompareCtx, o: TextOptions = {}) {
    const mode = o.mode ?? 'equals';
    const na = normalizeText(asText(a), o);
    const nb = normalizeText(asText(b), o);
    const norm = (s: string) => normalizeText(s, o);
    if (mode === 'contains') {
      if (nb.includes(na)) return result('equal', 'normalize', '정규화 후 실제 출력에 기대 문구 포함');
      return result('uncertain', 'normalize', '정규화 후 실제 출력에 기대 문구 없음 — 의미 판단 필요', {
        diff: { at: 'contains', expected: na },
      });
    }
    if (mode === 'lines') {
      const al = na.split('\n');
      const bl = nb.split('\n');
      const same = o.ignoreOrder
        ? al.length === bl.length && [...al].sort().join('\n') === [...bl].sort().join('\n')
        : na === nb;
      if (same)
        return result('equal', 'normalize', `정규화 후 줄 일치${o.ignoreOrder ? ' (순서 무시)' : ''}`);
      const missing = al.filter((l) => !bl.includes(l));
      return result('uncertain', 'normalize', `줄이 다름 (빠진 줄 ${missing.length}개) — 의미 판단 필요`, {
        diff: o.ignoreOrder ? { at: 'lines', expected: missing.slice(0, 5) } : firstDiffLine(na, nb),
      });
    }
    if (na === nb) return result('equal', 'normalize', '정규화 후 텍스트 일치');
    if (inDictionary('text', na, nb, ctx, norm))
      return result('equal', 'dictionary', '사전에 등록된 같은 표현');
    // G.2 코드로 확정되는 진짜 틀림 (AI 오판으로 통과하지 않도록 의미 판단 전에 끝낸다)
    const conflict = statusConflict(na, nb) ?? numberConflict(na, nb);
    if (conflict) return result('different', 'normalize', conflict, { diff: firstDiffLine(na, nb) });
    return result('uncertain', 'normalize', '정규화 후에도 텍스트가 다름 — 의미 판단 필요', {
      diff: firstDiffLine(na, nb),
    });
  },
};
