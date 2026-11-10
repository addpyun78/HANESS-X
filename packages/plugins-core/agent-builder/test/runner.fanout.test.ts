import { afterEach, describe, expect, it } from 'vitest';
import { PipelineRunner } from '../src/index.js';
import { fakeEngine, pipeline, tmpWorkspace, type FakeCall } from './runner-helpers.js';

let ws: ReturnType<typeof tmpWorkspace>;
afterEach(() => ws?.cleanup());

const BRANCHES = ['r1', 'r2', 'r3', 'r4', 'r5'];

const P = (maxConcurrency: number) =>
  pipeline({
    name: 'fan',
    nodes: [
      { id: 'split', type: 'fanout', maxConcurrency },
      ...BRANCHES.map((id) => ({ id, type: 'role' as const, engine: 'fake' })),
      { id: 'merge', type: 'join' },
      { id: 'final', type: 'role', engine: 'fake' },
    ],
    edges: [
      ...BRANCHES.flatMap((id) => [
        { from: 'split', to: id },
        { from: id, to: 'merge' },
      ]),
      { from: 'merge', to: 'final' },
    ],
  });

function concurrencyEngine() {
  let active = 0;
  let max = 0;
  const calls: FakeCall[] = [];
  const order: string[] = [];
  const engine = fakeEngine(
    'fake',
    (o) => {
      const node = o.env!.HARNESS_X_NODE!;
      active++;
      max = Math.max(max, active);
      return {
        delayMs: node === 'final' ? 0 : 60,
        effect: () => {
          active--;
          order.push(node);
        },
        text: node,
      };
    },
    calls,
  );
  return { engine, calls, order, max: () => max };
}

describe('41.4 fanout/join 병렬 실행 (최대 동시 3)', () => {
  it('갈래 5개를 동시에 최대 3개씩 돌리고 join에서 모두 모은 뒤 진행', async () => {
    ws = tmpWorkspace();
    const c = concurrencyEngine();
    const t0 = Date.now();
    const r = await new PipelineRunner({ engines: { fake: c.engine }, workspace: ws.dir }).run(P(3), '병렬');
    expect(r.status).toBe('completed');
    expect(c.max()).toBe(3);
    expect(new Set(c.order.slice(0, 5))).toEqual(new Set(BRANCHES));
    expect(c.order.at(-1)).toBe('final');
    // 순차였다면 5×60ms 이상
    expect(Date.now() - t0).toBeLessThan(5 * 60 + 2000);
    const merged = r.outputs.merge as { branches: Record<string, unknown> };
    expect(Object.keys(merged.branches).sort()).toEqual(BRANCHES);
    expect(merged.branches.r4).toEqual({ text: 'r4' });
  });

  it('maxConcurrency 2면 동시 2개까지', async () => {
    ws = tmpWorkspace();
    const c = concurrencyEngine();
    const r = await new PipelineRunner({ engines: { fake: c.engine }, workspace: ws.dir }).run(P(2), '병렬');
    expect(r.status).toBe('completed');
    expect(c.max()).toBe(2);
  });

  it('한 갈래가 멈추면 join 뒤로 진행하지 않는다', async () => {
    ws = tmpWorkspace();
    const calls: FakeCall[] = [];
    const engine = fakeEngine(
      'fake',
      (o) => ({ text: 'x', reason: o.env!.HARNESS_X_NODE === 'r2' ? 'error' : 'completed' }),
      calls,
    );
    const r = await new PipelineRunner({ engines: { fake: engine }, workspace: ws.dir }).run(P(3), '병렬');
    expect(r.status).toBe('incomplete');
    expect(r.haltedAt).toBe('r2');
    expect(calls.some((x) => x.node === 'final')).toBe(false);
  });
});
