import { describe, expect, it } from 'vitest';
import { jsonComparator } from '../src/comparators/json.js';
import { ctx } from './helpers.js';

describe('C.8 json 파싱 실패 → text로 강등 + 사유', () => {
  it('깨진 JSON은 text 비교로, 사유에 강등 표시', () => {
    const r = jsonComparator.equals('{"a":1', '{"a":1\r\n', ctx());
    expect(r).toMatchObject({ verdict: 'equal', level: 'normalize' });
    expect(r.reason).toMatch(/^JSON 해석 실패 기대값\(.+\) → text로 비교: 정규화 후 텍스트 일치$/);
    const r2 = jsonComparator.equals('{"a":1}', 'not json', ctx());
    expect(r2.verdict).toBe('uncertain');
    expect(r2.reason).toMatch(/JSON 해석 실패 실제값/);
    expect(jsonComparator.normalize('{broken  \r\n', ctx())).toBe('{broken');
  });
});
