import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parsePipeline } from '@harness-x/protocol';
import { EventLog, type LogRecord } from '../src/event-log.js';
import { Dispatcher, type DispatchAgent, type DispatchRunInput } from '../src/dispatch.js';
import { resumeSession, settleInterruptedItem } from '../src/resume-run.js';
import { tempDir } from './helpers.js';

const tmp = tempDir('hx-interrupted-');
afterAll(() => tmp.cleanup());

const agent: DispatchAgent = {
  name: 'qa',
  command: '/qa',
  displayName: 'QA',
  pipeline: parsePipeline({ name: 'qa', nodes: [{ id: 'build', type: 'role' }], edges: [] }),
};

/** 반쯤 끝난 항목: I-1 done, I-2 doing(멈출 때 하던 것), I-3 todo */
function ledger() {
  const items = [
    { id: 'I-1', title: '로그인 화면', status: 'done' },
    { id: 'I-2', title: '비밀번호 찾기', status: 'doing' },
    { id: 'I-3', title: '회원 가입', status: 'todo' },
  ];
  return { items, view: { read: () => ({ items }) } };
}

async function pausedSession(dir: string) {
  const log = new EventLog({ root: join(dir, 'logs') });
  const runs: DispatchRunInput[] = [];
  const d = new Dispatcher({
    log,
    resolve: () => agent,
    run: async (i) => {
      runs.push(i);
      if (runs.length === 1) {
        // I-2를 하던 중 멈춤
        i.onEvent({ id: 'x', ts: '', sessionId: i.sessionId, type: 'tool_call', itemId: 'I-2' });
        await new Promise<void>((r) => i.signal.addEventListener('abort', () => r(), { once: true }));
        return { status: 'error' };
      }
      return { status: 'completed' };
    },
  });
  const s = d.dispatch({ agent: 'qa', prompt: '회원 기능 만들기' });
  await d.stopNow(s.sessionId);
  log.flush();
  return { log, d, runs, sessionId: s.sessionId };
}

describe('2B.10 멈췄던 항목 처리 — 먼저 검증, 통과면 done, 아니면 이어서', () => {
  it('검증 통과 → done으로 바꾸고 다음 항목부터 (요약에 "끝난 것으로 처리")', async () => {
    const p = await pausedSession(join(tmp.dir, 'a'));
    const l = ledger();
    const verified: string[] = [];
    const seen: LogRecord[] = [];
    const off = p.log.subscribe((r) => seen.push(r));
    const r = await resumeSession(
      {
        log: p.log,
        dispatcher: p.d,
        agentFor: () => agent,
        ledger: () => l.view,
        interrupted: () => ({
          verify: (id) => (verified.push(id), true),
          markDone: (id) => (l.items.find((i) => i.id === id)!.status = 'done'),
        }),
      },
      p.sessionId,
    );
    off();
    expect(verified).toEqual(['I-2']);
    expect(r.interrupted).toEqual({ id: 'I-2', verified: true });
    expect(l.items.map((i) => i.status)).toEqual(['done', 'done', 'todo']);
    expect(r.mode).toBe('summary');
    expect(r.prompt).toContain('멈출 때 하던 I-2는 검사를 통과해 끝난 것으로 처리했습니다.');
    expect(r.prompt).toContain('- [x] I-2 비밀번호 찾기');
    expect(r.prompt).toContain('남은 일 (1개):');
    expect(p.runs.at(-1)!.prompt).toBe(r.prompt);
    expect(seen.find((e) => e.type === 'session_resumed')).toMatchObject({
      interrupted: { id: 'I-2', verified: true },
    });
    expect((await p.d.wait(p.sessionId)).status).toBe('completed');
  });

  it('검증 실패 → 그대로 두고 그 항목부터 이어서', async () => {
    const p = await pausedSession(join(tmp.dir, 'b'));
    const l = ledger();
    const r = await resumeSession(
      {
        log: p.log,
        dispatcher: p.d,
        agentFor: () => agent,
        ledger: () => l.view,
        interrupted: () => ({ verify: () => false, markDone: () => expect.fail('통과하지 않았는데 done') }),
      },
      p.sessionId,
    );
    expect(r.interrupted).toEqual({ id: 'I-2', verified: false });
    expect(l.items[1]!.status).toBe('doing');
    expect(r.prompt).toContain('멈출 때 하던 I-2는 아직 끝나지 않았습니다. 이 항목부터 이어서 하세요.');
  });

  it('검증 중 오류는 실패로 본다', async () => {
    const r = await settleInterruptedItem('I-9', {
      verify: () => {
        throw new Error('검사 도구 없음');
      },
      markDone: () => expect.fail('done 금지'),
    });
    expect(r).toEqual({ id: 'I-9', verified: false });
  });
});
