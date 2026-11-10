import type { SessionStatus, SessionSummary } from './types.js';

/**
 * 48.3 / 디스패치 세션 → 사이드바 항목
 * 커널 이벤트(session_created → node_start/node_end… → session_end)를 접어 아이콘·현재 노드·진행률을 만든다.
 * (POST /api/sessions 응답도 같은 모양으로 넣을 수 있다: fromDispatchSession)
 */

type Rec = { type: string; sessionId?: string; ts?: string } & Record<string, unknown>;

const STATUS: Record<string, SessionStatus> = {
  running: 'running',
  completed: 'done',
  incomplete: 'blocked',
  stalled: 'blocked',
  failed: 'error',
  contract_failed: 'error',
  error: 'error',
};

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

interface Acc {
  s: SessionSummary;
  nodes: number;
  /** 완료된 노드 방문 수 (진행률 = done / nodes, 최대 1) */
  done: number;
}

/** 디스패치 세션 응답 (kernel DispatchSession) */
export interface DispatchSessionLike {
  sessionId: string;
  agent: { name: string; command: string; displayName: string; icon?: string };
  prompt: string;
  status: string;
  currentNode?: string;
  progress: number;
  startedAt: string;
  endedAt?: string;
  modifiers?: { engine?: string };
}

export function fromDispatchSession(d: DispatchSessionLike, project: string, engineId = ''): SessionSummary {
  return {
    id: d.sessionId,
    title: d.prompt ? `${d.agent.command} ${d.prompt}` : d.agent.command,
    status: STATUS[d.status] ?? 'idle',
    project,
    engineId: d.modifiers?.engine ?? engineId,
    updatedAt: d.endedAt ?? d.startedAt,
    agent: { name: d.agent.name, command: d.agent.command, ...(d.agent.icon ? { icon: d.agent.icon } : {}) },
    ...(d.currentNode ? { currentNode: d.currentNode } : {}),
    progress: d.progress,
  };
}

export function agentSessionsFromEvents(events: readonly unknown[], project: string): SessionSummary[] {
  const by = new Map<string, Acc>();
  for (const raw of events) {
    const e = raw as Rec;
    const id = e.sessionId;
    if (!id) continue;
    if (e.type === 'session_created') {
      const command = str(e.command) ?? `/${str(e.agent) ?? '?'}`;
      const icon = str(e.icon);
      const prompt = str(e.prompt) ?? '';
      const mods = (e.modifiers ?? {}) as { engine?: string };
      by.set(id, {
        nodes: typeof e.nodeCount === 'number' ? e.nodeCount : 0,
        done: 0,
        s: {
          id,
          title: prompt ? `${command} ${prompt}` : command,
          status: 'running',
          project,
          engineId: mods.engine ?? '',
          updatedAt: e.ts ?? '',
          agent: { name: str(e.agent) ?? command.slice(1), command, ...(icon ? { icon } : {}) },
          progress: 0,
        },
      });
      continue;
    }
    const acc = by.get(id);
    if (!acc) continue;
    const s = acc.s;
    if (e.ts) s.updatedAt = e.ts;
    const node = str(e.nodeId);
    switch (e.type) {
      case 'subagent_added':
        acc.nodes += typeof e.nodeCount === 'number' ? e.nodeCount : 0;
        break;
      case 'node_start':
        if (node) s.currentNode = node;
        if (str(e.engineId) && !s.engineId) s.engineId = str(e.engineId)!;
        break;
      case 'node_end':
        if (node && (e.status === 'completed' || e.status === 'max_iterations')) acc.done++;
        if (node && s.currentNode === node) delete s.currentNode;
        break;
      case 'session_end': {
        s.status = STATUS[str(e.status) ?? ''] ?? 'idle';
        delete s.currentNode;
        if (e.status === 'completed') acc.done = acc.nodes;
        break;
      }
      default:
        continue;
    }
    s.progress = acc.nodes > 0 ? Math.min(1, acc.done / acc.nodes) : 0;
  }
  return [...by.values()].map((a) => a.s).sort((x, y) => y.updatedAt.localeCompare(x.updatedAt));
}
