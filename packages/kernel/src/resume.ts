import type { EventLog, LogRecord } from './event-log.js';
import { findUnfinishedSessions, listLogSessions, readSessionEvents } from './recover.js';
import { isPauseReason, type PausedInfo } from './stop.js';

/**
 * T-101 2B 이어하기
 * 이어하는 단위는 "세션", 찾는 입구는 "프로젝트".
 * 프로젝트를 열면 그 프로젝트의 미완료 세션(멈춘 세션 + 비정상 종료된 세션)을 "이어서 할 작업"으로 보여 준다.
 */

// ── 2B.1 미완료 세션 목록 ───────────────────────────────────────
export interface ResumableSession {
  sessionId: string;
  /** 0-2 프로젝트 id (session_created.projectId, 없으면 null) */
  projectId: string | null;
  /** 사이드바와 같은 제목 (/명령 지시문) */
  title: string;
  agent: { name: string; command: string; displayName: string; icon?: string } | null;
  /** 마지막으로 쓰던 엔진 */
  engineId: string | null;
  /** 진행률 0~1 */
  progress: number;
  paused: PausedInfo;
  /** 멈출 때 실행 중이던 노드 */
  nodeId?: string;
  /** 멈출 때 하던 체크리스트 항목 (interrupted) */
  itemId?: string;
  /** 시작 시각 */
  startedAt: string | null;
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

/** 세션 하나의 기록을 접어 이어하기 정보로 (멈춘 상태가 아니면 null) */
export function foldResumable(sessionId: string, events: readonly LogRecord[]): ResumableSession | null {
  let created: LogRecord | undefined;
  let paused: LogRecord | undefined;
  let engineId: string | null = null;
  let nodes = 0;
  let done = 0;
  let progress: number | undefined;
  for (const e of events) {
    if (typeof e.engineId === 'string' && e.type !== 'session_created') engineId = e.engineId;
    switch (e.type) {
      case 'session_created':
        created = e;
        nodes = typeof e.nodeCount === 'number' ? e.nodeCount : 0;
        engineId ??= str((e.modifiers as { engine?: unknown } | undefined)?.engine) ?? null;
        break;
      case 'subagent_added':
        nodes += typeof e.nodeCount === 'number' ? e.nodeCount : 0;
        break;
      case 'node_end':
        if (e.status === 'completed' || e.status === 'max_iterations') done++;
        break;
      case 'session_paused':
        paused = e;
        if (typeof e.progress === 'number') progress = e.progress;
        break;
      case 'session_resumed':
        paused = undefined;
        break;
      case 'session_end':
        return null;
    }
  }
  if (!paused) return null;
  const p = (paused.paused ?? {}) as Partial<PausedInfo>;
  const command = str(created?.command) ?? (created ? `/${str(created.agent) ?? '?'}` : undefined);
  const prompt = str(created?.prompt) ?? '';
  const item = paused.item as { id?: unknown } | undefined;
  return {
    sessionId,
    projectId: str(created?.projectId) ?? null,
    title: command ? (prompt ? `${command} ${prompt}` : command) : sessionId,
    agent: created
      ? {
          name: str(created.agent) ?? command!.slice(1),
          command: command!,
          displayName: str(created.displayName) ?? command!.slice(1),
          ...(str(created.icon) ? { icon: str(created.icon)! } : {}),
        }
      : null,
    engineId,
    progress: progress ?? (nodes > 0 ? Math.min(1, done / nodes) : 0),
    paused: {
      reason: isPauseReason(p.reason) ? p.reason : 'user',
      at: str(p.at) ?? paused.ts,
      by: str(p.by) ?? 'user',
    },
    ...(str(paused.nodeId) ? { nodeId: str(paused.nodeId)! } : {}),
    ...(str(item?.id) ? { itemId: str(item?.id)! } : {}),
    startedAt: created?.ts ?? null,
  };
}

export interface FindResumableOptions {
  /** 비정상 종료 세션도 포함 (기본 true): paused{reason:'crash'} */
  includeCrashed?: boolean;
}

/** 로그 전체에서 미완료 세션: 멈춘 세션 + (선택) 비정상 종료 세션. 멈춘 시각 최신순 */
export function findResumableSessions(log: EventLog, opts: FindResumableOptions = {}): ResumableSession[] {
  const out = new Map<string, ResumableSession>();
  for (const id of listLogSessions(log)) {
    const r = foldResumable(id, readSessionEvents(log, id));
    if (r) out.set(id, r);
  }
  if (opts.includeCrashed !== false)
    for (const u of findUnfinishedSessions(log)) {
      if (out.has(u.sessionId)) continue;
      const events = readSessionEvents(log, u.sessionId);
      if (events.some((e) => e.type === 'session_end' || e.type === 'session_paused')) continue;
      const base = foldResumable(u.sessionId, [
        ...events,
        {
          id: 'crash',
          ts: u.lastEvent.ts,
          sessionId: u.sessionId,
          type: 'session_paused',
          paused: { reason: 'crash', at: u.lastEvent.ts, by: 'kernel' },
        },
      ]);
      if (base) out.set(u.sessionId, base);
    }
  return [...out.values()].sort((a, b) => b.paused.at.localeCompare(a.paused.at));
}

/** 2B.1 프로젝트 id → 그 프로젝트의 미완료 세션 (프로젝트 화면 "이어서 할 작업이 있어요") */
export function resumableForProject(
  sessions: readonly ResumableSession[],
  projectId: string,
): ResumableSession[] {
  return sessions.filter((s) => s.projectId === projectId);
}
