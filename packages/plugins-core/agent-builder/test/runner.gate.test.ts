import { ChecklistLedger } from '@harness-x/checklist-ledger';
import { afterEach, describe, expect, it } from 'vitest';
import { PipelineRunner, type GateVerifier } from '../src/index.js';
import { completeItems, fakeEngine, items, pipeline, tmpWorkspace, type FakeCall } from './runner-helpers.js';

let ws: ReturnType<typeof tmpWorkspace>;
afterEach(() => ws?.cleanup());

const P = (onFail: string) =>
  pipeline({
    name: 'gated',
    nodes: [
      { id: 'plan', type: 'role', engine: 'fake' },
      { id: 'build', type: 'role', engine: 'fake' },
      { id: 'check', type: 'gate', maxRetries: 2 },
      { id: 'ship', type: 'role', engine: 'fake' },
    ],
    edges: [
      { from: 'plan', to: 'build' },
      { from: 'build', to: 'check' },
      { from: 'check', to: onFail, onFail: true },
      { from: 'check', to: 'ship' },
    ],
  });

const checklists = (node: { id: string }) => items(node.id, 3);

function setup(verify: GateVerifier) {
  ws = tmpWorkspace();
  const calls: FakeCall[] = [];
  const engine = fakeEngine('fake', () => ({ text: 'ok', effect: (o) => completeItems(o) }), calls);
  const runner = new PipelineRunner({ engines: { fake: engine }, workspace: ws.dir, checklists, verify });
  return { calls, runner };
}

const ledgerOf = (dir: string) => new ChecklistLedger({ dir, sessionId: 'x' }).get().items;

describe('41.3 gate: 실패 항목만 onFail 노드로 되돌림', () => {
  it('실패 항목만 다시 시키고 통과 항목은 건드리지 않는다 (부분 재실행)', async () => {
    const seen: string[][] = [];
    const { calls, runner } = setup(({ attempt, subjects }) => {
      seen.push(subjects.map((s) => s.nodeId));
      return attempt === 0 ? { failed: [{ itemId: 'build2', reason: '버튼 대비 부족' }] } : { failed: [] };
    });
    const r = await runner.run(P('build'), '화면');
    expect(r.status).toBe('completed');
    expect(seen).toEqual([['build'], ['build']]);
    expect(calls.map((c) => c.node)).toEqual(['plan', 'build', 'build', 'ship']);
    const rerun = calls[2]!.prompt;
    expect(rerun).toContain('build2');
    expect(rerun).toContain('버튼 대비 부족');
    expect(rerun).not.toContain('build1');
    expect(rerun).not.toContain('build3');
    const build = r.visits.find((v) => v.nodeId === 'build')!;
    const its = ledgerOf(build.ledgerDir!);
    expect(its.map((i) => [i.id, i.status, i.attempts])).toEqual([
      ['build1', 'done', 1],
      ['build2', 'done', 2],
      ['build3', 'done', 1],
    ]);
    expect(its[1]!.evidence.some((e) => e.kind === 'gate_failed')).toBe(true);
    expect(r.outputs.check).toMatchObject({ passed: true, attempt: 1 });
  });

  it('onFail이 더 상류여도 실패 항목이 속한 노드만 다시 돈다', async () => {
    const { calls, runner } = setup(({ attempt }) =>
      attempt === 0 ? { failed: [{ nodeId: 'plan', itemId: 'plan3', reason: '범위 누락' }] } : { failed: [] },
    );
    const r = await runner.run(P('plan'), '화면');
    expect(r.status).toBe('completed');
    expect(calls.map((c) => c.node)).toEqual(['plan', 'build', 'plan', 'ship']);
    expect(calls[2]!.prompt).toContain('plan3');
    expect(calls[2]!.prompt).not.toContain('plan1');
  });

  it('재시도를 다 쓰면 failed로 멈추고 다음 노드로 가지 않는다', async () => {
    const { calls, runner } = setup(() => ({ failed: [{ itemId: 'build1', reason: '계속 실패' }] }));
    const r = await runner.run(P('build'), '화면');
    expect(r.status).toBe('failed');
    expect(r.haltedAt).toBe('check');
    expect(calls.map((c) => c.node)).toEqual(['plan', 'build', 'build', 'build']);
    expect(r.visits.find((v) => v.nodeId === 'check')).toMatchObject({ status: 'failed', retries: 2 });
  });
});
