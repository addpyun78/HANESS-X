import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HarnessApiClient } from '../../api/client.js';
import type { Toast } from './useApprovals.js';

/**
 * 한 번만 보여 주는 안내 (T-100 J.6) — 예: "더 이상 쓰지 않는 판정 서비스 키를 지웠어요"
 *  - 서버가 시작할 때 남긴 안내: GET /api/notices (패널이 나중에 열려도 보인다)
 *  - 실행 중에 생긴 안내: /ws/events의 type 'notice' 이벤트
 * 같은 안내(noticeId)는 한 번만 토스트로 띄운다.
 */

export interface NoticeData {
  noticeId: string;
  level?: string;
  message: string;
}

export interface NoticesApi {
  /** GET /api/notices (없는 서버면 빈 목록) */
  list(): Promise<NoticeData[]>;
}

export function noticesApi(c: Pick<HarnessApiClient, 'request'>): NoticesApi {
  return {
    list: async () => {
      try {
        return (await c.request<{ notices?: NoticeData[] }>('/api/notices')).notices ?? [];
      } catch {
        return [];
      }
    },
  };
}

function isNotice(e: unknown): e is NoticeData & { type: 'notice' } {
  if (!e || typeof e !== 'object') return false;
  const o = e as Record<string, unknown>;
  return o.type === 'notice' && typeof o.noticeId === 'string' && typeof o.message === 'string';
}

export function noticesFromEvents(events: readonly unknown[]): NoticeData[] {
  return events.filter(isNotice).map((e) => ({ noticeId: e.noticeId, message: e.message, level: e.level }));
}

export const noticeToastId = (noticeId: string) => `n-${noticeId}`;

export function useNotices({ events, api }: { events: readonly unknown[]; api?: NoticesApi }) {
  const [loaded, setLoaded] = useState<NoticeData[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!api) return;
    let alive = true;
    void api.list().then((n) => alive && setLoaded(n));
    return () => {
      alive = false;
    };
  }, [api]);

  const toasts = useMemo<Toast[]>(() => {
    const seen = new Set<string>();
    const out: Toast[] = [];
    for (const n of [...loaded, ...noticesFromEvents(events)]) {
      const id = noticeToastId(n.noticeId);
      if (seen.has(n.noticeId) || dismissed.has(id)) continue;
      seen.add(n.noticeId);
      out.push({ id, text: n.message });
    }
    return out;
  }, [loaded, events, dismissed]);

  const dismiss = useCallback((id: string) => setDismissed((s) => (s.has(id) ? s : new Set(s).add(id))), []);
  return { toasts, dismiss };
}
