/**
 * 승인 카드 화면 모델 (T-100 H.11~H.16)
 * 서버 카드(@harness-x/approvals ApprovalCard)와 같은 모양을 웹에서 따로 정의한다 (웹은 Node 패키지를 번들하지 않는다).
 * 화면은 범용 ActionCard({title, sections, badges?, buttons[], technical}) 하나로 그린다 —
 * Part 2(설치 계획 카드)·Part 3(도구 고르기 카드)도 같은 틀을 쓴다.
 */

export const APPROVAL_CARD_KIND = 'approval.card';
export const APPROVAL_RESOLVED = 'approval_resolved';
export const AREA_TITLE = '확인이 필요해요';

export type ChoiceId = 'accept' | 'redo' | 'stop' | 'allow-move' | 'register' | 'skip';

export const CHOICE_LABELS: Record<ChoiceId, string> = {
  accept: '같은 걸로 인정',
  redo: '원래 자리로 다시 만들기',
  stop: '잘 모르겠어요 — 안전하게 멈추기',
  'allow-move': '이 위치로 옮긴 걸 허락',
  register: '네, 사전에 넣어 주세요',
  skip: '아니요, 넣지 않을게요',
};

export interface ApprovalCardData {
  id: string;
  itemId: string;
  kind: string;
  sessionId?: string;
  title: string;
  whatHappened: string;
  whyAsking: string;
  confidenceWord: string;
  recommendation?: ChoiceId;
  recommendationReason?: string;
  options: { id: ChoiceId; label: string }[];
  rememberable?: boolean;
  technical: {
    itemId: string;
    expected: string;
    actual: string;
    difference?: string;
    comparator: string;
    confidence?: number;
    judgeEngine?: string;
    rawReason?: string;
  };
  createdAt: string;
}

// ── 범용 카드 모델 ────────────────────────────────────────────────
export interface ActionCardSection {
  heading?: string;
  text: string;
}
export interface ActionCardButton {
  id: string;
  label: string;
  /** 추천 버튼 강조 */
  primary?: boolean;
}
export interface ActionCardModel {
  id: string;
  title: string;
  /** 제목 앞 그림 글자 (기본 ✋, 도구 고르기 카드는 🔧) */
  icon?: string;
  /** 제목 옆 작은 표시 (예: 항목 번호, 무료/유료) */
  badges?: string[];
  sections: ActionCardSection[];
  buttons: ActionCardButton[];
  /** "다음부터 같은 경우는 자동으로 처리해 주세요" 같은 체크 상자 */
  checkbox?: string;
  /** 자세히 보기 (기본 접힘) */
  technical?: { label: string; value: string }[];
}

export const REMEMBER_LABEL = '다음부터 같은 경우는 자동으로 처리해 주세요';

/** 승인 카드 → 범용 카드 */
export function toActionCard(c: ApprovalCardData): ActionCardModel {
  const t = c.technical;
  const technical: { label: string; value: string }[] = [
    { label: '항목', value: t.itemId },
    { label: '계획 값', value: t.expected },
    { label: '실제 값', value: t.actual },
    ...(t.difference ? [{ label: '차이', value: t.difference }] : []),
    { label: '비교 방법', value: t.comparator },
    ...(t.confidence !== undefined ? [{ label: '확신 숫자', value: t.confidence.toFixed(2) }] : []),
    ...(t.judgeEngine ? [{ label: '판단한 AI', value: t.judgeEngine }] : []),
    ...(t.rawReason ? [{ label: 'AI 원래 이유', value: t.rawReason }] : []),
  ];
  return {
    id: c.id,
    title: c.title,
    badges: [c.itemId],
    sections: [
      { heading: '무슨 일이 있었나요?', text: c.whatHappened },
      { heading: '왜 제가 정하지 못했나요?', text: `${c.whyAsking} (확신 정도: ${c.confidenceWord})` },
      ...(c.recommendation && c.recommendationReason
        ? [
            {
              heading: `AI 추천: ${CHOICE_LABELS[c.recommendation]}`,
              text: `이유: ${c.recommendationReason}`,
            },
          ]
        : []),
    ],
    buttons: c.options.map((o) => ({
      id: o.id,
      label: o.label,
      ...(o.id === c.recommendation ? { primary: true } : {}),
    })),
    ...(c.rememberable ? { checkbox: REMEMBER_LABEL } : {}),
    technical,
  };
}

// ── 이벤트 → 대기 카드 ────────────────────────────────────────────
type Rec = { type: string; approvalId?: string; kind?: string; detail?: unknown; undone?: boolean };

export function cardOfEvent(e: unknown): ApprovalCardData | undefined {
  const r = e as Rec;
  if (r.type !== 'approval_request' || r.kind !== APPROVAL_CARD_KIND) return undefined;
  const card = (r.detail as { card?: ApprovalCardData } | undefined)?.card;
  return card && typeof card.id === 'string' ? card : undefined;
}

/**
 * 서버 목록(초기) + 이벤트(이후) → 대기 카드 (생성 순서)
 * approval_resolved는 카드를 내리고, undone(방금 선택 취소)은 뒤따르는 approval_request가 다시 올린다.
 */
export function pendingFromEvents(
  initial: readonly ApprovalCardData[],
  events: readonly unknown[],
): ApprovalCardData[] {
  const m = new Map<string, ApprovalCardData>(initial.map((c) => [c.id, c]));
  for (const e of events) {
    const card = cardOfEvent(e);
    if (card) {
      if (!m.has(card.id)) m.set(card.id, card);
      continue;
    }
    const r = e as Rec;
    if (r.type === APPROVAL_RESOLVED && r.approvalId && !r.undone) m.delete(r.approvalId);
  }
  return [...m.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** 세션별 대기 카드 수 (사이드바 "확인 필요" 배지) */
export function countBySession(cards: readonly ApprovalCardData[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of cards) if (c.sessionId) out[c.sessionId] = (out[c.sessionId] ?? 0) + 1;
  return out;
}

/** 탭 제목: "(2) HARNESS-X" */
export function titleWithCount(base: string, n: number): string {
  const clean = base.replace(/^\(\d+\)\s*/, '');
  return n > 0 ? `(${n}) ${clean}` : clean;
}

/** 묶음 제안 (H.25와 같은 기준) */
export const BATCH_THRESHOLD = 5;
export const BATCH_MESSAGE = '비슷한 확인이 반복돼요 — 한 번에 정할까요?';
