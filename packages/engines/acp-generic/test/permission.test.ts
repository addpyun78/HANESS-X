import { afterEach, describe, expect, it } from 'vitest';
import { HookBus, type HookContext } from '@harness-x/kernel';
import { parseHarnessEvent, type HarnessEvent } from '@harness-x/protocol';
import { ACP_APPROVAL_KIND } from '../src/index.js';
import { collect, mockEngine, tempDir } from './helpers.js';

// 18.2 ACP session/request_permission → HookBus tool.before(차단형) → approval_request 이벤트

function finalText(events: HarnessEvent[]): string {
  const e = events.find((x) => x.type === 'assistant_text' && x.partial === false);
  return e && e.type === 'assistant_text' ? e.text : '';
}

describe('acp-generic permission gate', () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => cleanups.splice(0).forEach((c) => c()));
  const dir = () => {
    const t = tempDir();
    cleanups.push(t.cleanup);
    return t.dir;
  };

  it('tool.before가 block → approval_request 이벤트, 승인 선택이 에이전트로 돌아간다', async () => {
    const hooks = new HookBus();
    const seen: HookContext[] = [];
    hooks.onBlocking('tool.before', (ctx) => {
      seen.push(ctx);
      return { decision: 'block', reason: '사람 승인 필요' };
    });
    const run = mockEngine({ hooks }).run({
      sessionId: 'p1',
      prompt: 'perm please',
      cwd: dir(),
      itemId: 'i1',
    });
    const events: HarnessEvent[] = [];
    for await (const e of run.events) {
      events.push(e);
      if (e.type === 'approval_request') expect(run.respondApproval(e.approvalId, 'allow')).toBe(true);
    }
    const approval = events.find((e) => e.type === 'approval_request');
    expect(approval).toBeDefined();
    expect(() => parseHarnessEvent(approval)).not.toThrow();
    expect(approval).toMatchObject({
      type: 'approval_request',
      kind: ACP_APPROVAL_KIND,
      title: 'Run rm -rf build',
      sessionId: 'p1',
      engineId: 'mock-acp',
      itemId: 'i1',
      options: ['allow', 'reject'],
      detail: {
        callId: 'call-perm',
        tool: 'execute',
        input: { command: 'rm -rf build' },
        reason: '사람 승인 필요',
      },
    });
    expect(seen[0]).toMatchObject({
      sessionId: 'p1',
      engineId: 'mock-acp',
      itemId: 'i1',
      callId: 'call-perm',
      tool: 'execute',
      input: { command: 'rm -rf build' },
      source: 'acp',
    });
    expect(finalText(events)).toContain('permission=allow');
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', reason: 'completed' });
    await run.done;
  });

  it('승인 UI가 거절을 고르면 reject가 전달된다', async () => {
    const hooks = new HookBus();
    hooks.onBlocking('tool.before', () => ({ decision: 'block' }));
    const run = mockEngine({ hooks }).run({ sessionId: 'p2', prompt: 'perm', cwd: dir() });
    const events: HarnessEvent[] = [];
    for await (const e of run.events) {
      events.push(e);
      if (e.type === 'approval_request') run.respondApproval(e.approvalId, 'reject');
    }
    expect(finalText(events)).toContain('permission=reject');
    await run.done;
  });

  it('tool.before allow → 묻지 않고 allow 옵션, deny → reject 옵션', async () => {
    for (const [decision, expected] of [
      ['allow', 'permission=allow'],
      ['deny', 'permission=reject'],
    ] as const) {
      const hooks = new HookBus();
      hooks.onBlocking('tool.before', () => ({ decision }));
      const run = mockEngine({ hooks }).run({ sessionId: `p-${decision}`, prompt: 'perm', cwd: dir() });
      const events = await collect(run.events);
      expect(events.some((e) => e.type === 'approval_request')).toBe(false);
      expect(finalText(events)).toContain(expected);
      await run.done;
    }
  });

  it('훅 버스가 없으면 사람에게 묻는다(approval_request), 중단 시 cancelled', async () => {
    const run = mockEngine().run({ sessionId: 'p3', prompt: 'perm', cwd: dir() });
    const events: HarnessEvent[] = [];
    for await (const e of run.events) {
      events.push(e);
      if (e.type === 'approval_request') await run.interrupt();
    }
    expect(events.some((e) => e.type === 'approval_request')).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', reason: 'interrupted' });
    expect(run.respondApproval('nope', 'allow')).toBe(false);
    await run.done;
  });
});
