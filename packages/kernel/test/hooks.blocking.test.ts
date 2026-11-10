import { describe, expect, it } from 'vitest';
import { HookBus } from '../src/hooks.js';

describe('차단형 훅', () => {
  it('deny 반환 시 호출자가 deny 수신, 이후 훅은 실행 안 됨', async () => {
    const bus = new HookBus();
    const calls: string[] = [];
    bus.onBlocking('tool.before', () => void calls.push('a'), { priority: 1 });
    bus.onBlocking(
      'tool.before',
      () => {
        calls.push('b');
        return { decision: 'deny', reason: '계획 전 쓰기 금지' };
      },
      { id: 'plan-gate', priority: 2 },
    );
    bus.onBlocking('tool.before', () => void calls.push('c'), { priority: 3 });
    const out = await bus.runBlocking('tool.before', { tool: 'Write' });
    expect(out.decision).toBe('deny');
    expect(out.reason).toBe('계획 전 쓰기 금지');
    expect(out.hookId).toBe('plan-gate');
    expect(calls).toEqual(['a', 'b']);
  });

  it('block도 중단, 훅 없으면 allow', async () => {
    const bus = new HookBus();
    expect((await bus.runBlocking('stop.before')).decision).toBe('allow');
    bus.onBlocking('stop.before', async () => ({ decision: 'block', reason: '미완료 2개' }));
    expect(await bus.runBlocking('stop.before')).toMatchObject({ decision: 'block', reason: '미완료 2개' });
  });

  it('patch가 다음 훅과 호출자에게 전달', async () => {
    const bus = new HookBus();
    bus.onBlocking('tool.before', () => ({ decision: 'allow', patch: { path: 'harness/mobile/a.kt' } }), {
      priority: 1,
    });
    let seen: unknown;
    bus.onBlocking('tool.before', (ctx) => void (seen = ctx.path), { priority: 2 });
    const out = await bus.runBlocking('tool.before', { path: '하네스/모바일/a.kt' });
    expect(seen).toBe('harness/mobile/a.kt');
    expect(out.patch).toEqual({ path: 'harness/mobile/a.kt' });
  });

  it('예외는 failMode로 처리', async () => {
    const bus = new HookBus();
    bus.onBlocking('tool.before', () => {
      throw new Error('boom');
    });
    expect((await bus.runBlocking('tool.before')).decision).toBe('allow');
    bus.onBlocking(
      'tool.before',
      () => {
        throw new Error('boom');
      },
      { failMode: 'deny' },
    );
    expect((await bus.runBlocking('tool.before')).decision).toBe('deny');
  });
});
