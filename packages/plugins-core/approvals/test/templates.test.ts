import { describe, expect, it } from 'vitest';
import { DIFFERENCE_KINDS, type DifferenceKind } from '../src/card.js';
import { checkPlainKorean } from '../src/plain-korean.js';
import { buildCard, type CardInput } from '../src/templates.js';
import { NOW, PATH_INPUT } from './helpers.js';

const INPUTS: Record<DifferenceKind, CardInput> = {
  path: PATH_INPUT,
  text: {
    kind: 'text',
    itemId: '4.1',
    expected: '로그인 성공',
    actual: '로그인에 성공했습니다',
    comparator: 'text',
    confidence: 0.82,
    judgeEngine: 'ollama:qwen3',
    id: 'card-text-1',
    now: NOW,
  },
  number: {
    kind: 'number',
    itemId: '5.3',
    expected: '1,000',
    actual: '1000.0',
    comparator: 'number',
    confidence: 0.64,
    judgeEngine: 'claude-code',
    id: 'card-number-1',
    now: NOW,
  },
  'no-judge': {
    kind: 'no-judge',
    itemId: '6.2',
    expected: '저장 완료',
    actual: '저장됨',
    comparator: 'text',
    id: 'card-nojudge-1',
    now: NOW,
  },
  'limit-exceeded': {
    kind: 'limit-exceeded',
    itemId: '7.1',
    expected: 'docs/guide',
    actual: 'docs/guides',
    comparator: 'path',
    id: 'card-limit-1',
    now: NOW,
  },
};

describe('H.2 차이 종류 5종 한국어 템플릿', () => {
  it.each(DIFFERENCE_KINDS)('%s 스냅샷 + 쉬운 말 검사 통과', (kind) => {
    const c = buildCard(INPUTS[kind]);
    expect(c).toMatchSnapshot();
    for (const t of [c.whatHappened, c.whyAsking])
      expect(checkPlainKorean(t)).toEqual({ ok: true, violations: [] });
  });

  it('긴 값은 화면에서 줄이고 원문은 technical에', () => {
    const long = 'apps/mobile/src/screens/login/LoginScreenController.kt';
    const c = buildCard({ ...PATH_INPUT, actual: long });
    expect(c.whatHappened).toContain('…');
    expect(c.technical.actual).toBe(long);
    expect(checkPlainKorean(c.whatHappened).ok).toBe(true);
  });
});
