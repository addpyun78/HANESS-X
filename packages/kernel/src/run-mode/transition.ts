import type { RunMode } from '@harness-x/protocol';

/**
 * T-101 3E.4 실행 중 모드 변경
 *  - 계획 → 일반/오토: 계획 승인으로 바뀐다 (계획 완료 카드에서 고른 모드로, 3B.2)
 *  - 일반 ↔ 오토 (그리고 → 계획): 지금 턴은 그대로, 다음 턴부터
 *  - 바뀔 때마다 기록 (세션 타임라인·이벤트 로그)
 */

export type ModeApply = 'now' | 'next-turn' | 'on-plan-approval';

export interface ModeChangeRecord {
  type: 'mode_change';
  sessionId: string;
  from: RunMode;
  to: RunMode;
  /** requested = 요청만 됨(대기), applied = 실제로 바뀜 */
  phase: 'requested' | 'applied';
  apply: ModeApply;
  by: 'user' | 'plan-card' | 'resume';
  at: string;
}

/** 순수: 언제 적용되나 */
export function modeApplyAt(from: RunMode, to: RunMode, running: boolean): ModeApply {
  if (!running || from === to) return 'now';
  if (from === 'plan') return 'on-plan-approval';
  return 'next-turn';
}

export interface ModeControllerOptions {
  sessionId: string;
  initial: RunMode;
  record: (r: ModeChangeRecord) => void;
  now?: () => Date;
}

export class ModeController {
  private cur: RunMode;
  private pending?: { to: RunMode; apply: ModeApply; by: ModeChangeRecord['by'] };
  private running = false;
  private readonly now: () => Date;
  constructor(private readonly o: ModeControllerOptions) {
    this.cur = o.initial;
    this.now = o.now ?? (() => new Date());
  }

  /** 지금 적용 중인 모드 (게이트·엔진 인자는 이것을 본다) */
  get mode(): RunMode {
    return this.cur;
  }
  /** 대기 중인 변경 */
  get pendingMode(): RunMode | undefined {
    return this.pending?.to;
  }

  /** 실행 시작/끝 (실행 중이 아니면 바로 바뀜) */
  setRunning(running: boolean): void {
    this.running = running;
  }

  request(to: RunMode, by: ModeChangeRecord['by'] = 'user'): ModeApply {
    const apply = modeApplyAt(this.cur, to, this.running);
    if (to === this.cur) {
      this.pending = undefined;
      return 'now';
    }
    this.rec('requested', this.cur, to, apply, by);
    if (apply === 'now') this.applyTo(to, apply, by);
    else this.pending = { to, apply, by };
    return apply;
  }

  /** 실행기가 새 AI 턴을 시작하기 직전에 부른다 */
  onTurnStart(): void {
    if (this.pending?.apply === 'next-turn') this.flush();
  }

  /** 계획 승인(3B.2 카드). to를 주면 그 모드로 (없으면 대기 중인 값, 그것도 없으면 일반) */
  onPlanApproved(to?: RunMode): void {
    if (this.cur !== 'plan') return;
    const target = to ?? this.pending?.to ?? 'normal';
    this.pending = {
      to: target,
      apply: 'on-plan-approval',
      by: to ? 'plan-card' : (this.pending?.by ?? 'user'),
    };
    this.flush();
  }

  private flush() {
    const p = this.pending!;
    this.pending = undefined;
    this.applyTo(p.to, p.apply, p.by);
  }

  private applyTo(to: RunMode, apply: ModeApply, by: ModeChangeRecord['by']) {
    const from = this.cur;
    this.cur = to;
    this.rec('applied', from, to, apply, by);
  }

  private rec(
    phase: ModeChangeRecord['phase'],
    from: RunMode,
    to: RunMode,
    apply: ModeApply,
    by: ModeChangeRecord['by'],
  ) {
    this.o.record({
      type: 'mode_change',
      sessionId: this.o.sessionId,
      from,
      to,
      phase,
      apply,
      by,
      at: this.now().toISOString(),
    });
  }
}
