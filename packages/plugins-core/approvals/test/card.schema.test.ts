import { describe, expect, expectTypeOf, it } from 'vitest';
import { ApprovalCardSchema, CHOICE_LABELS, type ApprovalCard } from '../src/card.js';

const valid = {
  id: 'c1',
  itemId: '3.2.2',
  kind: 'path',
  whatHappened: '계획에는 "하네스/모바일" 폴더에 만들기로 했어요.',
  whyAsking: '두 이름이 같은 폴더를 뜻하는지 확실하지 않아요.',
  confidenceWord: '중간',
  recommendation: 'accept',
  recommendationReason: '안에 든 파일과 테스트 결과가 같아요.',
  options: [
    { id: 'accept', label: CHOICE_LABELS.accept },
    { id: 'redo', label: CHOICE_LABELS.redo },
    { id: 'stop', label: CHOICE_LABELS.stop },
  ],
  technical: {
    itemId: '3.2.2',
    expected: '하네스/모바일',
    actual: 'ai/mobile',
    comparator: 'path',
    confidence: 0.75,
  },
  createdAt: '2026-11-11T09:00:00.000Z',
};

describe('H.1 ApprovalCard 스키마 (Zod)', () => {
  it('필수 필드 { id, itemId, whatHappened, whyAsking, confidenceWord, recommendation?, recommendationReason?, options[], technical }', () => {
    const c = ApprovalCardSchema.parse(valid);
    expect(c.title).toBe('확인이 필요해요');
    expect(c.rememberable).toBe(false);
    expectTypeOf<ApprovalCard>().toHaveProperty('whatHappened').toEqualTypeOf<string>();
    expectTypeOf<ApprovalCard['recommendation']>().toEqualTypeOf<
      'accept' | 'redo' | 'stop' | 'allow-move' | 'register' | 'skip' | undefined
    >();
    const { recommendation: _r, recommendationReason: _rr, ...noRec } = valid;
    expect(ApprovalCardSchema.safeParse(noRec).success).toBe(true);
  });

  it.each([
    ['whatHappened 없음', { whatHappened: undefined }],
    ['options 비어 있음', { options: [] }],
    ['고정 문구가 아닌 버튼', { options: [{ id: 'accept', label: '동치 인정' }] }],
    ['선택지에 없는 추천', { recommendation: 'allow-move' }],
    ['이유 없는 추천', { recommendationReason: undefined }],
    ['technical 항목 id 불일치', { technical: { ...valid.technical, itemId: '9' } }],
    ['모르는 필드', { extra: 1 }],
    ['모르는 종류', { kind: 'json' }],
  ])('거부: %s', (_name, patch) => {
    expect(ApprovalCardSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});
