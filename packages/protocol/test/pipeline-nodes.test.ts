import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  NODE_TYPES,
  NodeTypeSchema,
  PipelineNodeSchema,
  type NodeOfType,
  type NodeType,
  type PipelineNode,
} from '../src/pipeline.js';

describe('40.1 노드 타입', () => {
  it('노드 타입 6종 + subagent', () => {
    expectTypeOf<NodeType>().toEqualTypeOf<
      'role' | 'gate' | 'fanout' | 'join' | 'loop' | 'router' | 'subagent'
    >();
    expectTypeOf<PipelineNode['type']>().toEqualTypeOf<NodeType>();
    expectTypeOf<NodeOfType<'loop'>>().toHaveProperty('maxIterations').toEqualTypeOf<number>();
    expectTypeOf<NodeOfType<'subagent'>>().toHaveProperty('agent').toEqualTypeOf<string>();
    expect(NODE_TYPES).toHaveLength(7);
  });

  it('타입별 최소 노드 통과', () => {
    const samples = [
      { id: 'a', type: 'role' },
      { id: 'b', type: 'gate' },
      { id: 'c', type: 'fanout' },
      { id: 'd', type: 'join' },
      { id: 'e', type: 'loop' },
      { id: 'f', type: 'router' },
      { id: 'g', type: 'subagent', agent: '/design-qa' },
    ];
    for (const s of samples) expect(PipelineNodeSchema.parse(s).type).toBe(s.type);
  });

  it('타입별 기본값', () => {
    expect(PipelineNodeSchema.parse({ id: 'l', type: 'loop' })).toMatchObject({
      maxIterations: 3,
      stallLimit: 2,
    });
    expect(PipelineNodeSchema.parse({ id: 'f', type: 'fanout' })).toMatchObject({ maxConcurrency: 3 });
    expect(PipelineNodeSchema.parse({ id: 'j', type: 'join' })).toMatchObject({ wait: 'all' });
  });

  it('모르는 타입·잘못된 id·모르는 필드 거부', () => {
    expect(NodeTypeSchema.safeParse('widget').success).toBe(false);
    expect(PipelineNodeSchema.safeParse({ id: 'x', type: 'widget' }).success).toBe(false);
    expect(PipelineNodeSchema.safeParse({ id: 'Bad_Id', type: 'role' }).success).toBe(false);
    expect(PipelineNodeSchema.safeParse({ id: 'x', type: 'join', foo: 1 }).success).toBe(false);
    expect(PipelineNodeSchema.safeParse({ id: 'x', type: 'subagent' }).success).toBe(false);
    expect(PipelineNodeSchema.safeParse({ id: 'x', type: 'fanout', maxConcurrency: 4 }).success).toBe(false);
  });
});
