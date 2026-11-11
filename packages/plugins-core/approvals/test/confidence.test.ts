import { describe, expect, it } from 'vitest';
import { confidenceWord } from '../src/confidence.js';
import { buildCard } from '../src/templates.js';
import { PATH_INPUT } from './helpers.js';

describe('H.3 신뢰도 숫자 → 말 (경계값)', () => {
  it.each([
    [0.95, '높음'],
    [0.9, '높음'],
    [0.8999, '높은 편'],
    [0.8, '높은 편'],
    [0.7999, '중간'],
    [0.7, '중간'],
    [0.6999, '낮은 편'],
    [0.6, '낮은 편'],
    [0.5999, '낮음'],
    [undefined, '알 수 없음'],
  ])('%s → %s', (n, word) => {
    expect(confidenceWord(n)).toBe(word);
  });

  it('숫자는 화면 문구에 없고 자세히 보기(technical)에만', () => {
    const c = buildCard({ ...PATH_INPUT, confidence: 0.75 });
    expect(c.confidenceWord).toBe('중간');
    expect(c.technical.confidence).toBe(0.75);
    const shown = [c.whatHappened, c.whyAsking, c.confidenceWord, c.recommendationReason ?? ''].join(' ');
    expect(shown).not.toMatch(/0\.\d/);
  });
});
