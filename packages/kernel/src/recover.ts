import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import type { EventLog, LogRecord } from './event-log.js';

/**
 * 크래시 복구 (T-061)
 *  61.1 시작 시 미종료 세션 탐지: 엔진 턴 이벤트의 마지막이 turn_end가 아닌 세션
 *  61.2 이벤트 로그(JSONL 원본) + 체크리스트 원장으로 세션 상태 재구성
 *  61.3 "이어서 하기": 다음 미완료 항목부터 재개할 프롬프트·API
 * 커널은 checklist-ledger에 의존하지 않는다(순환 방지) — 원장은 구조적 인터페이스(LedgerView)로 받는다.
 */

/** 턴 진행을 나타내는 이벤트 (checklist_change·hook_result 같은 기록은 제외) */
export const TURN_EVENT_TYPES = new Set([
  'assistant_text',
  'tool_call',
  'tool_result',
  'file_change',
  'usage',
  'error',
  'turn_end',
  'approval_request',
]);

export interface LedgerView {
  read(): { items: { id: string; title: string; status: string; deps?: string[] }[] } | null;
}

export interface UnfinishedSession {
  sessionId: string;
  file: string;
  /** 마지막 턴 이벤트 */
  lastEvent: LogRecord;
}

/** 세션 JSONL을 원본 그대로 읽는다 (인덱스가 크래시로 늦어도 정확). 잘린 줄은 건너뛴다 */
export function readSessionEvents(log: EventLog, sessionId: string): LogRecord[] {
  const file = log.sessionFile(sessionId);
  if (!existsSync(file)) return [];
  const out: LogRecord[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as LogRecord);
    } catch {
      // 강제 종료로 잘린 줄
    }
  }
  return out;
}

/**
 * 잘린 마지막 줄 뒤에 다음 기록이 붙어 버리지 않게 줄바꿈으로 닫는다.
 * 이 프로세스에서 해당 세션에 append하기 전에 불러야 한다. 반환: 고쳤는가
 */
export function repairSessionTail(file: string): boolean {
  if (!existsSync(file)) return false;
  const fd = openSync(file, 'r+');
  try {
    const size = fstatSync(fd).size;
    if (size === 0) return false;
    const last = Buffer.alloc(1);
    readSync(fd, last, 0, 1, size - 1);
    if (last[0] === 0x0a) return false;
    writeSync(fd, '\n', size);
    return true;
  } finally {
    closeSync(fd);
  }
}

/** 로그 루트의 모든 세션 id (인덱스가 아니라 폴더 기준) */
export function listLogSessions(log: EventLog): string[] {
  const dir = join(log.root, 'sessions');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'events.jsonl')))
    .map((d) => d.name)
    .sort();
}

/** 61.1 미종료 세션: 턴 이벤트가 있고, 그중 마지막이 turn_end가 아니다 */
export function findUnfinishedSessions(log: EventLog, opts: { repair?: boolean } = {}): UnfinishedSession[] {
  const out: UnfinishedSession[] = [];
  for (const sessionId of listLogSessions(log)) {
    const file = log.sessionFile(sessionId);
    if (opts.repair !== false) repairSessionTail(file);
    const turns = readSessionEvents(log, sessionId).filter((e) => TURN_EVENT_TYPES.has(e.type));
    const last = turns.at(-1);
    if (last && last.type !== 'turn_end') out.push({ sessionId, file, lastEvent: last });
  }
  return out;
}

