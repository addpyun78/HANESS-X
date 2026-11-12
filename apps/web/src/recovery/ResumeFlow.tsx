import { useEffect, useState } from 'react';
import type { RunMode } from '@harness-x/protocol';
import { ResumeModeChoice } from '../run-mode/ResumeModeChoice.js';
import { ResumeCheckCard, type ResumeIssueData } from './ResumeCheckCard.js';
import './recovery.css';

/** 이어하기 API (POST /api/resume/:id/check · POST /api/resume/:id) */
export interface ResumeApi {
  check(sessionId: string): Promise<{ ok: boolean; issues: ResumeIssueData[] }>;
  start(sessionId: string, choices: ResumeStartChoices): Promise<{ mode: string; version: string }>;
}

export interface ResumeStartChoices {
  files?: 'keep' | 'revert' | 'replan';
  engine?: string;
  version?: 'pinned' | 'latest';
  /** T-101 3E.6 이어하기 카드에서 바꾼 실행 모드 */
  runMode?: RunMode;
}

/** 카드에서 고른 선택지 → 시작 요청. 기다리기·나중에는 null (이어하지 않음) */
export function toStartChoices(
  picked: Partial<Record<ResumeIssueData['check'], string>>,
): ResumeStartChoices | null {
  const out: ResumeStartChoices = {};
  if (picked.engine === 'wait' || picked.conflict === 'wait') return null;
  if (picked.files === 'keep' || picked.files === 'revert' || picked.files === 'replan')
    out.files = picked.files;
  if (picked.stale === 'replan') out.files = 'replan';
  if (picked.engine?.startsWith('engine:')) out.engine = picked.engine.slice('engine:'.length);
  if (picked.version === 'pinned' || picked.version === 'latest') out.version = picked.version;
  return out;
}

const defaults = (issues: ResumeIssueData[]) =>
  Object.fromEntries(
    issues
      .filter((i) => !i.blocking)
      .map((i) => [i.check, (i.choices.find((c) => c.default) ?? i.choices[0])?.id]),
  ) as Partial<Record<ResumeIssueData['check'], string>>;

export interface ResumeFlowProps {
  api: ResumeApi;
  sessionId: string;
  /** 승인 카드 먼저 보기 (blocking 카드의 [카드 보기]) */
  onShowApprovals?(sessionId: string): void;
  onDone?(r: { mode: string; version: string } | null): void;
  /** T-101 3E.6 멈춘 세션의 실행 모드 (카드에서 바꿀 수 있음, 기본 유지) */
  sessionMode?: string;
}

/**
 * T-101 2B.2 모든 입구가 여는 이어하기 흐름:
 * 점검(6가지) → 문제가 없으면 바로 이어함, 있으면 카드로 묻고 [이 선택으로 이어하기].
 */
export function ResumeFlow({ api, sessionId, onShowApprovals, onDone, sessionMode }: ResumeFlowProps) {
  const [runMode, setRunMode] = useState<RunMode>();
  const [state, setState] = useState<'checking' | 'asking' | 'starting' | 'done' | 'cancelled' | 'error'>(
    'checking',
  );
  const [issues, setIssues] = useState<ResumeIssueData[]>([]);
  const [picked, setPicked] = useState<Partial<Record<ResumeIssueData['check'], string>>>({});

  const start = async (choices: ResumeStartChoices) => {
    setState('starting');
    try {
      const r = await api.start(sessionId, choices);
      setState('done');
      onDone?.(r);
    } catch {
      setState('error');
    }
  };

  useEffect(() => {
    let live = true;
    api
      .check(sessionId)
      .then((r) => {
        if (!live) return;
        if (r.ok) return start({});
        setIssues(r.issues);
        setPicked(defaults(r.issues));
        setState('asking');
      })
      .catch(() => live && setState('error'));
    return () => {
      live = false;
    };
  }, [api, sessionId]);

  const blocked = issues.some((i) => i.blocking);
  return (
    <div className="hx-resume-flow" aria-label="이어하기" data-state={state}>
      {state === 'checking' && <p className="hx-resume__body">이어하기 전에 확인하고 있어요…</p>}
      {state === 'asking' &&
        issues.map((i) => (
          <ResumeCheckCard
            key={i.check}
            issue={i}
            onChoose={(check, id) => {
              if (check === 'approvals') return onShowApprovals?.(sessionId);
              setPicked((p) => ({ ...p, [check]: id }));
            }}
          />
        ))}
      {state === 'asking' && (
        <div className="hx-resume-check__mode">
          <span>실행 모드</span>
          <ResumeModeChoice
            {...(sessionMode ? { sessionMode } : {})}
            {...(runMode ? { value: runMode } : {})}
            onChange={setRunMode}
          />
        </div>
      )}
      {state === 'asking' && (
        <div className="hx-resume-check__choices">
          <button
            type="button"
            className="hx-resume__button hx-resume__button--primary"
            disabled={blocked}
            onClick={() => {
              const c = toStartChoices(picked);
              if (!c) {
                setState('cancelled');
                onDone?.(null);
                return;
              }
              void start(runMode ? { ...c, runMode } : c);
            }}
          >
            이 선택으로 이어하기
          </button>
        </div>
      )}
      {state === 'starting' && <p className="hx-resume__body">이어서 시작하고 있어요…</p>}
      {state === 'done' && <p className="hx-resume__body">이어서 시작했어요.</p>}
      {state === 'cancelled' && <p className="hx-resume__body">나중에 이어할게요.</p>}
      {state === 'error' && (
        <p className="hx-resume__error" role="alert">
          이어하지 못했어요. 다시 시도해 주세요.
        </p>
      )}
    </div>
  );
}
