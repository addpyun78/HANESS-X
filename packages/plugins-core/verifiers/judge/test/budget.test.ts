import { describe, expect, it } from 'vitest';
import { SessionCallBudget } from '../src/budget.js';
import { createJudgeChain } from '../src/chain.js';
import { scriptedBackend, YES } from './helpers.js';

const noEngines = { listEngines: () => [] };

function chainWith(backend: ReturnType<typeof scriptedBackend>, settings = {}) {
  return createJudgeChain(
    { samples: 1, ...settings },
    {
      ...noEngines,
      probeOllama: async () => ({ running: true, models: ['qwen2.5-coder:7b'] }),
      createLocalJudge: () => backend,
    },
  );
}

const req = (expected: string, actual: string, sessionId = 's1') => ({
  kind: 'path',
  expected,
  actual,
  itemTitle: '폴더',
  sessionId,
});

describe('E.13 세션 호출 상한 초과 → 의미 판단 생략, 승인 카드로', () => {
  it('SessionCallBudget: 남은 만큼만 예약, 초과 예약은 아무것도 안 바꿈', () => {
    const b = new SessionCallBudget(5);
    expect(b.tryReserve('s', 3)).toBe(true);
    expect(b.tryReserve('s', 3)).toBe(false);
    expect(b.usedBy('s')).toBe(3);
    expect(b.tryReserve('s', 2)).toBe(true);
    expect(b.remaining('s')).toBe(0);
    expect(b.remaining('other')).toBe(5);
  });

  it('maxCallsPerSession=2, samples=1: 3번째 새 쌍은 호출 없이 unavailable(limit)', async () => {
    const b = scriptedBackend([YES]);
    const chain = chainWith(b, { maxCallsPerSession: 2 });
    expect((await chain.judge(req('a', '1'))).verdict).toBe('equal');
    expect((await chain.judge(req('a', '2'))).verdict).toBe('equal');
    const third = await chain.judge(req('a', '3'));
    expect(third).toEqual({ verdict: 'unavailable', confidence: 0, reason: 'limit' });
    expect(b.calls).toBe(2);
    // 캐시된 쌍은 상한과 무관하게 답한다
    expect((await chain.judge(req('a', '1'))).verdict).toBe('equal');
    // 다른 세션은 따로 센다
    expect((await chain.judge(req('a', '3', 's2'))).verdict).toBe('equal');
    expect(b.calls).toBe(3);
  });

  it('samples=3인데 남은 호출이 2회면 판정하지 않음 (부분 표본 금지)', async () => {
    const b = scriptedBackend([YES]);
    const chain = chainWith(b, { samples: 3, maxCallsPerSession: 5 });
    expect((await chain.judge(req('a', '1'))).verdict).toBe('equal');
    expect((await chain.judge(req('a', '2'))).reason).toBe('limit');
    expect(b.calls).toBe(3);
  });

  it('maxCallsPerSession=0 → 항상 limit, 호출 0회', async () => {
    const b = scriptedBackend([YES]);
    const chain = chainWith(b, { maxCallsPerSession: 0 });
    expect((await chain.judge(req('a', 'b'))).reason).toBe('limit');
    expect(b.calls).toBe(0);
  });
});
