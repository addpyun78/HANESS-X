import { describe, expect, it } from 'vitest';
import type { EnginesSettings } from '../src/engines-settings.js';
import {
  decideOnQuotaExceeded,
  parseResetAt,
  runChecklistWithFailover,
  type FailoverRunInput,
  type FailoverRunResult,
  type ResumableLedger,
} from '../src/quota.js';

const SETTINGS: EnginesSettings = {
  engines: {
    'claude-code': { mode: 'subscription', fallback: ['codex'] },
    codex: { mode: 'subscription', fallback: [] },
  },
};

/** 메모리 원장: 항목 순서대로, done이면 다음 */
function memLedger(ids: string[]) {
  const done = new Set<string>();
  const ledger: ResumableLedger & { done: Set<string> } = {
    done,
    currentItem: () => {
      const id = ids.find((i) => !done.has(i));
      return id ? { id } : null;
    },
    nextItems: (n = 3) =>
      ids
        .filter((i) => !done.has(i))
        .slice(1, 1 + n)
        .map((id) => ({ id })),
  };
  return ledger;
}

/** 엔진별 남은 호출 수 → 0이면 quota_exceeded */
function sim(budget: Record<string, number>, resetAt?: Date) {
  const calls: string[] = [];
  return {
    calls,
    budget,
    run(ledger: ReturnType<typeof memLedger>) {
      return async (i: FailoverRunInput): Promise<FailoverRunResult> => {
        const key = `${i.selection.engineId}:${i.selection.mode}`;
        calls.push(`${key}@${i.item.id}`);
        if ((budget[key] ?? 0) <= 0)
          return { status: 'quota_exceeded', ...(resetAt ? { resetAt } : {}), message: 'usage limit' };
        budget[key]!--;
        ledger.done.add(i.item.id);
        return { status: 'done' };
      };
    },
  };
}

describe('60.3 quota_exceeded → API 모드 → 폴백 엔진 → 일시정지 후 재개 (시뮬레이션 3경로)', () => {
  it('경로 1: 구독 한도 → 같은 엔진 API 모드(키체인에 키 있음)로 계속', async () => {
    const ledger = memLedger(['1.1', '1.2', '1.3']);
    const s = sim({ 'claude-code:subscription': 1, 'claude-code:apiKey': 10 });
    const r = await runChecklistWithFailover({
      ledger,
      start: { engineId: 'claude-code', mode: 'subscription' },
      route: { settings: SETTINGS, hasApiKey: (id) => id === 'claude-code' },
      runItem: s.run(ledger),
      sleepUntil: async () => {
        throw new Error('일시정지하면 안 됨');
      },
    });
    expect(r.status).toBe('completed');
    expect(r.decisions.map((d) => d.action)).toEqual(['switch-mode']);
    expect(s.calls).toEqual([
      'claude-code:subscription@1.1',
      'claude-code:subscription@1.2',
      'claude-code:apiKey@1.2',
      'claude-code:apiKey@1.3',
    ]);
  });

  it('경로 2: 키 없음 → 폴백 엔진(codex)으로 전환', async () => {
    const ledger = memLedger(['1.1', '1.2', '1.3']);
    const s = sim({ 'claude-code:subscription': 1, 'codex:subscription': 10 });
    const r = await runChecklistWithFailover({
      ledger,
      start: { engineId: 'claude-code', mode: 'subscription' },
      route: { settings: SETTINGS, hasApiKey: () => false },
      runItem: s.run(ledger),
      sleepUntil: async () => {
        throw new Error('일시정지하면 안 됨');
      },
    });
    expect(r.status).toBe('completed');
    expect(r.decisions).toEqual([
      {
        action: 'fallback',
        from: { engineId: 'claude-code', mode: 'subscription' },
        to: { engineId: 'codex', mode: 'subscription' },
      },
    ]);
    expect(s.calls.slice(-2)).toEqual(['codex:subscription@1.2', 'codex:subscription@1.3']);
  });

  it('경로 3: API 모드·폴백 모두 한도 → 리셋 시각까지 일시정지 → 처음 엔진으로 재개', async () => {
    const ledger = memLedger(['1.1', '1.2', '1.3']);
    const resetAt = new Date('2026-11-10T05:00:00.000Z');
    const s = sim(
      { 'claude-code:subscription': 1, 'claude-code:apiKey': 0, 'codex:subscription': 0 },
      resetAt,
    );
    const slept: (Date | undefined)[] = [];
    const r = await runChecklistWithFailover({
      ledger,
      start: { engineId: 'claude-code', mode: 'subscription' },
      route: { settings: SETTINGS, hasApiKey: (id) => id === 'claude-code' },
      runItem: s.run(ledger),
      sleepUntil: async (until) => {
        slept.push(until);
        s.budget['claude-code:subscription'] = 10; // 리셋
      },
    });
    expect(r.status).toBe('completed');
    expect(r.decisions.map((d) => d.action)).toEqual(['switch-mode', 'fallback', 'pause']);
    expect(slept).toEqual([resetAt]);
    expect(s.calls).toEqual([
      'claude-code:subscription@1.1',
      'claude-code:subscription@1.2',
      'claude-code:apiKey@1.2',
      'codex:subscription@1.2',
      'claude-code:subscription@1.2',
      'claude-code:subscription@1.3',
    ]);
  });

  it('결정 규칙 세부: 사용 불가 엔진 건너뜀, apiKey 모드 시작이면 바로 폴백, 리셋 시각 파싱', () => {
    const cur = { engineId: 'claude-code', mode: 'subscription' as const };
    expect(
      decideOnQuotaExceeded(cur, {
        settings: SETTINGS,
        hasApiKey: () => false,
        available: (id) => id !== 'codex',
        exhausted: new Set(),
      }),
    ).toEqual({ action: 'pause', from: cur });
    expect(
      decideOnQuotaExceeded(
        { engineId: 'claude-code', mode: 'apiKey' },
        { settings: SETTINGS, hasApiKey: () => true, exhausted: new Set() },
      ).action,
    ).toBe('fallback');
    const now = new Date('2026-11-10T00:00:00.000Z');
    expect(parseResetAt('limit; resets at 2026-11-10T03:00:00Z', now)?.toISOString()).toBe(
      '2026-11-10T03:00:00.000Z',
    );
    expect(parseResetAt('Please try again in 90 minutes', now)?.toISOString()).toBe(
      '2026-11-10T01:30:00.000Z',
    );
    expect(parseResetAt('no hint', now)).toBeUndefined();
  });
});
