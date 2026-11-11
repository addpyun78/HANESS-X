import { asText, result, type Comparator } from '../types.js';

/**
 * C.1 exact — 정규화 없음 (융통성 끄기용).
 * 글자 하나·공백 하나만 달라도 different. 의미 판단으로 넘기지 않는다(uncertain 없음).
 */
export const exactComparator: Comparator = {
  kind: 'exact',
  normalize: (v) => asText(v),
  equals(a, b) {
    const ea = asText(a);
    const eb = asText(b);
    if (ea === eb) return result('equal', 'normalize', '글자 그대로 일치');
    let at = 0;
    while (at < ea.length && at < eb.length && ea[at] === eb[at]) at++;
    return result('different', 'normalize', `글자 그대로 비교에서 다름 (${at}번째 글자부터)`, {
      diff: { at: `char ${at}`, expected: ea.slice(at, at + 40), actual: eb.slice(at, at + 40) },
    });
  },
};
