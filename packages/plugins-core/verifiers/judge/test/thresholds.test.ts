import { describe, expect, it } from 'vitest';
import {
  aggregateAnswers,
  EQUAL_THRESHOLD,
  UNCERTAIN_THRESHOLD,
  verdictForConfidence,
} from '../src/confidence.js';
import { NO, YES } from './helpers.js';

describe('E.11 임계값 경계', () => {
  it('≥0.9 equal / 0.6~0.9 uncertain(승인 카드) / <0.6 different', () => {
    expect(EQUAL_THRESHOLD).toBe(0.9);
    expect(UNCERTAIN_THRESHOLD).toBe(0.6);
    expect(verdictForConfidence(1)).toBe('equal');
    expect(verdictForConfidence(0.9)).toBe('equal');
    expect(verdictForConfidence(0.8999)).toBe('uncertain');
    expect(verdictForConfidence(2 / 3)).toBe('uncertain');
    expect(verdictForConfidence(0.6)).toBe('uncertain');
    expect(verdictForConfidence(0.5999)).toBe('different');
    expect(verdictForConfidence(1 / 3)).toBe('different');
    expect(verdictForConfidence(0)).toBe('different');
  });

  it('표본 결과 → 판정: 3/3 equal, 2/3 uncertain, 1/3 different, 쉬운 말 사유는 다수 쪽', () => {
    expect(aggregateAnswers([YES, YES, YES]).verdict).toBe('equal');
    const two = aggregateAnswers([YES, NO, YES]);
    expect(two.verdict).toBe('uncertain');
    expect(two.plainReason).toBe(YES.plain_reason);
    const one = aggregateAnswers([NO, YES, NO]);
    expect(one.verdict).toBe('different');
    expect(one.plainReason).toBe(NO.plain_reason);
    expect(one.differenceKind).toBe('wrong-value');
  });
});
