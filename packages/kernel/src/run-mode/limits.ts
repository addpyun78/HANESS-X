import {
  checkLimits,
  normalizeLimits,
  type AutoLimits,
  type AutoUsage,
  type LimitExceeded,
} from '@harness-x/protocol';
import { readSetting } from '../settings/registry.js';

/**
 * T-101 3D.5 오토 모드 필수 상한: 시간 · 토큰(비용) · 반복 수.
 * 오토를 시작할 때 쉬운 말로 보여주고(바꿀 수 있음, 화면: apps/web/src/run-mode/AutoLimitsCard.tsx),
 * 하나라도 넘으면 일시정지(2번 정지, reason 'budget'). 모양·설명·검사 함수는 @harness-x/protocol auto-limits.ts.
 */

/** 설정(mode.auto.*)에서 상한 읽기 (프로젝트 값은 호출하는 쪽이 합쳐서 넘긴다 — scope both) */
export function limitsFromSettings(values: Record<string, unknown>): AutoLimits {
  return normalizeLimits({
    maxMinutes: readSetting<number>(values, 'mode.auto.maxMinutes'),
    maxTokens: readSetting<number>(values, 'mode.auto.maxTokens'),
    maxCostUsd: readSetting<number>(values, 'mode.auto.maxCostUsd'),
    maxIterations: readSetting<number>(values, 'mode.auto.maxIterations'),
  });
}

export interface LimitGuardOptions {
  limits: AutoLimits;
  /** 일시정지 (2번 정지: paused{reason:'budget'}) */
  pause: (reason: 'budget', exceeded: LimitExceeded) => void;
  now?: () => number;
}

/** 실행기가 턴마다 부르는 감시자 */
export function createLimitGuard(opts: LimitGuardOptions) {
  const now = opts.now ?? Date.now;
  const u: AutoUsage = { startedAt: now(), now: now(), tokens: 0, costUsd: 0, iterations: 0 };
  let stopped: LimitExceeded | undefined;
  return {
    usage: () => ({ ...u, now: now() }),
    /** 한 턴이 끝날 때 사용량을 더하고 검사. 넘었으면 pause 한 번 부르고 결과 반환 */
    record(add: { tokens?: number; costUsd?: number; iterations?: number } = {}): LimitExceeded | undefined {
      if (stopped) return stopped;
      u.tokens += add.tokens ?? 0;
      u.costUsd += add.costUsd ?? 0;
      u.iterations += add.iterations ?? 1;
      u.now = now();
      const ex = checkLimits(u, opts.limits);
      if (ex) {
        stopped = ex;
        opts.pause('budget', ex);
      }
      return ex;
    },
  };
}
