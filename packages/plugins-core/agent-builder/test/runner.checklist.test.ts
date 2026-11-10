import { afterEach, describe, expect, it } from 'vitest';
import { PipelineRunner } from '../src/index.js';
import { completeItems, fakeEngine, items, pipeline, tmpWorkspace, type FakeCall } from './runner-helpers.js';

let ws: ReturnType<typeof tmpWorkspace>;
afterEach(() => ws?.cleanup());

const P = pipeline({
  name: 'two',
  nodes: [
    { id: 'a', type: 'role', engine: 'fake', checklistTemplate: 'a' },
    { id: 'b', type: 'role', engine: 'fake', checklistTemplate: 'b' },
  ],
  edges: [{ from: 'a', to: 'b' }],
});

const checklists = (node: { id: string }) => items(node.id, 3);

describe('41.2 role 노드 완료 조건 = 체크리스트 전 항목 done', () => {
  it('미완료로 끝나면 다음 노드를 실행하지 않는다', async () => {
    ws = tmpWorkspace();
    const calls: FakeCall[] = [];
    // a: a1·a2만 끝내고 a3는 끝내 못함 (재주입 → 정체 감지 → blocked)
    const engine = fakeEngine(
      'fake',
      () => ({ text: '일부만', effect: (x) => completeItems(x, ['a1', 'a2']) }),
      calls,
    );
    const r = await new PipelineRunner({ engines: { fake: engine }, workspace: ws.dir, checklists }).run(
      P,
      'x',
    );
    expect(r.status).toBe('incomplete');
    expect(r.haltedAt).toBe('a');
    expect(r.reason).toContain('a3');
    expect(r.visits.map((v) => [v.nodeId, v.status])).toEqual([['a', 'incomplete']]);
    expect(calls.every((c) => c.node === 'a')).toBe(true);
    // 하네스 재주입으로 여러 턴을 돌렸다 (첫 턴 + 차단 뒤 자동 전송)
    expect(calls.length).toBeGreaterThan(1);
    expect(calls[1]!.prompt).toContain('a3');
  });

  it('재주입 뒤 전 항목 done이면 다음 노드로 간다', async () => {
    ws = tmpWorkspace();
    const calls: FakeCall[] = [];
    const engine = fakeEngine(
      'fake',
      (o, k) => ({
        text: 'ok',
        // 노드마다 첫 턴은 1번 항목만, 다음 턴에 나머지
        effect: (x) => completeItems(x, k % 2 === 0 ? [`${o.env!.HARNESS_X_NODE}1`] : undefined),
      }),
      calls,
    );
    const r = await new PipelineRunner({ engines: { fake: engine }, workspace: ws.dir, checklists }).run(
      P,
      'x',
    );
    expect(r.status).toBe('completed');
    expect(r.visits.map((v) => [v.nodeId, v.status])).toEqual([
      ['a', 'completed'],
      ['b', 'completed'],
    ]);
    expect(calls.map((c) => c.node)).toEqual(['a', 'a', 'b', 'b']);
  });

  it('네이티브 Stop 훅 엔진도 턴 뒤 원장이 미완료면 진행하지 않는다', async () => {
    ws = tmpWorkspace();
    const calls: FakeCall[] = [];
    const engine = fakeEngine('fake', () => ({ text: '안 함' }), calls, { nativeStopHook: true });
    const r = await new PipelineRunner({ engines: { fake: engine }, workspace: ws.dir, checklists }).run(
      P,
      'x',
    );
    expect(r.status).toBe('incomplete');
    expect(calls.map((c) => c.node)).toEqual(['a']);
  });

  it('첫 프롬프트에 노드 체크리스트가 들어간다', async () => {
    ws = tmpWorkspace();
    const calls: FakeCall[] = [];
    const engine = fakeEngine('fake', () => ({ text: 'ok', effect: (x) => completeItems(x) }), calls);
    await new PipelineRunner({ engines: { fake: engine }, workspace: ws.dir, checklists }).run(P, 'x');
    expect(calls[0]!.prompt).toContain('a1: a 항목 1 하기');
    expect(calls[1]!.prompt).toContain('b3: b 항목 3 하기');
  });
});
