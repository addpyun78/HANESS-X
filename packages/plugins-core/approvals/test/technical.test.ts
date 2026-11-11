import { describe, expect, it } from 'vitest';
import { buildCard } from '../src/templates.js';
import { PATH_INPUT } from './helpers.js';

describe('H.8 기술 정보는 technical에만', () => {
  it('원문 값·차이 표시·비교 방법·신뢰도 숫자·판정 엔진·항목 id', () => {
    const c = buildCard(PATH_INPUT);
    expect(c.technical).toEqual({
      itemId: '3.2.2',
      expected: '하네스/모바일',
      actual: 'ai/mobile',
      difference: '- 하네스/모바일\n+ ai/mobile',
      comparator: 'path',
      confidence: 0.75,
      judgeEngine: 'codex',
    });
    const shown = [c.whatHappened, c.whyAsking, c.confidenceWord, c.recommendationReason].join('\n');
    for (const hidden of ['codex', '0.75', '3.2.2', '- 하네스', 'path']) expect(shown).not.toContain(hidden);
  });
});
