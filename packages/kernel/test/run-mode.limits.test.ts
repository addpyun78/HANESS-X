import { checkLimits, DEFAULT_AUTO_LIMITS, describeLimits, normalizeLimits } from '@harness-x/protocol';
import { describe, expect, it, vi } from 'vitest';
import { checkPlainKorean } from '../../plugins-core/approvals/src/plain-korean.js';
import { createLimitGuard, limitsFromSettings } from '../src/run-mode/limits.js';
import { settingsRegistry } from '../src/settings/registry.js';

// T-101 3D.5 필수 상한: 시간·토큰(비용)·반복 수. 초과 시 일시정지(budget)

const L = { maxMinutes: 10, maxTokens: 1000, maxCostUsd: 1, maxIterations: 3 };

describe('3D.5 상한 초과', () => {
  it('설정 4개가 mode 그룹에 등록, 기본값은 DEFAULT_AUTO_LIMITS', () => {
    for (const k of ['maxMinutes', 'maxTokens', 'maxCostUsd', 'maxIterations'])
      expect(settingsRegistry.get(`mode.auto.${k}`)?.group).toBe('mode');
    expect(limitsFromSettings({})).toEqual(DEFAULT_AUTO_LIMITS);
    expect(limitsFromSettings({ mode: { auto: { maxMinutes: 5 } } }).maxMinutes).toBe(5);
  });

  it('상한은 꼭 있어야 한다: 0·음수·글자는 기본값으로 (비용 0은 끔)', () => {
    expect(normalizeLimits({ maxMinutes: 0, maxTokens: -1, maxIterations: Number.NaN })).toMatchObject({
      maxMinutes: DEFAULT_AUTO_LIMITS.maxMinutes,
      maxTokens: DEFAULT_AUTO_LIMITS.maxTokens,
      maxIterations: DEFAULT_AUTO_LIMITS.maxIterations,
    });
    expect(normalizeLimits({ maxCostUsd: 0 }).maxCostUsd).toBe(0);
  });

  it('설명은 쉬운 말 4줄', () => {
    const lines = describeLimits(L);
    expect(lines).toHaveLength(4);
    for (const l of lines) expect(checkPlainKorean(l).ok, l).toBe(true);
  });

  it.each([
    ['time', { startedAt: 0, now: 10 * 60_000, tokens: 0, costUsd: 0, iterations: 0 }],
    ['cost', { startedAt: 0, now: 0, tokens: 0, costUsd: 1, iterations: 0 }],
    ['tokens', { startedAt: 0, now: 0, tokens: 1000, costUsd: 0, iterations: 0 }],
    ['iterations', { startedAt: 0, now: 0, tokens: 0, costUsd: 0, iterations: 3 }],
  ] as const)('%s 초과', (key, u) => {
    const ex = checkLimits(u, L);
    expect(ex?.key).toBe(key);
    expect(checkPlainKorean(ex!.message).ok).toBe(true);
  });

  it('감시자: 넘는 순간 한 번만 일시정지(budget), 그 전엔 계속', () => {
    let t = 0;
    const pause = vi.fn();
    const g = createLimitGuard({ limits: L, pause, now: () => t });
    expect(g.record({ tokens: 100 })).toBeUndefined();
    expect(g.record({ tokens: 100 })).toBeUndefined();
    t = 60_000;
    const ex = g.record({ tokens: 100 }); // 반복 3회째
    expect(ex?.key).toBe('iterations');
    expect(pause).toHaveBeenCalledOnce();
    expect(pause).toHaveBeenCalledWith('budget', ex);
    g.record();
    expect(pause).toHaveBeenCalledOnce();
  });

  it('비용 0(끔)이면 비용으로는 멈추지 않는다', () => {
    expect(
      checkLimits({ startedAt: 0, now: 0, tokens: 0, costUsd: 99, iterations: 0 }, { ...L, maxCostUsd: 0 }),
    ).toBeUndefined();
  });
});
