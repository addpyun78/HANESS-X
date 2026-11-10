import { describe, expect, it } from 'vitest';
import { lintItem } from '../src/lint.js';

const r3 = (types: string[]) =>
  lintItem({
    id: '1',
    title: '로그인 화면 작성',
    artifactId: 'art.login',
    acceptance: types.map((type) => ({ type })),
  }).filter((v) => v.rule === 'R3');

describe('21.3 R3 기계 검증 가능', () => {
  it('llm 타입만 있으면 거부', () => {
    expect(r3(['llm'])).toHaveLength(1);
    expect(r3(['llm', 'llm'])).toHaveLength(1);
  });
  it('acceptance 없음 거부', () => {
    expect(r3([])).toHaveLength(1);
  });
  it.each(['test', 'command', 'symbol', 'file_exists', 'schema'])('%s 포함 시 통과 (llm과 함께여도)', (t) => {
    expect(r3([t])).toEqual([]);
    expect(r3(['llm', t])).toEqual([]);
  });
});
