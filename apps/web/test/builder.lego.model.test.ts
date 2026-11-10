import { describe, expect, it } from 'vitest';
import { DEFAULT_CATALOG } from '../src/builder/catalog.js';
import { toFlowEdges, toFlowNodes } from '../src/builder/flow.js';
import { emptyGraph, type BuilderGraph } from '../src/builder/graph.js';
import { HISTORY_LIMIT, initHistory, withHistory } from '../src/builder/lego/history.js';
import {
  edgeCompat,
  extractGroup,
  legoReducer,
  skillsOf,
  type LegoAction,
} from '../src/builder/lego/model.js';

const run = (g: BuilderGraph, ...as: LegoAction[]) => as.reduce(legoReducer, g);
const base = () =>
  run(
    emptyGraph(),
    { type: 'addNode', nodeType: 'role', position: { x: 0, y: 0 } },
    { type: 'addNode', nodeType: 'role', position: { x: 240, y: 0 } },
    { type: 'addNode', nodeType: 'gate', position: { x: 480, y: 0 } },
  );
const skills = (g: BuilderGraph, id: string) => skillsOf(g.nodes.find((n) => n.id === id)!.spec);
const designQa = DEFAULT_CATALOG.plugins[0]!;

describe('45.1/45.2 스킬 칩 장착·분리', () => {
  it('장착: 순서 유지·중복 없음, role 노드만', () => {
    const g = run(
      base(),
      { type: 'attachSkill', nodeId: 'role', skill: 'design-brief' },
      { type: 'attachSkill', nodeId: 'role', skill: 'a11y-check' },
      { type: 'attachSkill', nodeId: 'role', skill: 'design-brief' },
    );
    expect(skills(g, 'role')).toEqual(['design-brief', 'a11y-check']);
    const gate = run(g, { type: 'attachSkill', nodeId: 'gate', skill: 'x' });
    expect(gate).toBe(g);
  });

  it('분리(×·밖으로), 다른 노드로 옮기기', () => {
    let g = run(
      base(),
      { type: 'attachSkill', nodeId: 'role', skill: 'a' },
      { type: 'attachSkill', nodeId: 'role', skill: 'b' },
    );
    g = run(g, { type: 'detachSkill', nodeId: 'role', skill: 'a' });
    expect(skills(g, 'role')).toEqual(['b']);
    expect(run(g, { type: 'detachSkill', nodeId: 'role', skill: 'zz' })).toBe(g);
    g = run(g, { type: 'moveSkill', from: 'role', to: 'role-2', skill: 'b' });
    expect(skills(g, 'role')).toEqual([]);
    expect(skills(g, 'role-2')).toEqual(['b']);
    // gate로는 옮겨지지 않는다
    expect(run(g, { type: 'moveSkill', from: 'role-2', to: 'gate', skill: 'b' })).toBe(g);
  });
});

describe('45.3 엔진 지정', () => {
  it('engine 필드 갱신 (role/subagent만)', () => {
    const g = run(base(), { type: 'setEngine', nodeId: 'role', engine: 'codex' });
    expect(g.nodes[0]!.spec).toMatchObject({ engine: 'codex' });
    expect(run(g, { type: 'setEngine', nodeId: 'gate', engine: 'codex' })).toBe(g);
    expect(run(g, { type: 'setEngine', nodeId: 'role', engine: 'codex' })).toBe(g);
  });
});

describe('45.4 플러그인 그룹', () => {
  it('플러그인 블록 → 그룹 + 노드 + 내부 엣지, 겹치는 id는 새 id', () => {
    let g = run(emptyGraph(), {
      type: 'addPlugin',
      pluginId: designQa.id,
      label: designQa.label,
      pipeline: designQa.pipeline!,
      position: { x: 30, y: 30 },
    });
    expect(g.groups).toEqual([
      { id: 'plugin-design-qa', pluginId: 'design-qa', label: '디자인 QA', position: { x: 32, y: 32 } },
    ]);
    expect(g.nodes.map((n) => [n.id, n.groupId])).toEqual([
      ['plan', 'plugin-design-qa'],
      ['build', 'plugin-design-qa'],
      ['critic', 'plugin-design-qa'],
    ]);
    expect(g.edges.map((e) => `${e.from}>${e.to}`)).toEqual(['plan>build', 'build>critic']);

    g = run(g, {
      type: 'addPlugin',
      pluginId: designQa.id,
      label: designQa.label,
      pipeline: designQa.pipeline!,
      position: { x: 0, y: 400 },
    });
    expect(g.groups.map((x) => x.id)).toEqual(['plugin-design-qa', 'plugin-design-qa-2']);
    expect(g.nodes.filter((n) => n.groupId === 'plugin-design-qa-2').map((n) => n.id)).toEqual([
      'plan-2',
      'build-2',
      'critic-2',
    ]);
    expect(g.edges.map((e) => `${e.from}>${e.to}`)).toContain('plan-2>build-2');

    // React Flow: 그룹 노드가 먼저, 자식은 parentId
    const flow = toFlowNodes(g);
    expect(flow[0]).toMatchObject({ id: 'plugin-design-qa', type: 'hxGroup' });
    expect(flow.find((n) => n.id === 'build-2')).toMatchObject({ parentId: 'plugin-design-qa-2' });
  });

  it('그룹째 이동(자식 상대 좌표 유지)·분리(통째로 빠지고 파이프라인으로 추출)', () => {
    let g = run(emptyGraph(), {
      type: 'addPlugin',
      pluginId: designQa.id,
      label: designQa.label,
      pipeline: designQa.pipeline!,
      position: { x: 0, y: 0 },
    });
    const before = g.nodes.map((n) => n.position);
    g = run(g, { type: 'moveGroup', id: 'plugin-design-qa', position: { x: 160, y: 80 } });
    expect(g.groups[0]!.position).toEqual({ x: 160, y: 80 });
    expect(g.nodes.map((n) => n.position)).toEqual(before);

    const extracted = extractGroup(g, 'plugin-design-qa')!;
    expect(extracted.nodes.map((n) => n.id)).toEqual(['plan', 'build', 'critic']);
    expect(extracted.edges).toHaveLength(2);

    g = run(g, { type: 'addNode', nodeType: 'role', position: { x: 0, y: 400 } });
    g = run(g, { type: 'connect', from: 'critic', to: 'role' });
    g = run(g, { type: 'detachGroup', id: 'plugin-design-qa' });
    expect(g.groups).toEqual([]);
    expect(g.nodes.map((n) => n.id)).toEqual(['role']);
    expect(g.edges).toEqual([]);
  });
});

