import { describe, expect, it } from 'vitest';
import { jsonComparator } from '../src/comparators/json.js';
import { ctx } from './helpers.js';

describe('C.7 json 구조 비교', () => {
  it('키 순서만 다름 → equal, 1 = 1.0', () => {
    expect(
      jsonComparator.equals('{"a":1,"b":{"c":[1,2]}}', '{ "b": { "c": [1, 2.0] }, "a": 1.0 }', ctx()),
    ).toMatchObject({
      verdict: 'equal',
      level: 'normalize',
    });
    expect(jsonComparator.normalize('{"b":1,"a":2}', ctx())).toBe('{"a":2,"b":1}');
  });
  it('값 다름 → different + 위치 표시', () => {
    const r = jsonComparator.equals('{"a":{"list":[1,2,3]}}', '{"a":{"list":[1,5,3]}}', ctx());
    expect(r.verdict).toBe('different');
    expect(r.diff).toEqual({ at: '$.a.list[1]', expected: 2, actual: 5 });
    expect(r.reason).toContain('$.a.list[1]');
    expect(jsonComparator.equals('{"a":1}', '{"a":1,"b":2}', ctx()).diff).toEqual({ at: '$.b', actual: 2 });
    expect(jsonComparator.equals('{"status":"ok"}', '{"status":"error"}', ctx()).verdict).toBe('different');
  });
  it('ignoreKeys (어느 깊이든), arrayOrder strict | ignore', () => {
    const a = '{"id":1,"meta":{"time":"10:00","v":1}}';
    const b = '{"id":1,"meta":{"time":"11:30","v":1}}';
    expect(jsonComparator.equals(a, b, ctx()).verdict).toBe('different');
    expect(jsonComparator.equals(a, b, ctx(), { ignoreKeys: ['time'] }).verdict).toBe('equal');
    expect(jsonComparator.equals('[1,2,3]', '[3,1,2]', ctx()).verdict).toBe('different');
    expect(jsonComparator.equals('[1,2,3]', '[3,1,2]', ctx(), { arrayOrder: 'strict' }).verdict).toBe(
      'different',
    );
    expect(
      jsonComparator.equals('[{"x":1},{"y":2}]', '[{"y":2},{"x":1}]', ctx(), { arrayOrder: 'ignore' })
        .verdict,
    ).toBe('equal');
  });
});