// ── 61.2 상태 재구성 ───────────────────────────────────────────
export interface RecoveredSession {
  sessionId: string;
  unfinished: boolean;
  engineId: string | null;
  /** 끝난 턴 수 (turn_end 개수) */
  turns: number;
  lastEvent: { type: string; ts: string } | null;
  /** 마지막으로 이벤트에 나온 항목 id */
  lastItemId: string | null;
  /** 결과 없이 끊긴 도구 호출 */
  pendingToolCalls: { callId: string; tool: string }[];
  filesChanged: string[];
  usage: { inputTokens: number; outputTokens: number };
  /** checklist_change 재생으로 얻은 항목 상태 */
  itemStatusFromEvents: Record<string, string>;
  /** 원장 현재 상태 (원장이 없으면 null) */
  checklist: {
    total: number;
    done: number;
    remaining: number;
    statuses: Record<string, string>;
    next: { id: string; title: string; status: string } | null;
  } | null;
  /** 이벤트 재생 상태와 원장 상태가 일치하는가 (원장 없으면 null) */
  consistent: boolean | null;
}

const ACTIVE = new Set(['doing', 'verifying', 'failed']);

/** 원장의 다음 미완료 항목: 진행 중 → 의존이 끝난 첫 todo → blocked 아닌 첫 미완료 */
export function nextIncomplete(
  items: { id: string; title: string; status: string; deps?: string[] }[],
): { id: string; title: string; status: string } | null {
  const done = new Set(items.filter((i) => i.status === 'done').map((i) => i.id));
  const it =
    items.find((i) => ACTIVE.has(i.status)) ??
    items.find((i) => i.status === 'todo' && (i.deps ?? []).every((d) => done.has(d))) ??
    items.find((i) => i.status !== 'done' && i.status !== 'blocked');
  return it ? { id: it.id, title: it.title, status: it.status } : null;
}

export function recoverSession(
  log: EventLog,
  sessionId: string,
  ledger?: LedgerView | null,
): RecoveredSession {
  const events = readSessionEvents(log, sessionId);
  const turnEvents = events.filter((e) => TURN_EVENT_TYPES.has(e.type));
  const lastTurn = turnEvents.at(-1);
  const calls = new Map<string, string>();
  const files = new Set<string>();
  const usage = { inputTokens: 0, outputTokens: 0 };
  const statuses: Record<string, string> = {};
  let engineId: string | null = null;
  let lastItemId: string | null = null;
  let turns = 0;
  for (const e of events) {
    if (typeof e.engineId === 'string' && TURN_EVENT_TYPES.has(e.type)) engineId = e.engineId;
    if (typeof e.itemId === 'string') lastItemId = e.itemId;
    switch (e.type) {
      case 'tool_call':
        calls.set(String(e.callId), String(e.tool));
        break;
      case 'tool_result':
        calls.delete(String(e.callId));
        break;
      case 'file_change':
        files.add(String(e.path));
        break;
      case 'usage':
        usage.inputTokens += Number(e.inputTokens) || 0;
        usage.outputTokens += Number(e.outputTokens) || 0;
        break;
      case 'turn_end':
        turns++;
        break;
      case 'checklist_change':
        if (e.to === 'removed') delete statuses[String(e.changedItemId)];
        else statuses[String(e.changedItemId)] = String(e.to);
        break;
    }
  }
  const c = ledger?.read() ?? null;
  const checklist = c
    ? {
        total: c.items.length,
        done: c.items.filter((i) => i.status === 'done').length,
        remaining: c.items.filter((i) => i.status !== 'done').length,
        statuses: Object.fromEntries(c.items.map((i) => [i.id, i.status])),
        next: nextIncomplete(c.items),
      }
    : null;
  const consistent = checklist ? sameRecord(checklist.statuses, statuses) : null;
  return {
    sessionId,
    unfinished: !!lastTurn && lastTurn.type !== 'turn_end',
    engineId,
    turns,
    lastEvent: lastTurn ? { type: lastTurn.type, ts: lastTurn.ts } : null,
    lastItemId,
    pendingToolCalls: [...calls].map(([callId, tool]) => ({ callId, tool })),
    filesChanged: [...files].sort(),
    usage,
    itemStatusFromEvents: statuses,
    checklist,
    consistent,
  };
}

function sameRecord(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
}

// ── 61.3 이어서 하기 ───────────────────────────────────────────
export interface ResumePlan {
  sessionId: string;
  engineId: string | null;
  /** 재개할 항목 (없으면 체크리스트가 없거나 모두 완료) */
  itemId: string | null;
  itemTitle: string | null;
  prompt: string;
}

