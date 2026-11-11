import type { Dispatcher, DispatchAgent, DispatchResumeInfo, DispatchSession } from './dispatch.js';
import type { EventLog, LogRecord } from './event-log.js';
import { readSessionEvents, type LedgerView } from './recover.js';
import { foldResumable, type ResumableSession } from './resume.js';
import { pipelineForResume, readPinnedVersion } from './resume-pin.js';
import { STALE_DAYS } from './resume-check.js';
import { dirname } from 'node:path';

/**
 * T-101 2B.9 재개 방식 · 2B.10 멈췄던 항목 처리 · 실제 이어하기 실행
 *
 * 재개 방식: 같은 엔진 + 엔진 자체 재개 가능 + 7일 이내 + 엔진 세션 id가 있으면 엔진 재개(예: claude --resume),
 * 아니면 이벤트 로그 + 체크리스트로 요약 컨텍스트를 만들어 새 세션(엔진 중립).
 */

export type ResumeMode = DispatchResumeInfo['mode'];

export interface ResumeModeInput {
  /** 멈출 때 쓰던 엔진 */
  pausedEngine: string | null;
  /** 이어할 엔진 (바꾸지 않았으면 같은 엔진) */
  targetEngine: string | null;
  /** 이어할 엔진이 자체 재개를 지원하나 (EngineCapabilities.resume) */
  engineCanResume: boolean;
  /** 노드 id → 엔진 세션 id (engine_session 기록) */
  engineSessionIds: Record<string, string>;
  pausedAt: string;
  now: Date;
}

const DAY_MS = 86_400_000;

export function chooseResumeMode(i: ResumeModeInput): ResumeMode {
  const sameEngine = !!i.pausedEngine && (i.targetEngine ?? i.pausedEngine) === i.pausedEngine;
  const fresh = i.now.getTime() - Date.parse(i.pausedAt) < STALE_DAYS * DAY_MS;
  const hasIds = Object.keys(i.engineSessionIds).length > 0;
  return sameEngine && i.engineCanResume && fresh && hasIds ? 'engine' : 'summary';
}

/** engine_session 기록 → 노드 id별 마지막 엔진 세션 id (특정 엔진만) */
export function engineSessionIds(
  events: readonly LogRecord[],
  engineId: string | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of events)
    if (
      e.type === 'engine_session' &&
      typeof e.nodeId === 'string' &&
      typeof e.engineSessionId === 'string' &&
      (!engineId || e.engineId === engineId)
    )
      out[e.nodeId] = e.engineSessionId;
  return out;
}

export interface ChecklistItemLike {
  id: string;
  title: string;
  status: string;
}

/** 요약 컨텍스트 (엔진 중립): 원래 지시 + 끝낸 일 + 남은 일 + 바뀐 파일 + 멈췄던 항목 */
export function buildSummaryContext(
  s: ResumableSession,
  events: readonly LogRecord[],
  items: readonly ChecklistItemLike[],
  opts: { interrupted?: { id: string; verified: boolean } } = {},
): string {
  const created = events.find((e) => e.type === 'session_created');
  const files = [
    ...new Set(events.filter((e) => e.type === 'file_change').map((e) => String(e.path))),
  ].sort();
  const done = items.filter((i) => i.status === 'done');
  const left = items.filter((i) => i.status !== 'done');
  const lines = [
    '이전에 멈춘 작업을 이어서 합니다. 아래 요약을 보고 남은 일부터 계속하세요.',
    `원래 지시: ${typeof created?.prompt === 'string' && created.prompt ? created.prompt : s.title}`,
  ];
  if (s.nodeId) lines.push(`멈춘 단계: ${s.nodeId}`);
  if (done.length) lines.push(`끝낸 일 (${done.length}개):`, ...done.map((i) => `- [x] ${i.id} ${i.title}`));
  if (left.length) lines.push(`남은 일 (${left.length}개):`, ...left.map((i) => `- [ ] ${i.id} ${i.title}`));
  if (opts.interrupted)
    lines.push(
      opts.interrupted.verified
        ? `멈출 때 하던 ${opts.interrupted.id}는 검사를 통과해 끝난 것으로 처리했습니다.`
        : `멈출 때 하던 ${opts.interrupted.id}는 아직 끝나지 않았습니다. 이 항목부터 이어서 하세요.`,
    );
  if (files.length) lines.push(`이미 바뀐 파일: ${files.slice(0, 30).join(', ')}`);
  return lines.join('\n');
}