describe('45.5 포트 연결/해제 + 스키마 호환성', () => {
  const plugin = () =>
    run(emptyGraph(), {
      type: 'addPlugin',
      pluginId: designQa.id,
      label: designQa.label,
      pipeline: designQa.pipeline!,
      position: { x: 0, y: 0 },
    });

  it('연결·중복 무시·자기 연결 금지·해제', () => {
    let g = run(base(), { type: 'connect', from: 'role', to: 'role-2' });
    expect(g.edges.map((e) => e.id)).toEqual(['e:role>role-2']);
    expect(run(g, { type: 'connect', from: 'role', to: 'role-2' })).toBe(g);
    expect(run(g, { type: 'connect', from: 'role', to: 'role' })).toBe(g);
    expect(run(g, { type: 'connect', from: 'role', to: 'nope' })).toBe(g);
    g = run(g, { type: 'disconnect', id: 'e:role>role-2' });
    expect(g.edges).toEqual([]);
  });

  it('비호환 연결 → 빨간 선 + 사유 (정적 검사 checkSchemaCompat)', () => {
    const g = run(plugin(), { type: 'connect', from: 'plan', to: 'critic' });
    expect(edgeCompat(g, { from: 'plan', to: 'build' }).compatible).toBe(true);
    const bad = edgeCompat(g, { from: 'plan', to: 'critic' });
    expect(bad.compatible).toBe(false);
    expect(bad.reason).toContain('changedFiles: 필수 입력 필드를 출력이 제공하지 않음');

    const edges = toFlowEdges(g);
    const red = edges.find((e) => e.id === 'e:plan>critic')!;
    expect(red).toMatchObject({ type: 'hxEdge', className: 'hx-edge--bad', data: { compatible: false } });
    expect(red.data!.reason).toContain('plan → critic 비호환');
    expect(edges.find((e) => e.id === 'e:plan>build')!.data!.compatible).toBe(true);
  });
});

describe('45.6 실행 취소/다시 실행 50단계', () => {
  const reducer = withHistory(legoReducer);

  it('undo/redo, 새 동작은 redo를 비움, 선택·이동은 기록 안 함', () => {
    let h = initHistory(emptyGraph());
    h = reducer(h, { type: 'addNode', nodeType: 'role', position: { x: 0, y: 0 } });
    h = reducer(h, { type: 'attachSkill', nodeId: 'role', skill: 'a' });
    h = reducer(h, { type: 'select', ids: [] });
    h = reducer(h, { type: 'moveNode', id: 'role', position: { x: 64, y: 0 } });
    expect(h.past).toHaveLength(2);
    h = reducer(h, { type: 'undo' });
    expect(skills(h.present, 'role')).toEqual([]);
    h = reducer(h, { type: 'redo' });
    expect(skills(h.present, 'role')).toEqual(['a']);
    h = reducer(h, { type: 'undo' });
    h = reducer(h, { type: 'undo' });
    expect(h.present.nodes).toHaveLength(0);
    expect(reducer(h, { type: 'undo' })).toBe(h);
    h = reducer(h, { type: 'redo' });
    h = reducer(h, { type: 'setEngine', nodeId: 'role', engine: 'codex' });
    expect(h.future).toEqual([]);
    // 아무것도 안 바뀐 동작은 기록하지 않는다
    expect(reducer(h, { type: 'setEngine', nodeId: 'role', engine: 'codex' })).toBe(h);
  });

  it('끌기: checkpoint 한 번 → 이동 여러 번 = undo 한 번', () => {
    let h = initHistory(emptyGraph());
    h = reducer(h, { type: 'addNode', nodeType: 'role', position: { x: 0, y: 0 } });
    h = reducer(h, { type: 'checkpoint' });
    for (const x of [16, 32, 48]) h = reducer(h, { type: 'moveNode', id: 'role', position: { x, y: 0 } });
    h = reducer(h, { type: 'undo' });
    expect(h.present.nodes[0]!.position).toEqual({ x: 0, y: 0 });
  });

  it('최대 50단계까지만 되돌린다', () => {
    let h = initHistory(emptyGraph());
    for (let i = 0; i < 60; i++)
      h = reducer(h, { type: 'addNode', nodeType: 'role', position: { x: 0, y: 0 } });
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    for (let i = 0; i < 60; i++) h = reducer(h, { type: 'undo' });
    expect(h.present.nodes).toHaveLength(10);
    expect(h.future).toHaveLength(50);
    h = reducer(h, { type: 'load', graph: emptyGraph() });
    expect(h.past).toEqual([]);
  });
});
