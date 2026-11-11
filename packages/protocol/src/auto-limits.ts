/**
 * T-101 3D.5 (화면·커널 공용) — 오토 모드 상한 모양·설명·검사 (순수 함수)
 */
export interface AutoLimits {
  /** 최대 실행 시간 (분) */
  maxMinutes: number;
  /** 최대 토큰 수 (입력 + 출력) */
  maxTokens: number;
  /** 최대 비용 (달러, 0 = 확인 안 함 — 구독 로그인은 비용이 없다) */
  maxCostUsd: number;
  /** 최대 반복 수 (AI 턴 수) */
  maxIterations: number;
}

export const DEFAULT_AUTO_LIMITS: Readonly<AutoLimits> = Object.freeze({
  maxMinutes: 60,
  maxTokens: 2_000_000,
  maxCostUsd: 5,
  maxIterations: 200,
});

export interface AutoUsage {
  startedAt: number;
  now: number;
  tokens: number;
  costUsd: number;
  iterations: number;
}

export type LimitKey = 'time' | 'tokens' | 'cost' | 'iterations';

export interface LimitExceeded {
  key: LimitKey;
  /** 쉬운 말 */
  message: string;
}

/** 상한은 반드시 있어야 한다: 0 이하·숫자 아님은 기본값으로 (비용은 0 = 끔 허용) */
export function normalizeLimits(l: Partial<AutoLimits> = {}): AutoLimits {
  const pos = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d);
  return {
    maxMinutes: pos(l.maxMinutes, DEFAULT_AUTO_LIMITS.maxMinutes),
    maxTokens: Math.floor(pos(l.maxTokens, DEFAULT_AUTO_LIMITS.maxTokens)),
    maxCostUsd:
      typeof l.maxCostUsd === 'number' && Number.isFinite(l.maxCostUsd) && l.maxCostUsd >= 0
        ? l.maxCostUsd
        : DEFAULT_AUTO_LIMITS.maxCostUsd,
    maxIterations: Math.floor(pos(l.maxIterations, DEFAULT_AUTO_LIMITS.maxIterations)),
  };
}

const n = (v: number) => v.toLocaleString('ko-KR');

/** 오토 시작 카드에 보일 상한 설명 (한 줄씩) */
export function describeLimits(l: AutoLimits): string[] {
  return [
    `최대 ${n(l.maxMinutes)}분 동안 일해요.`,
    `AI가 읽고 쓰는 양은 ${n(l.maxTokens)} 단위까지만 써요.`,
    l.maxCostUsd > 0 ? `비용은 ${l.maxCostUsd}달러까지만 써요.` : '비용 한도는 따로 두지 않아요.',
    `AI에게 최대 ${n(l.maxIterations)}번까지 일을 맡겨요.`,
  ];
}

/** 넘은 상한 (없으면 undefined). 먼저 넘은 순서: 시간 → 비용 → 토큰 → 반복 */
export function checkLimits(u: AutoUsage, l: AutoLimits): LimitExceeded | undefined {
  if (u.now - u.startedAt >= l.maxMinutes * 60_000)
    return { key: 'time', message: `${n(l.maxMinutes)}분이 지나서 멈췄어요.` };
  if (l.maxCostUsd > 0 && u.costUsd >= l.maxCostUsd)
    return { key: 'cost', message: `비용이 ${l.maxCostUsd}달러에 닿아서 멈췄어요.` };
  if (u.tokens >= l.maxTokens)
    return { key: 'tokens', message: 'AI가 읽고 쓰는 양이 한도에 닿아서 멈췄어요.' };
  if (u.iterations >= l.maxIterations)
    return { key: 'iterations', message: `AI에게 ${n(l.maxIterations)}번 맡겨서 멈췄어요.` };
  return;
}
