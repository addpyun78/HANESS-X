import { afterEach, describe, expect, it } from 'vitest';
import { PipelineRunner } from '../src/index.js';
import { completeItems, fakeEngine, items, pipeline, tmpWorkspace } from './runner-helpers.js';

let ws: ReturnType<typeof tmpWorkspace>;
afterEach(() => ws?.cleanup());

const P = pipeline({
  name: 'ev',
  nodes: [
    { id: 'plan', type: 'role', engine: 'fake' },
    { id: 'build', type: 'role', engine: 'fake' },
  ],
  edges: [{ from: 'plan', to: 'build' }],
});

describe('41.6 노드 진행 이벤트 (node_start/node_end)', () => {
  it('노드마다 node_start → 엔진 이벤트 → node_end 순서로 이벤트 로그에 남는다', async () => {
    ws = tmpWorkspace();
    const engine = fakeEngine('fake', () => ({ text: 'ok', effect: (o) => completeItems(o) }));
    const streamed: string[] = [];
    const r = await new PipelineRunner({
      engines: { fake: engine },
      workspace: ws.dir,
      log: ws.log,
      sessionId: 'run-41-6',
      checklists: (n) => items(n.id, 1),
      onEvent: (e) => streamed.push(e.type),
    }).run(P, 'x');
    expect(r.status).toBe('completed');
    ws.log.flush();
    const recs = ws.log.query({ sessionId: 'run-41-6' });
    const marks = recs
      .filter((e) => e.type === 'node_start' || e.type === 'node_end' || e.type === 'turn_end')
      .map((e) => `${e.type}:${String(e.nodeId ?? e.engineId)}`);
    expect(marks).toEqual([
      'node_start:plan',
      'turn_end:fake',
      'node_end:plan',
      'node_start:build',
      'turn_end:fake',
      'node_end:build',
    ]);
    const end = recs.find((e) => e.type === 'node_end' && e.nodeId === 'plan')!;
    expect(end).toMatchObject({
      pipeline: 'ev',
      nodeType: 'role',
      visit: 1,
      status: 'completed',
      engineId: 'fake',
    });
    expect(typeof end.durationMs).toBe('number');
    // 원장 변경도 같은 세션에 남는다
    expect(recs.some((e) => e.type === 'checklist_change')).toBe(true);
    expect(streamed.filter((t) => t === 'node_end')).toHaveLength(2);
    expect(ws.log.query({ sessionId: 'run-41-6', type: 'node_start' })).toHaveLength(2);
  });

  it('미완료 노드는 node_end(status: incomplete, reason)', async () => {
    ws = tmpWorkspace();
    const engine = fakeEngine('fake', () => ({ text: '안 함' }), [], { nativeStopHook: true });
    await new PipelineRunner({
      engines: { fake: engine },
      workspace: ws.dir,
      log: ws.log,
      sessionId: 'run-41-6b',
      checklists: (n) => items(n.id, 2),
    }).run(P, 'x');
    ws.log.flush();
    const ends = ws.log.query({ sessionId: 'run-41-6b', type: 'node_end' });
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ nodeId: 'plan', status: 'incomplete' });
    expect(String(ends[0]!.reason)).toContain('plan1');
  });
});
