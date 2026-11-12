import { describe, expect, it } from 'vitest';
import { StageSchema, StageTreeSchema, parseStageTree } from '../src/index.js';

const item = (id: string) => ({
  id,
  title: `${id} 만들기`,
  artifactId: 'art.app',
  acceptance: [{ type: 'command', run: 'true' }],
});
const ts = '2026-11-12T00:00:00.000Z';
const tree = (stages: unknown[]) => ({
  schemaVersion: 1,
  sessionId: 's1',
  agent: 'trio',
  pipeline: 'trio',
  createdAt: ts,
  updatedAt: ts,
  stages,
});

describe('4A.2 단계 트리 스키마', () => {
  it('루트 → 단계 {stageId,nodeId,title,status,exitCriteria,summary?,iteration?} → 하위 항목(기존 스키마)', () => {
    const t = parseStageTree(
      tree([
        {
          stageId: 'plan',
          nodeId: 'plan',
          title: 'plan',
          kind: 'role',
          status: 'done',
          summary: '화면 3개를 고치기로 했어요',
          items: [item('1')],
        },
        {
          stageId: 'build',
          nodeId: 'build',
          title: 'build',
          kind: 'role',
          status: 'running',
          items: [item('1'), item('2')],
        },
        {
          stageId: 'review',
          nodeId: 'review',
          title: 'review',
          kind: 'loop',
          children: [{ stageId: 'review.1', nodeId: null, title: '반복 1', kind: 'iteration', iteration: 1 }],
        },
      ]),
    );
    expect(t.stages).toHaveLength(3);
    expect(t.stages[0]).toMatchObject({ status: 'done', summary: '화면 3개를 고치기로 했어요' });
    expect(t.stages[1]!.items[0]).toMatchObject({ status: 'todo', attempts: 0, parent: null });
    expect(t.stages[2]!.status).toBe('expected');
    expect(t.stages[2]!.exitCriteria).toEqual({ acceptance: [] });
    expect(t.stages[2]!.children[0]!.iteration).toBe(1);
  });

  it('하위 항목은 기존 항목 스키마로 검사한다 (acceptance 없으면 실패)', () => {
    const bad = { ...item('1'), acceptance: [] };
    expect(
      StageSchema.safeParse({ stageId: 'a', nodeId: 'a', title: 'a', kind: 'role', items: [bad] }).success,
    ).toBe(false);
  });

  it('잘못된 상태·단계 id·중복 단계·중복 항목·빈 루트는 거부', () => {
    const s = (o: object) => ({ stageId: 'a', nodeId: 'a', title: 'a', kind: 'role', ...o });
    expect(StageSchema.safeParse(s({ status: 'waiting' })).success).toBe(false);
    expect(StageSchema.safeParse(s({ stageId: 'Bad_Id' })).success).toBe(false);
    expect(StageSchema.safeParse(s({ items: [item('1'), item('1')] })).success).toBe(false);
    expect(StageSchema.safeParse(s({ itemMeta: { x: { origin: 'rework' } } })).success).toBe(false);
    expect(StageTreeSchema.safeParse(tree([s({}), s({})])).success).toBe(false);
    expect(StageTreeSchema.safeParse(tree([])).success).toBe(false);
  });

  it('하위 에이전트 중첩은 3단계까지', () => {
    const sub = (id: string, children: unknown[] = []) => ({
      stageId: id,
      nodeId: 'sub',
      title: id,
      kind: 'subagent',
      children,
    });
    expect(StageTreeSchema.safeParse(tree([sub('a', [sub('a.b', [sub('a.b.c')])])])).success).toBe(true);
    expect(
      StageTreeSchema.safeParse(tree([sub('a', [sub('a.b', [sub('a.b.c', [sub('a.b.c.d')])])])])).success,
    ).toBe(false);
  });
});
