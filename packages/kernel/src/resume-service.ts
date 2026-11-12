import { dirname, join } from 'node:path';
import type { Dispatcher } from './dispatch.js';
import type { EventLog } from './event-log.js';
import { readPauseSnapshot } from './pause-snapshot.js';
import type { LedgerView } from './recover.js';
import { findResumableSessions, type ResumableSession } from './resume.js';
import {
  checkBeforeResume,
  type ResumeCheckDeps,
  type ResumeCheckId,
  type ResumeCheckResult,
} from './resume-check.js';
import { conflictsFromLog } from './resume-conflict.js';
import { suggestEngines } from './resume-engine.js';
import { diffSinceSnapshot, revertToSnapshot, type RevertResult } from './resume-files.js';
import { changedSinceStart, readPinnedVersion } from './resume-pin.js';
import { resumeSession, type ResumeRunDeps, type ResumeRunResult } from './resume-run.js';

/**
 * T-101 2B 이어하기 서비스 — 모든 입구(사이드바·⏸ 세션 줄·빈 세션 화면·/resume·CLI)가 같은 길로 들어온다.
 *   check(id)  → 6가지 점검 (문제가 있을 때만 카드)
 *   start(id, choices) → 고른 대로 (되돌리기·엔진·버전) 이어서 실행
 */

export interface ResumeServiceOptions {
  log: EventLog;
  dispatcher: Dispatcher;
  agentFor: ResumeRunDeps['agentFor'];
  /** 지금 쓸 수 있는 엔진 id */
  engines?: () => readonly string[];
  engineCanResume?: (engineId: string) => boolean;
  /** 엔진 설정 fallback 표 */
  fallback?: () => Record<string, string[]>;
  /** 메인 AI (5번 이후) */
  mainAi?: () => string | undefined;
  ledger?: (sessionId: string) => LedgerView | null | undefined;
  interrupted?: ResumeRunDeps['interrupted'];
  /** 대답 안 한 승인 카드 */
  pendingApprovals?: (sessionId: string) => { id: string; title: string }[];
  now?: () => Date;
}

export interface ResumeStartChoices {
  /** 점검 카드별 고른 선택지 id (없으면 기본 선택지) */
  files?: 'keep' | 'revert' | 'replan';
  engine?: string;
  version?: 'pinned' | 'latest';
}

export class ResumeServiceError extends Error {
  constructor(
    readonly code: 'not_found' | 'blocked',
    message: string,
    readonly issues?: ResumeCheckResult['issues'],
  ) {
    super(message);
  }
}

export interface ResumeService {
  list(): ResumableSession[];
  get(sessionId: string): ResumableSession | undefined;
  check(sessionId: string): ResumeCheckResult;
  start(
    sessionId: string,
    choices?: ResumeStartChoices,
  ): Promise<ResumeRunResult & { revert?: RevertResult; replan?: boolean }>;
}

function changedOf(r: ResumeCheckResult): string[] {
  return r.issues.find((i) => i.check === 'files')?.list ?? [];
}

export function createResumeService(o: ResumeServiceOptions): ResumeService {
  const sessionDir = (id: string) => dirname(o.log.sessionFile(id));
  const get = (id: string) => findResumableSessions(o.log).find((s) => s.sessionId === id);
  const deps = (s: ResumableSession): ResumeCheckDeps => {
    const snap = readPauseSnapshot(sessionDir(s.sessionId));
    const pin = readPinnedVersion(sessionDir(s.sessionId));
    const current = s.agent ? o.agentFor(s.agent.name)?.pipeline : undefined;
    const available = o.engines?.();
    const running = o.dispatcher
      .sessions()
      .filter((x) => x.status === 'running')
      .map((x) => x.sessionId);
    return {
      ...(o.now ? { now: o.now() } : {}),
      ...(snap ? { fileChanges: () => diffSinceSnapshot(snap), isGit: () => snap.files.kind === 'git' } : {}),
      ...(available
        ? {
            engineAvailable: (id: string) => available.includes(id),
            engineSuggestions: (id: string) =>
              suggestEngines(id, {
                available,
                ...(o.fallback ? { fallback: o.fallback() } : {}),
                ...(o.mainAi?.() ? { mainAi: o.mainAi()! } : {}),
              }),
          }
        : {}),
      ...(pin ? { changedSinceStart: () => changedSinceStart(pin, current) } : {}),
      ...(o.pendingApprovals ? { pendingApprovals: () => o.pendingApprovals!(s.sessionId) } : {}),
      doneItems: () =>
        (o.ledger?.(s.sessionId)?.read()?.items ?? [])
          .filter((i) => i.status === 'done')
          .map((i) => ({ id: i.id, title: i.title })),
      conflicts: () => conflictsFromLog(o.log, s.sessionId, running),
    };
  };
  return {
    list: () => findResumableSessions(o.log),
    get,
    check(id) {
      const s = get(id);
      if (!s) throw new ResumeServiceError('not_found', `이어할 세션이 없어요: ${id}`);
      return checkBeforeResume(s, deps(s));
    },
    async start(id, choices = {}) {
      const s = get(id);
      if (!s) throw new ResumeServiceError('not_found', `이어할 세션이 없어요: ${id}`);
      const result = checkBeforeResume(s, deps(s));
      const blocking = result.issues.filter((i) => i.blocking);
      if (blocking.length)
        throw new ResumeServiceError('blocked', '먼저 대답할 확인 카드가 있어요.', blocking);
      const picked = new Set<ResumeCheckId>(result.issues.map((i) => i.check));
      let revert: RevertResult | undefined;
      if (picked.has('files') && choices.files === 'revert') {
        const snap = readPauseSnapshot(sessionDir(id))!;
        revert = revertToSnapshot(snap, { backupRoot: join(sessionDir(id), 'backups') });
      }
      const run = await resumeSession(
        {
          log: o.log,
          dispatcher: o.dispatcher,
          agentFor: o.agentFor,
          ...(o.engineCanResume ? { engineCanResume: o.engineCanResume } : {}),
          ...(o.ledger ? { ledger: o.ledger } : {}),
          ...(o.interrupted ? { interrupted: o.interrupted } : {}),
          ...(o.now ? { now: o.now } : {}),
        },
        id,
        {
          ...(choices.engine ? { engine: choices.engine } : {}),
          ...(choices.version ? { version: choices.version } : {}),
          ...(choices.files === 'replan' ? { replan: true } : {}),
          // [바뀐 걸 반영해서 계속](기본): 바뀐 파일을 지시에 알려 준다
          ...(picked.has('files') && (choices.files ?? 'keep') === 'keep'
            ? { changedFiles: changedOf(result) }
            : {}),
        },
      );
      return {
        ...run,
        ...(revert ? { revert } : {}),
        ...(choices.files === 'replan' ? { replan: true } : {}),
      };
    },
  };
}
