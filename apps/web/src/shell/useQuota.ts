import type { HarnessEvent } from '@harness-x/protocol';
import { useEffect, useMemo, useState } from 'react';
import type { HarnessApiClient } from '../api/client.js';
import type { QuotaMeter } from './types.js';

/** 커널 GET /api/quota 응답 (packages/kernel/src/api/quota-route.ts) */
export interface QuotaSummary {
  engineId: string;
  totalTokens: number;
  requests: number;
  costUsd: number;
  costEstimated: boolean;
  ratio?: number;
  level: string;
}

/** 엔진 목록 + 집계 → 상단 바 막대 (집계가 없는 엔진은 빈 자리) */
export function toQuotaMeters(
  engines: { id: string; label: string }[],
  summaries: QuotaSummary[],
): QuotaMeter[] {
  const by = new Map(summaries.map((s) => [s.engineId, s]));
  const ids = [...engines.map((e) => e.id), ...summaries.map((s) => s.engineId)];
  return [...new Set(ids)].map((id) => {
    const s = by.get(id);
    return {
      engineId: id,
      label: engines.find((e) => e.id === id)?.label ?? id,
      ...(s
        ? {
            ...(s.ratio !== undefined ? { ratio: s.ratio } : {}),
            totalTokens: s.totalTokens,
            requests: s.requests,
            costUsd: s.costUsd,
            costEstimated: s.costEstimated,
          }
        : {}),
    };
  });
}

/** 60.2 쿼터 미터 데이터 — 시작 시 1회 + usage/error 이벤트가 올 때마다 다시 읽는다 */
export function useQuota(
  client: Pick<HarnessApiClient, 'request'> | undefined,
  events: readonly HarnessEvent[],
  engines: { id: string; label: string }[],
): QuotaMeter[] | undefined {
  const [summaries, setSummaries] = useState<QuotaSummary[]>();
  const tick = useMemo(() => events.filter((e) => e.type === 'usage' || e.type === 'error').length, [events]);
  useEffect(() => {
    if (!client) return;
    let live = true;
    client
      .request<{ engines: QuotaSummary[] }>('/api/quota')
      .then((r) => live && setSummaries(r.engines))
      .catch(() => {
        /* 쿼터 라우트 없음 → 빈 자리 유지 */
      });
    return () => {
      live = false;
    };
  }, [client, tick]);
  return useMemo(() => (summaries ? toQuotaMeters(engines, summaries) : undefined), [engines, summaries]);
}
