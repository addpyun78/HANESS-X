import { createHash } from 'node:crypto';
import type { HarnessEvent } from '@harness-x/protocol';
import { currentItemOf, type ChecklistLedger } from './ledger.js';

/**
 * 정체 감지·세션 상한 (T-029 29.3·29.4)
 *  - 정체: 현재 항목의 evidence 해시가 턴이 지나도 그대로면 → 2턴째 "접근 변경" 지시, 3턴째 항목 blocked
 *  - 상한: 반복(턴) 수·토큰·경과 시간 중 하나라도 넘으면 일시정지
 */

export const STALL_CHANGE_APPROACH_TURNS = 2;
export const STALL_BLOCK_TURNS = 3;

export type StallAction =
  | { action: 'none'; itemId: string | null; unchangedTurns: number }
  | { action: 'change_approach'; itemId: string; unchangedTurns: number; instruction: string }
  | { action: 'blocked'; itemId: string; unchangedTurns: number; reason: string };

/** 항목 evidence(+상태) 해시 */
export function evidenceHash(ledger: ChecklistLedger, itemId: string): string {
  const it = ledger.read()?.items.find((i) => i.id === itemId);
  return createHash('sha256')
    .update(JSON.stringify(it ? { s: it.status, e: it.evidence } : null))
    .digest('hex');
}

export function changeApproachInstruction(itemId: string, turns: number): string {
  return (
    `항목 ${itemId}이(가) ${turns}턴 동안 진척(새 증거)이 없습니다. 같은 방법을 반복하지 말고 접근을 바꾸세요: ` +
    `실패 원인을 먼저 확인하고, 더 작은 단계로 나누거나 다른 방법을 시도한 뒤 checklist.submit으로 증거를 제출하세요.`
  );
}

export class StallDetector {
  private itemId: string | null = null;
  private hash: string | null = null;
  private unchanged = 0;

  constructor(
    readonly ledger: ChecklistLedger,
    readonly opts: { changeApproachTurns?: number; blockTurns?: number } = {},
  ) {}

  private current() {
    const c = this.ledger.read();
    const cur = c ? currentItemOf(c) : null;
    return cur ? { id: cur.id, hash: evidenceHash(this.ledger, cur.id) } : null;
  }

  /** 턴 시작 시 기준점 기록 (이미 기준점이 있으면 유지) */
  beginTurn(): void {
    if (this.itemId !== null) return;
    const cur = this.current();
    this.itemId = cur?.id ?? null;
    this.hash = cur?.hash ?? null;
  }

  /** 턴이 끝날 때마다 부른다. "무변화 턴" = 같은 현재 항목의 evidence 해시가 턴 시작 때와 같은 턴 */
  observeTurn(): StallAction {
    const cur = this.current();
    if (!cur) {
      this.itemId = null;
      this.hash = null;
      this.unchanged = 0;
      return { action: 'none', itemId: null, unchangedTurns: 0 };
    }
    if (cur.id === this.itemId && cur.hash === this.hash) this.unchanged++;
    else this.unchanged = 0;
    this.itemId = cur.id;
    this.hash = cur.hash;
    const n = this.unchanged;
    const block = this.opts.blockTurns ?? STALL_BLOCK_TURNS;
    const change = this.opts.changeApproachTurns ?? STALL_CHANGE_APPROACH_TURNS;
    if (n >= block) {
      const reason = `정체: evidence 무변화 ${n}턴`;
      this.ledger.transition(cur.id, 'blocked', { evidence: { kind: 'stall_blocked', summary: reason } });
      this.itemId = null;
      this.hash = null;
      this.unchanged = 0;
      return { action: 'blocked', itemId: cur.id, unchangedTurns: n, reason };
    }
    if (n >= change)
      return {
        action: 'change_approach',
        itemId: cur.id,
        unchangedTurns: n,
        instruction: changeApproachInstruction(cur.id, n),
      };
    return { action: 'none', itemId: cur.id, unchangedTurns: n };
  }
}

// ── 29.4 세션 상한 ─────────────────────────────────────────────
export interface SessionLimits {
  /** 최대 턴(반복) 수 */
  maxIterations?: number;
  /** 입력+출력 토큰 합 */
  maxTokens?: number;
  /** 경과 시간(ms) */
  maxDurationMs?: number;
}

export type LimitKind = 'iterations' | 'tokens' | 'time';

export interface BudgetState {
  iterations: number;
  tokens: number;
  elapsedMs: number;
  exceeded: LimitKind | null;
}

/** 세션 예산. 초과 시 일시정지(paused) — 재개는 사람이 상한을 늘리거나 resume()한다 */
export class SessionBudget {
  private iterations = 0;
  private tokens = 0;
  private readonly started: number;
  private pausedBy: LimitKind | null = null;

  constructor(
    readonly limits: SessionLimits,
    private readonly now: () => number = Date.now,
  ) {
    this.started = now();
  }

  /** 턴 시작 */
  startTurn(): void {
    this.iterations++;
  }

  /** usage 이벤트 반영 */
  observe(e: HarnessEvent): void {
    if (e.type === 'usage') this.tokens += e.inputTokens + e.outputTokens;
  }

  state(): BudgetState {
    const elapsedMs = this.now() - this.started;
    const l = this.limits;
    let exceeded: LimitKind | null = null;
    if (l.maxIterations !== undefined && this.iterations >= l.maxIterations) exceeded = 'iterations';
    else if (l.maxTokens !== undefined && this.tokens >= l.maxTokens) exceeded = 'tokens';
    else if (l.maxDurationMs !== undefined && elapsedMs >= l.maxDurationMs) exceeded = 'time';
    return { iterations: this.iterations, tokens: this.tokens, elapsedMs, exceeded };
  }

  /** 다음 턴을 시작해도 되는가 (넘었으면 paused로 고정) */
  check(): { paused: false } | { paused: true; limit: LimitKind; reason: string } {
    const s = this.state();
    if (s.exceeded) this.pausedBy = s.exceeded;
    if (!this.pausedBy) return { paused: false };
    const label = { iterations: '반복 수', tokens: '토큰', time: '시간' }[this.pausedBy];
    return {
      paused: true,
      limit: this.pausedBy,
      reason: `세션 상한(${label}) 초과로 일시정지 — 반복 ${s.iterations}, 토큰 ${s.tokens}, ${Math.round(s.elapsedMs / 1000)}초`,
    };
  }

  get paused(): boolean {
    return this.pausedBy !== null;
  }

  /** 사람이 상한을 바꾼 뒤 재개 */
  resume(limits?: SessionLimits): void {
    if (limits) Object.assign(this.limits, limits);
    this.pausedBy = null;
  }
}
