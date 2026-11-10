import { eventFactory } from '@harness-x/kernel';
import type { HarnessEvent } from '@harness-x/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { PipelineRunner, extractNodeOutput, isNodeOutputTool, jsonBlocks } from '../src/index.js';
import { fakeEngine, pipeline, tmpWorkspace } from './runner-helpers.js';

const ev = eventFactory({ sessionId: 's', engineId: 'x' });
const text = (t: string) => ev({ type: 'assistant_text', text: t, partial: false });
const tool = (name: string, input: unknown) => ev({ type: 'tool_call', callId: 'c', tool: name, input });

const SCHEMA = {
  type: 'object',
  properties: { tasks: { type: 'array', items: { type: 'string' } }, acceptance: { type: 'array' } },
  required: ['tasks'],
};

describe('42.1 outputSchema 필드 결정적 추출', () => {
  it('경로 ①: node.output 도구 호출이 JSON 블록보다 우선', () => {
    const events: HarnessEvent[] = [
      tool('mcp__harness__node.output', { json: { acceptance: ['x'], tasks: ['도구'], extra: 1 } }),
      text('```json\n{"tasks":["블록"]}\n```'),
    ];
    const r = extractNodeOutput(events, SCHEMA);
    expect(r.source).toBe('tool');
    // 스키마 필드만, 선언 순서대로 (extra 제거)
    expect(r.value).toEqual({ tasks: ['도구'], acceptance: ['x'] });
    expect(Object.keys(r.value!)).toEqual(['tasks', 'acceptance']);
  });

  it('엔진별 도구 이름·JSON 문자열 입력도 인식, 여러 번이면 마지막 호출', () => {
    for (const n of ['node.output', 'harness.node.output', 'mcp__harness__node_output', 'node_output'])
      expect(isNodeOutputTool(n)).toBe(true);
    expect(isNodeOutputTool('checklist.submit')).toBe(false);
    expect(isNodeOutputTool('mynode.outputs')).toBe(false);
    const r = extractNodeOutput(
      [
        tool('harness.node.output', { json: { tasks: ['첫'] } }),
        tool('harness.node.output', { json: '{"tasks":["둘"]}' }),
      ],
      SCHEMA,
    );
    expect(r).toMatchObject({ source: 'tool', value: { tasks: ['둘'] } });
  });

  it('경로 ②: 도구가 없으면 마지막 assistant 텍스트의 마지막 JSON 블록', () => {
    const events = [
      text('```json\n{"tasks":["옛날"]}\n```'),
      text('초안 {"tasks":["중간"]} 그리고 최종:\n```json\n{"tasks":["최종"],"acceptance":[]}\n```\n끝'),
    ];
    const r = extractNodeOutput(events, SCHEMA);
    expect(r).toEqual({
      source: 'json_block',
      value: { tasks: ['최종'], acceptance: [] },
      raw: { tasks: ['최종'], acceptance: [] },
    });
    // 같은 입력 → 같은 결과 (결정적)
    expect(extractNodeOutput(events, SCHEMA)).toEqual(r);
  });

  it('펜스 없는 맨몸 JSON도 찾고, 없으면 none', () => {
    expect(jsonBlocks('결과: {"a": {"b": "}"}} 끝')).toEqual([{ a: { b: '}' } }]);
    expect(extractNodeOutput([text('그냥 글')], SCHEMA)).toEqual({ source: 'none', value: undefined });
  });

  describe('실행기 연동', () => {
    let ws: ReturnType<typeof tmpWorkspace>;
    afterEach(() => ws?.cleanup());

    it('두 경로로 추출한 값이 노드 출력이 된다', async () => {
      ws = tmpWorkspace();
      const engine = fakeEngine('fake', (o) =>
        o.env!.HARNESS_X_NODE === 'plan'
          ? {
              events: [
                {
                  type: 'tool_call',
                  callId: 't1',
                  tool: 'harness.node.output',
                  input: { json: { tasks: ['A'] } },
                },
              ],
              text: '제출함',
            }
          : { text: '완료\n```json\n{"changedFiles":["a.tsx"]}\n```' },
      );
      const p = pipeline({
        name: 'ab',
        nodes: [
          { id: 'plan', type: 'role', engine: 'fake', outputSchema: SCHEMA },
          {
            id: 'build',
            type: 'role',
            engine: 'fake',
            outputSchema: { type: 'object', properties: { changedFiles: { type: 'array' } } },
          },
        ],
        edges: [{ from: 'plan', to: 'build' }],
      });
      const r = await new PipelineRunner({ engines: { fake: engine }, workspace: ws.dir }).run(p, 'x');
      expect(r.status).toBe('completed');
      expect(r.outputs).toMatchObject({ plan: { tasks: ['A'] }, build: { changedFiles: ['a.tsx'] } });
    });
  });
});
