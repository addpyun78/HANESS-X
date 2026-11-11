import { useState } from 'react';
import { ApiError } from '../api/client.js';
import { ActionCard } from '../panels/Approvals/ActionCard.js';
import type { InstallApi, InstallJobView } from './api.js';
import {
  ADMIN_WAITING_TEXT,
  planToCard,
  resolveFailureCard,
  type InstallPlanView,
  type ResolveResultView,
} from './model.js';

export interface InstallPlanCardProps {
  plan: InstallPlanView;
  /** 실행 API (없으면 버튼만 그린다 — 미리보기) */
  api?: Pick<InstallApi, 'execute'>;
  /** [다른 방법 보기] */
  onAlternatives?: (plan: InstallPlanView) => void;
  /** [취소] 또는 끝난 뒤 카드 닫기 */
  onClose?: (plan: InstallPlanView) => void;
  onStarted?: (plan: InstallPlanView, job: InstallJobView) => void;
  /** 주소 열기 (기본 window.open, 새 창·opener 없음) */
  openUrl?: (url: string) => void;
  autoFocus?: boolean;
}

export function openExternal(url: string): void {
  if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer');
}

function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const b = err.body as { message?: string } | undefined;
    return b?.message ?? err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

const RUNNING_TEXT = '설치를 시작했어요. 진행 상황은 터미널 패널에서 볼 수 있어요.';

/**
 * 설치 계획 카드 (T-100 P2-D) — 승인 카드와 같은 ActionCard로 그린다 (D.8).
 * [설치]는 사람이 직접 누를 때만 클릭 토큰을 받아 실행한다. 자동 실행·결제 자동화는 없다 (D.3).
 */
export function InstallPlanCard({
  plan,
  api,
  onAlternatives,
  onClose,
  onStarted,
  openUrl = openExternal,
  autoFocus,
}: InstallPlanCardProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();
  // D.2 배지가 없으면 여기서 오류가 난다 (렌더 오류 — 배지 없는 카드는 그리지 않는다)
  const card = planToCard(plan, {
    alternatives: !!onAlternatives,
    ...(status ? { status } : {}),
  });

  const onChoose = (id: string) => {
    if (id === 'cancel') return onClose?.(plan);
    if (id === 'alternatives') return onAlternatives?.(plan);
    if (id === 'open-purchase') return openUrl(plan.pricing.sourceUrl);
    if (id !== 'install' || !api) return;
    setBusy(true);
    setError(undefined);
    // D.7 관리자 권한이 필요하면 Windows 허락 창을 기다린다는 표시
    setStatus(plan.needsAdmin ? ADMIN_WAITING_TEXT : '시작하고 있어요.');
    api
      .execute(plan.id, plan.action ?? 'install')
      .then((job) => {
        setStatus(plan.needsAdmin ? ADMIN_WAITING_TEXT : (job.message ?? RUNNING_TEXT));
        onStarted?.(plan, job);
      })
      .catch((err: unknown) => {
        setStatus(undefined);
        setBusy(false);
        setError(errorText(err));
      });
  };

  return (
    <ActionCard
      card={card}
      busy={busy}
      {...(error ? { error } : {})}
      {...(autoFocus ? { autoFocus } : {})}
      onChoose={onChoose}
    />
  );
}

export interface ResolveFailureCardProps {
  result: ResolveResultView;
  onClose?: () => void;
  openUrl?: (url: string) => void;
}

/** C.6 주소 해석 실패 카드 */
export function ResolveFailureCard({ result, onClose, openUrl = openExternal }: ResolveFailureCardProps) {
  const card = resolveFailureCard(result);
  return (
    <ActionCard
      card={card}
      onChoose={(id) => {
        if (id === 'open-url') openUrl(result.classification?.url ?? result.input);
        else onClose?.();
      }}
    />
  );
}
