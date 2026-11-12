import type { HarnessEvent } from '@harness-x/protocol';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../api/client.js';
import type { ChecklistApi } from './api.js';
import { ApprovalCard } from './ApprovalCard.js';
import { ChecklistProgress, ChecklistTree } from './ChecklistTree.js';
import {
  applyChecklistChange,
  pendingApprovals,
  type ApprovalDecision,
  type ChecklistView,
} from './model.js';
import { PlanReview } from './PlanReview.js';
import { StageTree } from './StageTree.js';
import './checklist.css';

export interface ChecklistPanelProps {
  events: readonly HarnessEvent[];
  /** 없으면 initialView 또는 마지막 checklist_change/approval_request 이벤트의 세션 */
  sessionId?: string;
  api?: ChecklistApi;
  /** 서버 없이 그릴 때(테스트·데모) */
  initialView?: ChecklistView;
  /** checklist_change 뒤 서버 재조회까지 대기 (기본 150ms — 증거·판정 갱신용) */
  refetchDelayMs?: number;
}

function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const b = err.body as
      { message?: string; status?: string; error?: string; unknownWords?: string[] } | undefined;
    if (b?.status === 'lint') return '린터 위반이 있어 Lock할 수 없습니다';
    if (b?.status === 'already_locked') return '이미 Lock된 계획입니다';
    if (b?.status === 'needs_approval')
      return `영문 이름 확인이 필요합니다: ${(b.unknownWords ?? []).join(', ')}`;
    return b?.message ?? b?.error ?? err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

function sessionOf(events: readonly HarnessEvent[]): string | undefined {
  for (let k = events.length - 1; k >= 0; k--) {
    const e = events[k]!;
    if (e.type === 'checklist_change' || e.type === 'approval_request') return e.sessionId;
  }
  return undefined;
}

/** T-036 체크리스트 패널: 트리·진행률·펼침(사다리 결과)·승인 카드·Lock 전 계획 검토 */
export function ChecklistPanel({
  events,
  sessionId: sessionProp,
  api,
  initialView,
  refetchDelayMs = 150,
}: ChecklistPanelProps) {
  const [view, setView] = useState<ChecklistView | undefined>(initialView);
  const [loadError, setLoadError] = useState<string>();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [resolved, setResolved] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState<string>();
  const [cardError, setCardError] = useState<{ id: string; message: string }>();
  const [lockError, setLockError] = useState<string>();
  const sessionId = sessionProp ?? initialView?.sessionId ?? sessionOf(events);

  const reqId = useRef(0);
  const refetch = useCallback(async () => {
    if (!api || !sessionId) return;
    const id = ++reqId.current;
    try {
      const v = await api.get(sessionId);
      if (id !== reqId.current) return;
      setView(v);
      setLoadError(undefined);
    } catch (err) {
      if (id !== reqId.current) return;
      if (err instanceof ApiError && err.status === 404) setView(undefined);
      else setLoadError(errorText(err));
    }
  }, [api, sessionId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // 36.2 checklist_change: 즉시 상태 반영 + 잠시 뒤 재조회(증거·판정)
  const seen = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (events.length < seen.current) seen.current = 0;
    const fresh = events.slice(seen.current);
    seen.current = events.length;
    const changes = fresh.filter((e) => e.type === 'checklist_change' && e.sessionId === sessionId);
    if (changes.length === 0) return;
    setView((v) => (v ? changes.reduce(applyChecklistChange, v) : v));
    if (api) {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void refetch(), refetchDelayMs);
    }
  }, [events, sessionId, api, refetch, refetchDelayMs]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const approvals = useMemo(
    () => pendingApprovals(events, sessionId, resolved),
    [events, sessionId, resolved],
  );

  const decide = async (approvalId: string, decision: ApprovalDecision) => {
    if (!api) return;
    setBusy(approvalId);
    setCardError(undefined);
    try {
      await api.resolveApproval(approvalId, decision);
      setResolved((s) => new Set(s).add(approvalId));
      void refetch();
    } catch (err) {
      setCardError({ id: approvalId, message: errorText(err) });
    } finally {
      setBusy(undefined);
    }
  };

  const lock = async () => {
    if (!api || !sessionId) return;
    setBusy('lock');
    setLockError(undefined);
    try {
      await api.lock(sessionId);
      await refetch();
    } catch (err) {
      setLockError(errorText(err));
    } finally {
      setBusy(undefined);
    }
  };

  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const cards = approvals.map((a) => (
    <ApprovalCard
      key={a.approvalId}
      approval={a}
      busy={busy === a.approvalId}
      {...(api ? { onDecide: (d: ApprovalDecision) => void decide(a.approvalId, d) } : {})}
      {...(cardError?.id === a.approvalId ? { error: cardError.message } : {})}
    />
  ));

  if (!view)
    return (
      <section className="hx-ck" aria-label="체크리스트">
        {cards}
        <p className="hx-panel-empty">{loadError ?? '아직 체크리스트가 없습니다'}</p>
      </section>
    );

  const items = view.checklist.items;
  const tree = (flagged?: ReadonlySet<string>) => (
    <ChecklistTree
      items={items}
      currentItemId={view.currentItemId}
      expanded={expanded}
      onToggle={toggle}
      {...(flagged ? { flagged } : {})}
    />
  );

  return (
    <section className="hx-ck" aria-label="체크리스트" data-version={view.checklist.version}>
      {cards}
      {view.plan.locked && view.stages && view.stages.stages.length > 1 ? (
        <StageTree tree={view.stages} />
      ) : view.plan.locked ? (
        <>
          <ChecklistProgress items={items} />
          {tree()}
        </>
      ) : (
        <PlanReview
          violations={view.lint.violations}
          busy={busy === 'lock'}
          {...(api ? { onApprove: () => void lock() } : {})}
          {...(lockError ? { error: lockError } : {})}
        >
          {tree(new Set(view.lint.violations.map((v) => v.itemId)))}
        </PlanReview>
      )}
      {loadError && (
        <p className="hx-ck-error" role="alert">
          {loadError}
        </p>
      )}
    </section>
  );
}
