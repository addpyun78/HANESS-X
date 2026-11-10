import type { FastifyInstance } from 'fastify';
import type { EventLog } from '../event-log.js';
import { aggregateUsage, quotaLevel, type QuotaOptions } from '../quota.js';

export interface QuotaApiOptions extends QuotaOptions {
  /** 집계 시작 시각(ISO) — 예: 현재 리셋 창의 시작. 기본: 전체 */
  since?: () => string | undefined;
}

/** 60.2 GET /api/quota → 엔진별 사용량·사용률·막대 색 단계 */
export function registerQuotaRoute(app: FastifyInstance, log: EventLog, o: QuotaApiOptions): void {
  app.get('/api/quota', async () => {
    const since = o.since?.();
    const q = since ? { since } : {};
    const events = [...log.query({ ...q, type: 'usage' }), ...log.query({ ...q, type: 'error' })];
    return {
      engines: aggregateUsage(events, o).map((s) => ({ ...s, level: quotaLevel(s.ratio) })),
    };
  });
}
