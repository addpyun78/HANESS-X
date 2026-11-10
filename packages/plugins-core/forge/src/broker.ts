import type { LogRecord } from '@harness-x/kernel';
import type { ForgeAnswer } from './interview.js';

/**
 * Forge 카드 응답 중개
 * 노드가 카드(질문·spec 확인·설치)를 띄우면 ask()로 기다리고, 사용자가 버튼을 누르면
 * POST /api/forge/answers/:id → answer()가 그 대기를 푼다. 답할 때마다 forge_answer 이벤트를 남긴다(51.2).
 */

export type ForgeCardKind = 'forge_question' | 'forge_spec' | 'forge_install';

export interface ForgeCard {
  approvalId: string;
  sessionId: string;
  kind: ForgeCardKind;
  title: string;
  /** 허용되는 선택지 값 */
  options: string[];
  multiple?: boolean;
  allowText?: boolean;
  detail?: Record<string, unknown>;
}

export class ForgeAnswerError extends Error {
  constructor(
    readonly code: 'not_found' | 'invalid_answer',
    message: string,
  ) {
    super(message);
  }
}

interface Pending {
  card: ForgeCard;
  resolve: (a: ForgeAnswer) => void;
  reject: (e: Error) => void;
}

export interface ForgeBrokerOptions {
  log?: { append(rec: LogRecord): unknown };
  idGen?: () => string;
  now?: () => Date;
}

export class ForgeBroker {
  private readonly pendingCards = new Map<string, Pending>();
  private readonly listeners = new Set<(card: ForgeCard) => void>();
  private seq = 0;

  constructor(private readonly opts: ForgeBrokerOptions = {}) {}

  /** 카드를 띄우고 답을 기다린다 (signal이 끊기면 거부) */
  ask(card: ForgeCard, signal?: AbortSignal): Promise<ForgeAnswer> {
    return new Promise<ForgeAnswer>((resolve, reject) => {
      if (signal?.aborted) return reject(new Error('중단됨'));
      const onAbort = () => {
        this.pendingCards.delete(card.approvalId);
        reject(new Error('중단됨'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pendingCards.set(card.approvalId, {
        card,
        resolve: (a) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(a);
        },
        reject,
      });
      for (const l of this.listeners) l(card);
    });
  }

  /** 버튼 응답. 선택지 밖 값은 allowText 카드에서만 글로 받는다 */
  answer(approvalId: string, raw: { value?: unknown; text?: unknown }): ForgeAnswer {
    const p = this.pendingCards.get(approvalId);
    if (!p) throw new ForgeAnswerError('not_found', `대기 중인 카드 없음: ${approvalId}`);
    const card = p.card;
    const text = typeof raw.text === 'string' && raw.text.trim() ? raw.text.trim() : undefined;
    let value: string | string[];
    if (Array.isArray(raw.value) && raw.value.every((v) => typeof v === 'string')) {
      if (!card.multiple) throw new ForgeAnswerError('invalid_answer', '이 카드는 하나만 고릅니다');
      value = raw.value as string[];
    } else if (typeof raw.value === 'string') value = raw.value;
    else if (text && card.allowText) value = 'text';
    else throw new ForgeAnswerError('invalid_answer', 'value가 필요합니다');
    const values = Array.isArray(value) ? value : [value];
    const bad = values.filter((v) => !card.options.includes(v) && !(v === 'text' && card.allowText));
    if (bad.length || values.length === 0)
      throw new ForgeAnswerError(
        'invalid_answer',
        `선택지 밖 값: ${bad.join(', ') || '(없음)'} (허용: ${card.options.join(', ')})`,
      );
    const answer: ForgeAnswer = { value, ...(text ? { text } : {}) };
    this.pendingCards.delete(approvalId);
    this.opts.log?.append({
      id: this.opts.idGen?.() ?? `forge-answer-${Date.now()}-${++this.seq}`,
      ts: (this.opts.now?.() ?? new Date()).toISOString(),
      sessionId: card.sessionId,
      type: 'forge_answer',
      approvalId,
      cardKind: card.kind,
      ...(typeof card.detail?.questionId === 'string' ? { questionId: card.detail.questionId } : {}),
      value,
      ...(text ? { text } : {}),
    });
    p.resolve(answer);
    return answer;
  }

  pending(sessionId?: string): ForgeCard[] {
    return [...this.pendingCards.values()]
      .map((p) => p.card)
      .filter((c) => !sessionId || c.sessionId === sessionId);
  }

  /** 카드가 뜰 때마다 (테스트·자동 응답용) */
  onCard(fn: (card: ForgeCard) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
