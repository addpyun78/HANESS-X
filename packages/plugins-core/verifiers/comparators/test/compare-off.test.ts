import { describe, expect, it } from 'vitest';
import { compareValues } from '../src/compare.js';
import { ctx } from './helpers.js';

describe('D.3 exact 또는 semantic: off → 의미 판단·승인 카드 없이 즉시 실패', () => {
  it('off 항목이 확정 못 하면 different → 실패', () => {
    const r = compareValues('text', '완료', '작업이 끝났습니다', ctx(), { semantic: 'off' });
    expect(r).toMatchObject({ verdict: 'different', next: 'fail', semantic: 'off', confidence: 1 });
    expect(r.reason).toMatch(/semantic: off라 의미 판단 없이 실패/);
  });
  it('exact는 언제나 semantic으로 가지 않는다', () => {
    expect(compareValues('exact', 'a ', 'a', ctx()).next).toBe('fail');
    expect(compareValues('exact', 'a', 'a', ctx()).next).toBe('pass');
  });
  it('auto(기본)면 uncertain은 의미 판단 칸으로, 정규화로 같으면 바로 통과', () => {
    const r = compareValues('text', '완료', '작업이 끝났습니다', ctx());
    expect(r).toMatchObject({ verdict: 'uncertain', next: 'semantic', semantic: 'auto' });
    const p = compareValues('auto', 'ok\n', 'ok\r\n', ctx(), { semantic: 'off' });
    expect(p).toMatchObject({ kind: 'text', verdict: 'equal', next: 'pass' });
    expect(compareValues('number', '200', '500', ctx()).next).toBe('fail');
  });
});
