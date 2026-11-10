import { afterEach, describe, expect, it } from 'vitest';
import { PipelineRunner } from '../src/index.js';
import { fakeEngine, pipeline, tmpWorkspace, type FakeCall } from './runner-helpers.js';

let ws: ReturnType<typeof tmpWorkspace>;
afterEach(() => ws?.cleanup());

const P = (loop: { maxIterations?: number; stallLimit?: number; until?: string }) =>
  pipeline({
    name: 'looped',
    entry: 'again',
    nodes: [
      { id: 'again', type: 'loop', ...loop },
      { id: 'work', type: 'role', engine: 'fake' },
      { id: 'done', type: 'role', engine: 'fake' },
    ],
    edges: [
      { from: 'again', to: 'work' },
      { from: 'work', to: 'again' },
      { from: 'again', to: 'done' },
    ],
  });

function run(p: ReturnType<typeof P>, text: (k: number) => string) {
  ws = tmpWorkspace();
  const calls: FakeCall[] = [];
  let k = 0;
  const engine = fakeEngine('fake', () => ({ text: text(k++) }), calls);
  return new PipelineRunner({ engines: { fake: engine }, workspace: ws.dir })
    .run(p, '반복')
    .then((r) => ({ r, calls }));
}

describe('41.5 loop 노드 최대 반복·정체 감지', () => {
  it('출력이 계속 바뀌면 maxIterations에서 멈추고 출구로 진행', async () => {
    const { r, calls } = await run(P({ maxIterations: 3 }), (k) => `v${k}`);
    expect(r.status).toBe('completed');
    expect(calls.map((c) => c.node)).toEqual(['work', 'work', 'work', 'done']);
    expect(r.visits.find((v) => v.nodeId === 'again')).toMatchObject({
      status: 'max_iterations',
      iterations: 3,
    });
    expect(r.visits.filter((v) => v.nodeId === 'work').map((v) => v.visit)).toEqual([1, 2, 3]);
  });

  it('출력 변화 없이 stallLimit만큼 반복하면 정체로 중단 (출구로 가지 않음)', async () => {
    const { r, calls } = await run(P({ maxIterations: 10, stallLimit: 2 }), () => '같음');
    expect(r.status).toBe('stalled');
    expect(r.haltedAt).toBe('again');
    expect(calls.map((c) => c.node)).toEqual(['work', 'work', 'work']);
    expect(r.visits.find((v) => v.nodeId === 'again')).toMatchObject({ status: 'stalled', iterations: 3 });
  });

  it('until이 참이면 그 반복에서 끝낸다', async () => {
    const { r, calls } = await run(P({ maxIterations: 5, until: "output.text == 'ok'" }), (k) =>
      k === 1 ? 'ok' : `v${k}`,
    );
    expect(r.status).toBe('completed');
    expect(calls.map((c) => c.node)).toEqual(['work', 'work', 'done']);
    expect(r.visits.find((v) => v.nodeId === 'again')).toMatchObject({ status: 'completed', iterations: 2 });
  });
});
