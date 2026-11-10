import { describe, expect, it } from 'vitest';
import { aggregateUsage, quotaLevel, UsageAggregator } from '../src/quota.js';
import { bootApi } from './api-fixtures.js';

const u = (engineId: string, body: Record<string, unknown>, n = 0) => ({
  id: `${engineId}-${n}-${Math.random()}`,
  ts: `2026-11-10T00:00:${String(n).padStart(2, '0')}.000Z`,
  sessionId: 's-q',
  engineId,
  type: 'usage',
  inputTokens: 0,
  outputTokens: 0,
  ...body,
});

describe('60.1 엔진별 usage 집계', () => {
  it('토큰·요청 수·비용(보고값/단가 추정)·사용률(엔진 보고 최신값/한도 기준)', () => {
    const events = [
      u('claude-code', { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 500, costUsd: 0.01 }, 1),
      u('claude-code', { inputTokens: 2000, outputTokens: 300, costUsd: 0.02, quotaRatio: 0.5 }, 2),
      u('claude-code', { inputTokens: 100, outputTokens: 10, quotaRatio: 0.42 }, 3),
      // 쿼터 조회(토큰 0)는 요청으로 세지 않음
      u('codex', { quotaRatio: 0.3 }, 4),
      u('codex', { inputTokens: 1_000_000, outputTokens: 100_000 }, 5),
      u('openai-compat', { inputTokens: 40_000, outputTokens: 10_000 }, 6),
      { id: 'x', ts: '2026-11-10T00:00:07.000Z', sessionId: 's', type: 'assistant_text', text: 'skip' },
    ];
    const out = aggregateUsage(events, {
      pricing: { codex: { inputPerMTok: 1.25, outputPerMTok: 10 } },
      limits: { 'openai-compat': { tokens: 100_000, requests: 10 } },
    });
    expect(out.map((s) => s.engineId)).toEqual(['claude-code', 'codex', 'openai-compat']);
    const [cc, cx, oc] = out;
    expect(cc).toMatchObject({
      inputTokens: 3100,
      outputTokens: 510,
      cacheReadTokens: 500,
      totalTokens: 4110,
      requests: 3,
      costUsd: 0.03,
      costEstimated: false,
      ratio: 0.42,
      ratioSource: 'engine',
      exceeded: false,
      lastTs: '2026-11-10T00:00:03.000Z',
    });
    // codex: 비용 없음 → 단가 추정 1.25 + 1.0 = 2.25
    expect(cx).toMatchObject({ requests: 1, costUsd: 2.25, costEstimated: true, ratio: 0.3 });
    // 로컬 LLM: 엔진 사용률 없음 → 한도 기준 max(50k/100k, 1/10) = 0.5
    expect(oc).toMatchObject({ requests: 1, ratio: 0.5, ratioSource: 'limit', costUsd: 0 });
  });

  it('quota_exceeded 오류를 받으면 사용률 1 (한도 도달), 증분 add 결과 = 일괄 집계', () => {
    const events = [
      u('codex', { inputTokens: 10, outputTokens: 5, quotaRatio: 0.9 }, 1),
      { type: 'error', engineId: 'codex', code: 'quota_exceeded', ts: '2026-11-10T00:00:02.000Z' },
    ];
    const agg = new UsageAggregator();
    for (const e of events) agg.add(e);
    expect(agg.summary('codex')).toMatchObject({ ratio: 1, ratioSource: 'quota_exceeded', exceeded: true });
    expect(agg.summaries()).toEqual(aggregateUsage(events));
    expect(agg.summary('none')).toBeUndefined();
  });

  it('막대 색 단계: 80% 노랑, 95% 빨강', () => {
    expect(quotaLevel(undefined)).toBe('unknown');
    expect(quotaLevel(0.79)).toBe('ok');
    expect(quotaLevel(0.8)).toBe('warning');
    expect(quotaLevel(0.949)).toBe('warning');
    expect(quotaLevel(0.95)).toBe('danger');
    expect(quotaLevel(1)).toBe('danger');
  });

  it('GET /api/quota: 이벤트 로그의 usage·error를 집계 + level', async () => {
    const api = await bootApi({ quota: {} });
    api.env.log.append(u('codex', { inputTokens: 100, outputTokens: 20, quotaRatio: 0.85 }, 1));
    api.env.log.append(u('claude-code', { inputTokens: 5, outputTokens: 1, quotaRatio: 0.2 }, 2));
    const r = await api.get('/api/quota', api.auth);
    const body = (await r.json()) as { engines: { engineId: string; level: string; requests: number }[] };
    expect(body.engines.map((e) => [e.engineId, e.level, e.requests])).toEqual([
      ['claude-code', 'ok', 1],
      ['codex', 'warning', 1],
    ]);
    await api.close();
  });
});
