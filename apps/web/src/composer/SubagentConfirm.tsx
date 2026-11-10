import type { SessionSummary } from '../shell/types.js';
import type { SendPayload } from './types.js';

/**
 * 48.4 실행 중 다른 에이전트를 /로 부르면 묻는다: 실행 중 세션에 서브에이전트로 추가 / 새 세션으로 실행 / 취소
 */

/** 확인이 필요한 경우 그 실행 중 세션 (없으면 바로 새 세션) */
export function subagentTarget(
  payload: Pick<SendPayload, 'agent'>,
  sessions: readonly SessionSummary[],
  activeId?: string,
): SessionSummary | undefined {
  if (!payload.agent) return undefined;
  const running = sessions.filter((s) => s.agent && s.status === 'running');
  const target = running.find((s) => s.id === activeId) ?? running[0];
  if (!target || target.agent!.command === payload.agent) return undefined;
  return target;
}

export interface SubagentConfirmProps {
  /** 부르려는 에이전트 /명령 */
  agent: string;
  running: SessionSummary;
  onAddSubagent: () => void;
  onNewSession: () => void;
  onCancel: () => void;
}

export function SubagentConfirm({
  agent,
  running,
  onAddSubagent,
  onNewSession,
  onCancel,
}: SubagentConfirmProps) {
  const current = running.agent?.command ?? running.title;
  return (
    <div
      className="hx-subagent-confirm"
      role="alertdialog"
      aria-label="서브에이전트로 추가"
      aria-modal="false"
    >
      <p className="hx-subagent-confirm__text">
        <span className="hx-mono">{current}</span> 세션이 실행 중입니다.{' '}
        <span className="hx-mono">{agent}</span>를 이 세션의 서브에이전트로 추가할까요?
      </p>
      <div className="hx-subagent-confirm__actions">
        <button type="button" className="hx-subagent-confirm__primary" onClick={onAddSubagent}>
          서브에이전트로 추가
        </button>
        <button type="button" onClick={onNewSession}>
          새 세션으로 실행
        </button>
        <button type="button" onClick={onCancel}>
          취소
        </button>
      </div>
    </div>
  );
}
