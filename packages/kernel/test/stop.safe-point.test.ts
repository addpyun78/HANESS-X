import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parsePipeline, type HarnessEvent } from '@harness-x/protocol';
import { checkPlainKorean } from '@harness-x/approvals';
import { runAgentLoop, type ModelClient, type ModelTurn } from '../src/agent-loop.js';
import { EventLog, type LogRecord } from '../src/event-log.js';
import { Dispatcher, type DispatchAgent, type DispatchRunInput } from '../src/dispatch.js';
import { isSafePoint, PAUSE_SAFE_POINT_TIMEOUT_MS, PAUSE_TIMEOUT_QUESTION, PauseGate } from '../src/stop.js';
import { tempDir } from './helpers.js';

const agent: DispatchAgent = {
  name: 'qa',
  command: '/qa',
  displayName: 'QA',
  pipeline: parsePipeline({ name: 'qa', nodes: [{ id: 'build', type: 'role' }], edges: [] }),
};

const tmp = tempDir('hx-safe-');
const log = new EventLog({ root: join(tmp.dir, 'logs') });
afterEach(() => {
  log.flush();
  vi.useRealTimers();
});

describe('2A.3 안전한 지점', () => {
  it('도구 끝(tool_result)·턴 끝·노드 끝만 안전한 지점', () => {
    expect(['tool_result', 'turn_end', 'node_end'].every((type) => isSafePoint({ type }))).toBe(true);
    expect(
      ['tool_call', 'assistant_text', 'file_change', 'node_start'].some((type) => isSafePoint({ type })),
    ).toBe(false);
  });

  it('타이머: 60초 안에 안전한 지점이 안 오면 "지금 멈출까요?" 한 번', () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const g = new PauseGate({ onTimeout });
    expect(PAUSE_SAFE_POINT_TIMEOUT_MS).toBe(60_000);
    expect(g.request()).toBe(true);
    expect(g.request()).toBe(false);
    vi.advanceTimersByTime(59_999);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(g.askedStopNow).toBe(true);
    vi.advanceTimersByTime(120_000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    // 늦게라도 안전한 지점이 오면 멈춘다
    expect(g.atSafePoint()).toBe(true);
    expect(g.atSafePoint()).toBe(false);
  });

  it('타이머: 60초 전에 안전한 지점이 오면 묻지 않음', () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const g = new PauseGate({ onTimeout });
    expect(g.atSafePoint()).toBe(false); // 요청 없음
    g.request();
    vi.advanceTimersByTime(30_000);
    expect(g.atSafePoint()).toBe(true);
    vi.advanceTimersByTime(120_000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('질문 문구는 쉬운 말', () => {
    expect(checkPlainKorean(PAUSE_TIMEOUT_QUESTION.body).ok).toBe(true);
    for (const c of PAUSE_TIMEOUT_QUESTION.choices)
      expect(checkPlainKorean(c, { label: true }).ok).toBe(true);
  });
});

describe('2A.3 Dispatcher 일시정지', () => {
  it('도구 실행 중 일시정지 → 도구가 끝난 순간(tool_result) 멈춤, kind pause', async () => {
    let toolDone!: () => void;
    const toolGate = new Promise<void>((r) => (toolDone = r));
    let reachedNextTurn = false;
    const run = async (i: DispatchRunInput) => {
      const e = (type: string, extra: Record<string, unknown> = {}) =>
        i.onEvent({ id: type, ts: '', sessionId: i.sessionId, type, nodeId: 'build', ...extra });
      e('node_start');
      e('tool_call', { callId: 'c1', tool: 'write_file' });
      await toolGate;
      e('tool_result', { callId: 'c1', ok: true });
      // 실행기는 다음 AI 턴 전에 signal을 본다
      if (!i.signal.aborted) reachedNextTurn = true;
      return { status: i.signal.aborted ? 'error' : 'completed' };
    };
    const seen: LogRecord[] = [];
    const off = log.subscribe((r) => seen.push(r));
    const d = new Dispatcher({ resolve: () => agent, run, log });
    const s = d.dispatch({ agent: 'qa', prompt: 'x' });
    d.pause(s.sessionId);
    await Promise.resolve();
    expect(d.get(s.sessionId)!.status).toBe('running'); // 도구가 끝나기 전엔 안 멈춤
    toolDone();
    const end = await d.wait(s.sessionId);
    off();
    expect(reachedNextTurn).toBe(false);
    expect(end).toMatchObject({ status: 'paused', pausing: false, paused: { reason: 'user' } });
    expect(seen.find((r) => r.type === 'session_paused')).toMatchObject({ kind: 'pause', nodeId: 'build' });
  });

  it('60초 동안 안전한 지점이 없으면 pause_timeout("지금 멈출까요?") 기록', async () => {
    vi.useFakeTimers();
    const seen: LogRecord[] = [];
    const off = log.subscribe((r) => seen.push(r));
    const run = async (i: DispatchRunInput) => {
      await new Promise<void>((r) => i.signal.addEventListener('abort', () => r(), { once: true }));
      return { status: 'error' };
    };
    const d = new Dispatcher({ resolve: () => agent, run, log });
    const s = d.dispatch({ agent: 'qa', prompt: 'x' });
    d.pause(s.sessionId);
    vi.advanceTimersByTime(60_000);
    const q = seen.find((r) => r.type === 'pause_timeout' && r.sessionId === s.sessionId);
    expect(q).toMatchObject({ title: '지금 멈출까요?', choices: ['지금 멈추기', '계속 기다리기'] });
    vi.useRealTimers();
    expect((await d.stopNow(s.sessionId)).state).toBe('paused');
    off();
  });
});

describe('2A.3 agent-loop 일시정지', () => {
  it('도구 실행이 끝난 뒤 다음 AI 턴 전에 멈춤 (모델 호출 1번)', async () => {
    const gate = new PauseGate();
    let calls = 0;
    const turns: ModelTurn[] = [
      { text: '', toolCalls: [{ id: 'c1', name: 'list_dir', arguments: {} }] },
      { text: 'done', toolCalls: [] },
    ];
    const client: ModelClient = {
      async complete() {
        const t = turns[calls++]!;
        gate.request(); // 모델이 답하는 중에 사용자가 ⏸
        return t;
      },
    };
    const out: HarnessEvent[] = [];
    for await (const e of runAgentLoop({
      client,
      sessionId: 's',
      cwd: tmp.dir,
      prompt: 'x',
      pauseGate: gate,
    }))
      out.push(e);
    expect(calls).toBe(1);
    expect(out.map((e) => e.type)).toEqual(['tool_call', 'tool_result', 'turn_end']);
    expect(out.at(-1)).toMatchObject({ type: 'turn_end', reason: 'interrupted' });
    gate.dispose();
  });
});
