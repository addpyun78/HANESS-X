import { asText, result, type Comparator } from '../types.js';
import { normalizeText, type TextOptions } from './text.js';

/**
 * C.11 regex — 기존 정규식(기대값)을 정규화된 실제 텍스트에 적용한다.
 * 실제 텍스트는 text 정규화(CRLF→LF, 줄 끝 공백·마지막 빈 줄 제거, NFC)를 거친다.
 * 정규식 자체가 공백 개수를 셀 수 있으므로 collapseSpaces는 기본 꺼짐.
 * 기대값은 `pattern` 또는 `/pattern/flags` 형태. flags 옵션으로 덧붙일 수 있다.
 */
export interface RegexOptions extends TextOptions {
  flags?: string;
}

export function parsePattern(p: string, extraFlags = ''): RegExp {
  const m = /^\/([\s\S]*)\/([dgimsuvy]*)$/.exec(p);
  const source = m ? m[1]! : p;
  const flags = [...new Set([...(m ? m[2]! : ''), ...extraFlags])]
    .filter((f) => f !== 'g' && f !== 'y')
    .join('');
  return new RegExp(source, flags);
}

export const regexComparator: Comparator<RegexOptions> = {
  kind: 'regex',
  normalize: (v, _ctx, o = {}) => normalizeText(asText(v), { collapseSpaces: false, ...o }),
  equals(a, b, _ctx, o = {}) {
    let re: RegExp;
    try {
      re = parsePattern(asText(a), o.flags ?? '');
    } catch (err) {
      return result(
        'different',
        'normalize',
        `정규식 오류: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const text = normalizeText(asText(b), { collapseSpaces: false, ...o });
    if (re.test(text)) return result('equal', 'normalize', `정규화된 출력이 정규식 ${re} 와 일치`);
    return result('different', 'normalize', `정규화된 출력이 정규식 ${re} 와 일치하지 않음`, {
      diff: { at: 'regex', expected: String(re), actual: text.slice(0, 200) },
    });
  },
};
