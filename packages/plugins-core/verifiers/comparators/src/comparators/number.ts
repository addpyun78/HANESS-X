import { asText, result, type Comparator } from '../types.js';

/**
 * C.9 number — 천 단위 구분자(`,` `_` 공백 `'`) 제거, 앞뒤 공백 제거, 허용 오차 tolerance(기본 0, 절댓값)
 * 숫자로 읽을 수 없으면 uncertain(의미 판단으로).
 */
export interface NumberOptions {
  tolerance?: number;
  [k: string]: unknown;
}

const NUM_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
const GROUPED_RE = /^[+-]?\d{1,3}([,_' ]\d{3})+(\.\d+)?$/;

/** 문자열 → 숫자 (실패하면 null) */
export function parseNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = asText(v).normalize('NFKC').trim();
  const plain = GROUPED_RE.test(s) ? s.replace(/[,_' ]/g, '') : s;
  if (!NUM_RE.test(plain)) return null;
  const n = Number(plain);
  return Number.isFinite(n) ? n : null;
}

export const numberComparator: Comparator<NumberOptions> = {
  kind: 'number',
  normalize(v) {
    const n = parseNumber(v);
    return n === null ? asText(v).trim() : String(n);
  },
  equals(a, b, _ctx, o = {}) {
    const na = parseNumber(a);
    const nb = parseNumber(b);
    if (na === null || nb === null)
      return result(
        'uncertain',
        'normalize',
        `숫자로 읽을 수 없음 (기대 ${asText(a)}, 실제 ${asText(b)}) — 의미 판단 필요`,
      );
    const tol = Math.abs(o.tolerance ?? 0);
    const diff = Math.abs(na - nb);
    if (diff <= tol)
      return result(
        'equal',
        'normalize',
        tol > 0 ? `숫자 일치 (차이 ${diff} ≤ 허용 ${tol})` : `숫자 일치 (${nb})`,
      );
    return result(
      'different',
      'normalize',
      `숫자 다름: ${nb} (기대 ${na}${tol > 0 ? `, 허용 오차 ${tol}` : ''})`,
      {
        diff: { at: 'number', expected: na, actual: nb },
      },
    );
  },
};
