import { randomUUID } from 'node:crypto';

/**
 * T-101 3D "돌아오면 확인할 것" 목록 — 오토 모드가 스스로 정하지 않고 사람에게 미룬 일.
 * 3D.2 범위 밖 권한 요청, 3D.3 판정 카드, 3D.4 사람 전용 작업, 3D.1 계획 확인 실패, 3D.5 상한 초과.
 * 이유(reason)는 화면에 그대로 나가므로 쉬운 말로 쓴다.
 */

export const REVIEW_KINDS = ['permission', 'verdict', 'human-only', 'plan', 'limit'] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];

/** 처리 버튼 종류 */
export type ReviewActionId = 'allow' | 'deny' | 'open' | 'retry' | 'do-it' | 'dismiss';

export const REVIEW_ACTION_LABEL: Readonly<Record<ReviewActionId, string>> = Object.freeze({
  allow: '허락하기',
  deny: '하지 않기',
  open: '카드 열기',
  retry: '다시 해 보기',
  'do-it': '직접 하기',
  dismiss: '확인했어요',
});

export interface ReviewItem {
  id: string;
  sessionId: string;
  kind: ReviewKind;
  /** 쉬운 말 이유 (화면 표시) */
  reason: string;
  /** 관련 체크리스트 항목 (blocked 처리된 항목) */
  itemId?: string;
  /** 처리 버튼 */
  actions: ReviewActionId[];
  /** 기술 정보 (화면에서는 접힘) */
  detail?: Record<string, unknown>;
  at: string;
  resolved?: { action: ReviewActionId; at: string };
}

export type ReviewInput = Omit<ReviewItem, 'id' | 'at' | 'resolved' | 'actions'> & {
  actions?: ReviewActionId[];
};

const DEFAULT_ACTIONS: Readonly<Record<ReviewKind, ReviewActionId[]>> = Object.freeze({
  permission: ['allow', 'deny'],
  verdict: ['open'],
  'human-only': ['do-it', 'dismiss'],
  plan: ['open', 'retry'],
  limit: ['retry', 'dismiss'],
});

export class ReviewList {
  private items: ReviewItem[] = [];
  private readonly listeners = new Set<(items: readonly ReviewItem[]) => void>();
  constructor(private readonly now: () => Date = () => new Date()) {}

  add(input: ReviewInput): ReviewItem {
    const it: ReviewItem = {
      ...input,
      actions: input.actions ?? DEFAULT_ACTIONS[input.kind],
      id: randomUUID(),
      at: this.now().toISOString(),
    };
    this.items.push(it);
    this.fire();
    return it;
  }

  /** 아직 처리 안 한 것 (sessionId를 주면 그 세션만) */
  open(sessionId?: string): ReviewItem[] {
    return this.items.filter((i) => !i.resolved && (!sessionId || i.sessionId === sessionId));
  }

  all(): ReviewItem[] {
    return [...this.items];
  }

  resolve(id: string, action: ReviewActionId): ReviewItem {
    const it = this.items.find((i) => i.id === id);
    if (!it) throw new Error(`확인할 것을 찾을 수 없어요: ${id}`);
    if (!it.actions.includes(action)) throw new Error(`이 항목에서 고를 수 없는 처리예요: ${action}`);
    it.resolved = { action, at: this.now().toISOString() };
    this.fire();
    return it;
  }

  onChange(fn: (items: readonly ReviewItem[]) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private fire() {
    for (const fn of this.listeners) fn(this.items);
  }
}
