import { toRunMode, type RunMode } from '@harness-x/protocol';
import { autoResumeDecision, type AutoResumeContext, type AutoResumeDecision } from '../resume-policy.js';
import type { PausedInfo } from '../stop.js';
import { resolveRunMode, type ModeInputs, type ModeSource } from './resolve.js';

/**
 * T-101 3E.6 이어하기(2번) 때 모드 유지
 *  - 멈추기 전 세션의 모드를 그대로 쓴다 (세션 기록 mode). 기록이 없으면 지금 기본값 순서(3E.3)로.
 *  - 이어하기 카드에서 사용자가 바꾸면 그 값 (이번 이어하기부터).
 *  - 2B.11 자동 재개 규칙은 이 결과(mode)를 받아 "오류 → 오토면 자동"을 판단한다.
 */

export interface ResumeRunModeInput {
  /** 멈춘 세션에 저장된 모드 */
  session: { mode?: unknown };
  /** 이어하기 카드에서 고른 모드 (없으면 유지) */
  choice?: unknown;
  /** 세션에 모드가 없을 때 쓸 기본값들 (에이전트·프로젝트·전체) */
  defaults?: Pick<ModeInputs, 'agent' | 'project' | 'global'>;
}

export interface ResumeModeResult {
  mode: RunMode;
  from: 'card' | 'session' | ModeSource;
  /** 멈추기 전과 달라졌나 (타임라인 기록용) */
  changed: boolean;
}

export function resumeRunMode(i: ResumeRunModeInput): ResumeModeResult {
  const before = toRunMode(i.session.mode);
  const picked = toRunMode(i.choice);
  if (picked) return { mode: picked, from: 'card', changed: before !== undefined && picked !== before };
  if (before) return { mode: before, from: 'session', changed: false };
  const r = resolveRunMode({ ...i.defaults });
  return { mode: r.mode, from: r.from, changed: false };
}

/** 2B.11 자동 재개 규칙에 세션 모드를 넣어 부른다 (오류로 멈춘 오토 세션만 바로 이어함) */
export function autoResumeFor(
  paused: Pick<PausedInfo, 'reason'>,
  session: { mode?: unknown },
  ctx: Omit<AutoResumeContext, 'mode'>,
): AutoResumeDecision {
  return autoResumeDecision(paused, { ...ctx, mode: resumeRunMode({ session }).mode });
}
