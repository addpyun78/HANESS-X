import { z } from 'zod';

/**
 * 승인 카드 (T-100 H.1) — 코딩 초보자도 읽을 수 있는 쉬운 말 카드.
 * 화면에는 whatHappened · whyAsking · confidenceWord · 추천 · 버튼만 보이고,
 * 원문 값·비교 방법·신뢰도 숫자·판정 엔진·항목 id는 technical(기본 접힘)에만 둔다 (H.8).
 */

/** 차이 종류 5종 (H.2) + 사전 등록 제안(F.4) */
export const DIFFERENCE_KINDS = ['path', 'text', 'number', 'no-judge', 'limit-exceeded'] as const;
export const DifferenceKindSchema = z.enum(DIFFERENCE_KINDS);
export type DifferenceKind = z.infer<typeof DifferenceKindSchema>;

export const CARD_KINDS = [...DIFFERENCE_KINDS, 'dictionary-proposal'] as const;
export const CardKindSchema = z.enum(CARD_KINDS);
export type CardKind = z.infer<typeof CardKindSchema>;

/** 선택지 id. accept/redo/stop/allow-move는 판정 카드, register/skip은 사전 등록 제안 카드 */
export const CHOICE_IDS = ['accept', 'redo', 'stop', 'allow-move', 'register', 'skip'] as const;
export const ChoiceIdSchema = z.enum(CHOICE_IDS);
export type ChoiceId = z.infer<typeof ChoiceIdSchema>;

/** H.4 선택지 문구 고정 */
export const CHOICE_LABELS: Readonly<Record<ChoiceId, string>> = Object.freeze({
  accept: '같은 걸로 인정',
  redo: '원래 자리로 다시 만들기',
  stop: '잘 모르겠어요 — 안전하게 멈추기',
  'allow-move': '이 위치로 옮긴 걸 허락',
  register: '네, 사전에 넣어 주세요',
  skip: '아니요, 넣지 않을게요',
});

export const CardOptionSchema = z
  .object({
    id: ChoiceIdSchema,
    label: z.string().min(1),
  })
  .strict()
  .refine((o) => o.label === CHOICE_LABELS[o.id], { message: '선택지 문구는 고정 문구만 (H.4)' });
export type CardOption = z.infer<typeof CardOptionSchema>;

/** 자세히 보기 (기술 정보) */
export const CardTechnicalSchema = z
  .object({
    itemId: z.string().min(1),
    expected: z.string(),
    actual: z.string(),
    /** 차이 표시 (예: "- harness/mobile\n+ ai/mobile") */
    difference: z.string().optional(),
    /** 비교 방법 종류 (path, text, number …) */
    comparator: z.string().min(1),
    /** 신뢰도 숫자 0~1 */
    confidence: z.number().min(0).max(1).optional(),
    judgeEngine: z.string().min(1).optional(),
    /** AI가 준 원래 이유 (쉬운 말 검사 실패 시 화면 대신 여기에만) */
    rawReason: z.string().optional(),
  })
  .strict();
export type CardTechnical = z.infer<typeof CardTechnicalSchema>;

export const CARD_TITLE = '확인이 필요해요';

export const ApprovalCardSchema = z
  .object({
    id: z.string().min(1),
    itemId: z.string().min(1),
    kind: CardKindSchema,
    sessionId: z.string().min(1).optional(),
    title: z.string().min(1).default(CARD_TITLE),
    /** 무슨 일이 있었나요? */
    whatHappened: z.string().min(1),
    /** 왜 제가 정하지 못했나요? */
    whyAsking: z.string().min(1),
    /** 확신 정도 (말로만 — 숫자는 technical) */
    confidenceWord: z.string().min(1),
    recommendation: ChoiceIdSchema.optional(),
    recommendationReason: z.string().min(1).optional(),
    options: z.array(CardOptionSchema).min(1),
    /** "다음부터 같은 경우는 자동으로 처리해 주세요" 체크 상자를 보일지 */
    rememberable: z.boolean().default(false),
    technical: CardTechnicalSchema,
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine((c) => !c.recommendation || c.options.some((o) => o.id === c.recommendation), {
    message: '추천은 선택지 중 하나',
    path: ['recommendation'],
  })
  .refine((c) => (c.recommendation === undefined) === (c.recommendationReason === undefined), {
    message: '추천과 추천 이유는 함께 있거나 함께 없다',
    path: ['recommendationReason'],
  })
  .refine((c) => c.technical.itemId === c.itemId, {
    message: 'technical.itemId는 itemId와 같아야 한다',
    path: ['technical', 'itemId'],
  });
export type ApprovalCard = z.infer<typeof ApprovalCardSchema>;
export type ApprovalCardInput = z.input<typeof ApprovalCardSchema>;

export function parseApprovalCard(v: unknown): ApprovalCard {
  return ApprovalCardSchema.parse(v);
}

export function option(id: ChoiceId): CardOption {
  return { id, label: CHOICE_LABELS[id] };
}

/** 화면에 보이는 문구 원문 (approvals.jsonl 기록용, H.24) */
export function screenText(card: ApprovalCard): string {
  return [
    card.title,
    `무슨 일이 있었나요? ${card.whatHappened}`,
    `왜 제가 정하지 못했나요? ${card.whyAsking}`,
    `(확신 정도: ${card.confidenceWord})`,
    ...(card.recommendation
      ? [`AI 추천: ${CHOICE_LABELS[card.recommendation]}`, `이유: ${card.recommendationReason}`]
      : []),
    ...card.options.map((o, i) => `[${i + 1}] ${o.label}`),
  ].join('\n');
}
