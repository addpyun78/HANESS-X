import { result, type Comparator } from '../types.js';

/** 종료코드 값 → 정수 (정규화 없음: 숫자 또는 공백 없는 정수 문자열만) */
function toCode(v: unknown): number | null {
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return Number(v);
  return null;
}

/** C.12 exitCode — 숫자 비교, 정규화 없음. 의미 판단으로 넘기지 않는다 */
export const exitCodeComparator: Comparator = {
  kind: 'exitCode',
  normalize: (v) => {
    const c = toCode(v);
    return c === null ? String(v) : String(c);
  },
  equals(a, b) {
    const ea = toCode(a);
    const eb = toCode(b);
    if (ea === null || eb === null)
      return result(
        'different',
        'normalize',
        `종료코드가 정수가 아님 (기대 ${String(a)}, 실제 ${String(b)})`,
      );
    if (ea === eb) return result('equal', 'normalize', `종료코드 ${eb}`);
    return result('different', 'normalize', `종료코드 ${eb} (기대 ${ea})`, {
      diff: { at: 'exitCode', expected: ea, actual: eb },
    });
  },
};
