import { describe, expect, it } from 'vitest';
import { JudgeCache, judgeCacheKey, normalizeForCache } from '../src/cache.js';
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

describe('E.12 캐시: (종류, 정규화 기대값 해시, 정규화 실제값 해시)', () => {
  it('키는 정규화 후 해시 — 원문은 키에 없음', () => {
    expect(normalizeForCache('  a\r\nb\t c  ')).toBe('a\nb c');
    const k = judgeCacheKey('path', 'secret-value', 'x');
    expect(k).toMatch(/^path:[0-9a-f]{64}:[0-9a-f]{64}$/);
    expect(k).not.toContain('secret-value');
    expect(judgeCacheKey('path', 'a\r\n', ' a')).toBe(judgeCacheKey('path', 'a', 'a'));
    expect(judgeCacheKey('text', 'a', 'b')).not.toBe(judgeCacheKey('path', 'a', 'b'));
  });

  it('같은 쌍 2회 판정 → 판정기 호출 1회', async () => {
    const b = scriptedBackend([YES]);
    const chain = chainWith(b);
    const first = await chain.judge(req('하네스/모바일', 'ai/mobile'));
    const second = await chain.judge(req('하네스/모바일\r\n', ' ai/mobile'));
    expect(first.verdict).toBe('equal');
    expect(second).toEqual(first);
    expect(b.calls).toBe(1);
    expect(chain.budget.usedBy('s1')).toBe(1);
  });

  it('unavailable은 캐시하지 않는다 (다음에 다시 시도)', async () => {
    const b = scriptedBackend([undefined, YES]);
    const chain = chainWith(b);
    expect((await chain.judge(req('a', 'b'))).verdict).toBe('unavailable');
    expect((await chain.judge(req('a', 'b'))).verdict).toBe('equal');
    const c = new JudgeCache();
    c.set('k', { verdict: 'unavailable', confidence: 0, reason: 'x' });
    expect(c.size).toBe(0);
  });
});
