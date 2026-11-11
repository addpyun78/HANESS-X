import type { EventLog, LogRecord } from './event-log.js';
import { readSessionEvents } from './recover.js';
import type { ConflictLike } from './resume-check.js';

/**
 * T-101 2B.8 동시 편집 충돌
 * 같은 프로젝트(projectId) 안에서 같은 산출물 경로를 쓰는 실행 중 세션이 있으면 "끝날 때까지 기다리기"를 제안한다.
 * 산출물 경로 = 그 세션이 쓴 파일(file_change 기록).
 */

export interface SessionOutputs {
  sessionId: string;
  projectId: string | null;
  title: string;
  /** 쓴 파일 경로 */
  outputs: string[];
}

export function sessionOutputs(sessionId: string, events: readonly LogRecord[]): SessionOutputs {
  const created = events.find((e) => e.type === 'session_created');
  const command = typeof created?.command === 'string' ? created.command : '';
  const prompt = typeof created?.prompt === 'string' ? created.prompt : '';
  return {
    sessionId,
    projectId: typeof created?.projectId === 'string' ? created.projectId : null,
    title: [command, prompt].filter(Boolean).join(' ') || sessionId,
    outputs: [
      ...new Set(
        events
          .filter((e) => e.type === 'file_change' && typeof e.path === 'string')
          .map((e) => String(e.path)),
      ),
    ].sort(),
  };
}

/** 대상과 같은 프로젝트에서 겹치는 경로를 쓰는 실행 중 세션 */
export function findOutputConflicts(
  target: SessionOutputs,
  running: readonly SessionOutputs[],
): ConflictLike[] {
  if (!target.projectId) return [];
  const mine = new Set(target.outputs);
  const out: ConflictLike[] = [];
  for (const r of running) {
    if (r.sessionId === target.sessionId || r.projectId !== target.projectId) continue;
    const paths = r.outputs.filter((p) => mine.has(p));
    if (paths.length) out.push({ sessionId: r.sessionId, title: r.title, paths });
  }
  return out;
}

/** 로그에서 바로: 실행 중 세션 id 목록을 받아 충돌 찾기 (점검기 conflicts 주입용) */
export function conflictsFromLog(
  log: EventLog,
  sessionId: string,
  runningIds: readonly string[],
): ConflictLike[] {
  const target = sessionOutputs(sessionId, readSessionEvents(log, sessionId));
  return findOutputConflicts(
    target,
    runningIds.map((id) => sessionOutputs(id, readSessionEvents(log, id))),
  );
}