/** 엔진 자체 재개 때 보낼 짧은 지시 */
export function engineResumePrompt(interrupted?: { id: string; verified: boolean }): string {
  if (!interrupted) return '멈췄던 곳에서 이어서 계속하세요.';
  return interrupted.verified
    ? `멈췄던 곳에서 이어서 계속하세요. ${interrupted.id}는 검사를 통과했으니 다음 항목으로 넘어가세요.`
    : `멈췄던 곳에서 이어서 계속하세요. ${interrupted.id}부터 마저 하세요.`;
}

// ── 2B.10 멈췄던 항목 ─────────────────────────────────────────
export interface InterruptedItemDeps {
  /** 항목 검증(acceptance) 실행 → 통과 여부 */
  verify(itemId: string): Promise<boolean> | boolean;
  /** 통과하면 done으로 */
  markDone(itemId: string): void;
}

/** interrupted 항목은 먼저 검증 → 통과면 done, 아니면 이어서 진행 */
export async function settleInterruptedItem(
  itemId: string,
  deps: InterruptedItemDeps,
): Promise<{ id: string; verified: boolean }> {
  let ok = false;
  try {
    ok = await deps.verify(itemId);
  } catch {
    ok = false;
  }
  if (ok) deps.markDone(itemId);
  return { id: itemId, verified: ok };
}

// ── 실행 ──────────────────────────────────────────────────────
export interface ResumeRunDeps {
  log: EventLog;
  dispatcher: Pick<Dispatcher, 'resume'>;
  /** 이름 → 에이전트 (지금 버전) */
  agentFor(name: string): DispatchAgent | undefined;
  /** 엔진 자체 재개 지원 여부 */
  engineCanResume?(engineId: string): boolean;
  /** 세션 체크리스트 */
  ledger?(sessionId: string): LedgerView | null | undefined;
  /** 2B.10 interrupted 항목 검증 */
  interrupted?(sessionId: string): InterruptedItemDeps | undefined;
  now?(): Date;
}

export interface ResumeChoices {
  /** 2B.5 다른 엔진으로 */
  engine?: string;
  /** 2B.6 기본 'pinned' */
  version?: 'pinned' | 'latest';
}

export interface ResumeRunResult {
  session: DispatchSession;
  mode: ResumeMode;
  prompt: string;
  interrupted?: { id: string; verified: boolean };
  version: 'pinned' | 'latest';
}

export class ResumeError extends Error {
  constructor(
    readonly code: 'not_paused' | 'unknown_agent',
    message: string,
  ) {
    super(message);
  }
}

/** 멈춘 세션을 이어서 실행 (점검·선택은 끝났다고 본다) */
export async function resumeSession(
  deps: ResumeRunDeps,
  sessionId: string,
  choices: ResumeChoices = {},
): Promise<ResumeRunResult> {
  const events = readSessionEvents(deps.log, sessionId);
  const s = foldResumable(sessionId, events);
  if (!s) throw new ResumeError('not_paused', `멈춘 세션이 아닙니다: ${sessionId}`);
  if (!s.agent) throw new ResumeError('unknown_agent', `에이전트 기록이 없습니다: ${sessionId}`);
  const agent = deps.agentFor(s.agent.name);
  if (!agent) throw new ResumeError('unknown_agent', `에이전트 없음: ${s.agent.name}`);
  const now = deps.now?.() ?? new Date();

  // 2B.10 멈췄던 항목 먼저 검증
  const settle = s.itemId ? deps.interrupted?.(sessionId) : undefined;
  const interrupted = s.itemId && settle ? await settleInterruptedItem(s.itemId, settle) : undefined;

  // 2B.6 버전: 기본은 시작할 때 버전
  const version = choices.version ?? 'pinned';
  const pin = readPinnedVersion(dirname(deps.log.sessionFile(sessionId)));
  const pipeline = pipelineForResume(pin, agent.pipeline, version);

  // 2B.9 재개 방식
  const target = choices.engine ?? s.engineId;
  const ids = engineSessionIds(events, s.engineId);
  const mode = chooseResumeMode({
    pausedEngine: s.engineId,
    targetEngine: target,
    engineCanResume: !!target && (deps.engineCanResume?.(target) ?? false),
    engineSessionIds: ids,
    pausedAt: s.paused.at,
    now,
  });
  const items = deps.ledger?.(sessionId)?.read()?.items ?? [];
  const prompt =
    mode === 'engine'
      ? engineResumePrompt(interrupted)
      : buildSummaryContext(s, events, items, interrupted ? { interrupted } : {});
  const session = deps.dispatcher.resume({
    sessionId,
    agent: agent.name,
    prompt,
    pipeline,
    ...(choices.engine ? { engine: choices.engine } : {}),
    resume: { mode, ...(mode === 'engine' ? { resumeIds: ids } : {}) },
    note: { version, ...(interrupted ? { interrupted } : {}) },
  });
  return { session, mode, prompt, version, ...(interrupted ? { interrupted } : {}) };
}