export function resumePlan(s: RecoveredSession): ResumePlan {
  const next = s.checklist?.next ?? null;
  const lines = ['이전 세션이 비정상 종료되었습니다. 이어서 진행하세요.'];
  if (s.pendingToolCalls.length)
    lines.push(
      `끊긴 도구 호출(결과 없음): ${s.pendingToolCalls.map((c) => c.tool).join(', ')} — 결과를 다시 확인하세요.`,
    );
  if (s.filesChanged.length) lines.push(`이미 바뀐 파일: ${s.filesChanged.slice(0, 20).join(', ')}`);
  if (next && s.checklist)
    lines.push(
      `다음 미완료 항목 ${next.id}: ${next.title} (상태 ${next.status}, 남은 ${s.checklist.remaining}개)부터 재개하세요.`,
    );
  else lines.push('체크리스트의 남은 작업을 확인하세요.');
  return {
    sessionId: s.sessionId,
    engineId: s.engineId,
    itemId: next?.id ?? null,
    itemTitle: next?.title ?? null,
    prompt: lines.join('\n'),
  };
}

/** "이어서 하기" 카드 데이터 */
export interface ResumeCard {
  sessionId: string;
  engineId: string | null;
  lastEventAt: string | null;
  remaining: number | null;
  nextItemId: string | null;
  nextItemTitle: string | null;
}

export function resumeCard(s: RecoveredSession): ResumeCard {
  return {
    sessionId: s.sessionId,
    engineId: s.engineId,
    lastEventAt: s.lastEvent?.ts ?? null,
    remaining: s.checklist?.remaining ?? null,
    nextItemId: s.checklist?.next?.id ?? null,
    nextItemTitle: s.checklist?.next?.title ?? null,
  };
}

export interface RecoveryRoutesOptions {
  log: EventLog;
  /** 세션 id → 원장 (없으면 null) */
  ledgerFor?: (sessionId: string) => LedgerView | null | undefined;
  /**
   * 재개 실행기 (예: 엔진 러너). 없으면 session_resume 기록을 이벤트 로그에 남겨
   * 러너가 /ws/events로 받아 처리하게 한다.
   */
  resume?: (plan: ResumePlan) => void | Promise<void>;
}

type RouteApp = {
  get(path: string, handler: (req: { params: unknown }, reply: Reply) => Promise<unknown>): unknown;
  post(path: string, handler: (req: { params: unknown }, reply: Reply) => Promise<unknown>): unknown;
};
type Reply = { code(n: number): { send(b: unknown): unknown } };

/**
 * GET  /api/recovery                    → { sessions: ResumeCard[] } (미종료 세션)
 * POST /api/recovery/:session/resume    → 202 { plan } (다음 미완료 항목부터 재개)
 */
export function registerRecoveryRoutes(app: RouteApp, o: RecoveryRoutesOptions): void {
  const state = (id: string) => recoverSession(o.log, id, o.ledgerFor?.(id) ?? null);
  app.get('/api/recovery', async () => ({
    sessions: findUnfinishedSessions(o.log).map((u) => resumeCard(state(u.sessionId))),
  }));
  app.post('/api/recovery/:session/resume', async (req, reply) => {
    const { session } = req.params as { session: string };
    if (!findUnfinishedSessions(o.log).some((u) => u.sessionId === session))
      return reply.code(404).send({ error: 'not_unfinished', sessionId: session });
    const plan = resumePlan(state(session));
    if (o.resume) await o.resume(plan);
    else
      o.log.append({
        id: randomUUID(),
        ts: new Date().toISOString(),
        sessionId: session,
        ...(plan.itemId ? { itemId: plan.itemId } : {}),
        type: 'session_resume',
        ...(plan.engineId ? { engineId: plan.engineId } : {}),
        prompt: plan.prompt,
      });
    return reply.code(202).send({ plan });
  });
}
