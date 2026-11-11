import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../api/client.js';
import type { ApprovalsApi } from './api.js';
import {
  AREA_TITLE,
  countBySession,
  pendingFromEvents,
  titleWithCount,
  type ApprovalCardData,
  type ChoiceId,
} from './model.js';

/** 채팅 축소 카드 → 패널 카드로 이동 (H.14) */
export interface ApprovalFocus {
  focus(cardId: string): void;
}
export const ApprovalFocusContext = createContext<ApprovalFocus | undefined>(undefined);

export interface Toast {
  id: string;
  /** 승인 카드 토스트면 그 카드 (누르면 패널의 카드로). 안내 토스트(notice)는 없음 */
  cardId?: string;
  text: string;
}

/** 승인 카드 영역에 함께 뜨는 다른 카드 요약 (Part 2 설치 계획 카드 — 토스트·탭 제목·사이드바 배지에 함께 센다) */
export interface ExtraPending {
  id: string;
  sessionId?: string;
  /** 토스트·알림 글 */
  text: string;
}

const NO_EXTRA: readonly ExtraPending[] = [];

export interface UseApprovalsOptions {
  events: readonly unknown[];
  /** T-100 P2-D.8 설치 계획 카드 등 */
  extra?: readonly ExtraPending[];
  api?: ApprovalsApi;
  /** 서버 없이 그릴 때(테스트·데모) */
  initial?: ApprovalCardData[];
  /** 탭 제목 기본값 (기본: 처음 document.title) */
  baseTitle?: string;
  /** 브라우저 알림 (테스트에서 바꿔 끼운다). 기본 window.Notification */
  notifier?: NotifierLike;
}

export interface NotifierLike {
  permission: NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
  show(title: string, body: string, onClick: () => void): void;
}

const ASKED_KEY = 'hx.approvals.notify-asked';

function browserNotifier(): NotifierLike | undefined {
  if (typeof window === 'undefined' || typeof window.Notification === 'undefined') return undefined;
  const N = window.Notification;
  return {
    get permission() {
      return N.permission;
    },
    requestPermission: () => N.requestPermission(),
    show: (title, body, onClick) => {
      const n = new N(title, { body, tag: 'hx-approval' });
      n.onclick = () => {
        window.focus();
        onClick();
      };
    },
  };
}

function askedBefore(): boolean {
  try {
    return localStorage.getItem(ASKED_KEY) === '1';
  } catch {
    return false;
  }
}
function markAsked(): void {
  try {
    localStorage.setItem(ASKED_KEY, '1');
  } catch {
    /* 저장 못 해도 동작에는 지장 없음 */
  }
}

function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const b = err.body as { message?: string } | undefined;
    return b?.message ?? err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * 승인 카드 상태 묶음 (T-100 H.11~H.14)
 *  - 대기 카드: GET /api/approvals?status=pending + approval_request/approval_resolved 이벤트
 *  - 새 카드: 토스트 + 탭 제목 "(n)" + 백그라운드면 OS 알림(첫 1회 권한 요청)
 */
export function useApprovals({
  events,
  api,
  initial = [],
  baseTitle,
  notifier,
  extra = NO_EXTRA,
}: UseApprovalsOptions) {
  const [loaded, setLoaded] = useState<ApprovalCardData[]>(initial);
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState<string>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [last, setLast] = useState<{ cardId: string; message?: string }>();
  const [focusId, setFocusId] = useState<string>();

  useEffect(() => {
    if (!api) return;
    let alive = true;
    api
      .pending()
      .then((cards) => alive && setLoaded(cards))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [api]);

  const pending = useMemo(
    () => pendingFromEvents(loaded, events).filter((c) => !done.has(c.id)),
    [loaded, events, done],
  );

  // 승인 카드 + 함께 뜨는 카드(설치 계획) — 알림·탭 제목·배지는 모두 센다
  const all = useMemo<ExtraPending[]>(
    () => [
      ...pending.map((c) => ({
        id: c.id,
        ...(c.sessionId ? { sessionId: c.sessionId } : {}),
        text: c.whatHappened,
      })),
      ...extra,
    ],
    [pending, extra],
  );

  // ── 새 카드 알림 (H.12·H.13) ─────────────────────────────────
  const seen = useRef<Set<string> | undefined>(undefined);
  const notify = useMemo(() => notifier ?? browserNotifier(), [notifier]);
  useEffect(() => {
    const first = seen.current === undefined;
    seen.current ??= new Set();
    const fresh = all.filter((c) => !seen.current!.has(c.id));
    for (const c of all) seen.current.add(c.id);
    if (first && fresh.length === 0) return;
    if (fresh.length === 0) return;
    setToasts((ts) => [
      ...ts,
      ...fresh.map((c) => ({ id: `t-${c.id}`, cardId: c.id, text: `${AREA_TITLE} — ${c.text}` })),
    ]);
    if (typeof document !== 'undefined' && document.hidden && notify) {
      const show = () => notify.show(AREA_TITLE, fresh[0]!.text, () => setFocusId(fresh[0]!.id));
      if (notify.permission === 'granted') show();
      else if (notify.permission === 'default' && !askedBefore()) {
        markAsked();
        void notify.requestPermission().then((p) => p === 'granted' && show());
      }
    }
  }, [all, notify]);

  // ── 탭 제목 "(n)" ───────────────────────────────────────────────
  const base = useRef(baseTitle);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    base.current ??= document.title;
    document.title = titleWithCount(base.current, all.length);
  }, [all.length]);
  useEffect(
    () => () => {
      if (typeof document !== 'undefined' && base.current !== undefined) document.title = base.current;
    },
    [],
  );

  const choose = useCallback(
    async (id: string, choice: ChoiceId, remember: boolean) => {
      if (!api) return;
      setBusy(id);
      setErrors(({ [id]: _drop, ...rest }) => rest);
      try {
        const r = await api.choose(id, choice, remember);
        setDone((s) => new Set(s).add(id));
        setToasts((ts) => ts.filter((t) => t.cardId !== id));
        const message = r?.result?.outcome?.message;
        setLast({ cardId: id, ...(message ? { message } : {}) });
      } catch (err) {
        setErrors((e) => ({ ...e, [id]: errorText(err) }));
      } finally {
        setBusy(undefined);
      }
    },
    [api],
  );

  const undo = useCallback(async () => {
    if (!api || !last) return;
    try {
      await api.undo();
      setDone((s) => {
        const n = new Set(s);
        n.delete(last.cardId);
        return n;
      });
      setLast(undefined);
    } catch (err) {
      setErrors((e) => ({ ...e, [last.cardId]: errorText(err) }));
    }
  }, [api, last]);

  const dismissToast = useCallback((id: string) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);

  return {
    pending,
    bySession: countBySession(all),
    busy,
    errors,
    toasts,
    dismissToast,
    choose,
    undo,
    last,
    focusId,
    setFocusId,
  };
}

export type ApprovalsState = ReturnType<typeof useApprovals>;
