import type { LogRecord } from './event-log.js';

/**
 * T-100 P2-F.6 새 도구 첫 실행 확인 카드 (서버 쪽).
 *  - permission-gate의 ask 콜백이 부른다 → approval_request(kind 'tool.first-run') 이벤트 → 웹 패널 카드
 *  - 사람이 [이번만 허락]·[앞으로 허락]·[허락 안 함] 중 하나를 누를 때까지 기다린다
 *  - 시간 안에 고르지 않으면 허락하지 않는다 (절대 자동 허락 없음)
 *  - 카드를 보여 줄 곳(이벤트 기록)이 없으면 바로 허락하지 않는다
 */

export const TOOL_FIRST_RUN_EVENT_KIND = 'tool.first-run';
export const FIRST_RUN_CHOICES = ['once', 'always', 'deny'] as const;
export type FirstRunChoice = (typeof FIRST_RUN_CHOICES)[number];
/** 버튼 문구 (웹 apps/web/src/install/FirstRunCard.tsx와 같다) */
export const FIRST_RUN_LABELS: Readonly<Record<FirstRunChoice, string>> = Object.freeze({
  once: '이번만 허락',
  always: '앞으로 허락',
  deny: '허락 안 함',
});
export const FIRST_RUN_TIMEOUT_MS = 5 * 60_000;

export function isFirstRunChoice(v: unknown): v is FirstRunChoice {
  return typeof v === 'string' && (FIRST_RUN_CHOICES as readonly string[]).includes(v);
}

export interface FirstRunRequest {
  toolId: string;
  toolName: string;
  command: string;
}

/** 카드에 보이는 쉬운 말 (checkPlainKorean 통과) */
export function firstRunCardText(toolName: string, timeoutMs = FIRST_RUN_TIMEOUT_MS) {
  const minutes = Math.max(1, Math.round(timeoutMs / 60_000));
  return {
    title: '새 도구를 처음 써요',
    whatHappened: `방금 설치한 도구 "${toolName}"을(를) 처음 실행하려고 해요.`,
    whyAsking: '새 도구는 처음 한 번 사람이 허락해야 실행돼요.',
    timeoutNote: `${minutes}분 안에 고르지 않으면 실행하지 않아요.`,
  };
}

export interface FirstRunAskerOptions {
  /** 카드 이벤트 기록 (EventLog.append). 없으면 묻지 않고 바로 거부 */
  log?: { append(ev: LogRecord): unknown };
  timeoutMs?: number;
}

interface Pending {
  req: FirstRunRequest;
  resolve(c: FirstRunChoice): void;
  timer: ReturnType<typeof setTimeout>;
}

export class FirstRunAsker {
  private readonly waiting = new Map<string, Pending>();
  private seq = 0;
  readonly timeoutMs: number;

  constructor(private readonly o: FirstRunAskerOptions = {}) {
    this.timeoutMs = o.timeoutMs ?? FIRST_RUN_TIMEOUT_MS;
  }

  /** 카드를 띄우고 사람의 선택을 기다린다 (시간 초과 → 'deny') */
  ask(req: FirstRunRequest): Promise<FirstRunChoice> {
    const log = this.o.log;
    if (!log) return Promise.resolve('deny');
    this.seq += 1;
    const id = `tool-first-run-${Date.now().toString(36)}-${this.seq}`;
    const text = firstRunCardText(req.toolName, this.timeoutMs);
    return new Promise<FirstRunChoice>((resolve) => {
      const timer = setTimeout(() => this.finish(id, 'deny', 'timeout'), this.timeoutMs);
      timer.unref?.();
      this.waiting.set(id, { req, resolve, timer });
      log.append({
        id,
        ts: new Date().toISOString(),
        sessionId: 'tools',
        type: 'approval_request',
        approvalId: id,
        kind: TOOL_FIRST_RUN_EVENT_KIND,
        title: text.title,
        detail: { ...req, ...text, timeoutMs: this.timeoutMs },
        options: [...FIRST_RUN_CHOICES],
      } as LogRecord);
    });
  }

  /** 카드 버튼 → 기다리던 실행에 답. 없는(끝난) 카드면 false */
  answer(id: string, choice: FirstRunChoice): boolean {
    return this.finish(id, choice, 'user');
  }

  pending(): { id: string; toolId: string; toolName: string; command: string }[] {
    return [...this.waiting].map(([id, p]) => ({ id, ...p.req }));
  }

  dispose(): void {
    for (const id of [...this.waiting.keys()]) this.finish(id, 'deny', 'timeout');
  }

  private finish(id: string, choice: FirstRunChoice, by: 'user' | 'timeout'): boolean {
    const p = this.waiting.get(id);
    if (!p) return false;
    this.waiting.delete(id);
    clearTimeout(p.timer);
    this.o.log?.append({
      id: `${id}-resolved`,
      ts: new Date().toISOString(),
      sessionId: 'tools',
      type: 'approval_resolved',
      approvalId: id,
      choice,
      ...(choice === 'always' ? { remember: true } : {}),
      by,
    } as LogRecord);
    p.resolve(choice);
    return true;
  }
}
