import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePipelineYaml, type PipelineNode } from '@harness-x/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PipelineContractError,
  PipelineRunner,
  checkConnection,
  checkPipelineContracts,
} from '../src/index.js';
import { DESIGN_QA_DIR } from './fixtures.js';
import { fakeEngine, pipeline, tmpWorkspace, type FakeCall } from './runner-helpers.js';

let ws: ReturnType<typeof tmpWorkspace>;
afterEach(() => ws?.cleanup());

const role = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'role' as const,
  engine: 'fake',
  ...extra,
});
const OUT_TASKS = {
  outputSchema: { type: 'object', properties: { tasks: { type: 'array' } }, required: ['tasks'] },
};
const IN_FILES = {
  inputSchema: {
    type: 'object',
    properties: { changedFiles: { type: 'array' } },
    required: ['changedFiles'],
  },
};

describe('42.4 노드 연결 시 스키마 호환성 정적 검사', () => {
  it('design-qa 예제는 호환', () => {
    const p = parsePipelineYaml(readFileSync(join(DESIGN_QA_DIR, 'pipeline.yaml'), 'utf8'));
    expect(checkPipelineContracts(p)).toEqual([]);
  });

  it('비호환 연결: 실행 전에 PipelineContractError, 엔진은 한 번도 불리지 않는다', async () => {
    ws = tmpWorkspace();
    const calls: FakeCall[] = [];
    const p = pipeline({
      name: 'bad',
      nodes: [role('plan', OUT_TASKS), role('critic', IN_FILES)],
      edges: [{ from: 'plan', to: 'critic' }],
    });
    const runner = new PipelineRunner({
      engines: { fake: fakeEngine('fake', () => ({ text: 'x' }), calls) },
      workspace: ws.dir,
    });
    const err = await runner.run(p, 'x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PipelineContractError);
    const ce = err as PipelineContractError;
    expect(ce.issues).toEqual([
      expect.objectContaining({
        from: 'plan',
        to: 'critic',
        message: expect.stringContaining('changedFiles'),
      }),
    ]);
    expect(ce.message).toContain('plan → critic');
    expect(calls).toHaveLength(0);
  });

  it('타입·enum 불일치도 잡는다 (checkConnection, 빌더 연결선용)', () => {
    const a = role('a', {
      outputSchema: { type: 'object', properties: { verdict: { type: 'string' } }, required: ['verdict'] },
    }) as PipelineNode;
    const b = role('b', {
      inputSchema: {
        type: 'object',
        properties: { verdict: { type: 'string', enum: ['pass', 'fail'] } },
        required: ['verdict'],
      },
    }) as PipelineNode;
    expect(checkConnection(a, b)?.issues[0]).toMatchObject({ path: 'verdict' });
    expect(checkConnection(b, a)).toBeUndefined();
  });

  it('gate 등 통과 노드는 건너 상류 생산 노드와 비교, join은 갈래 출력을 합쳐 본다', () => {
    const viaGate = pipeline({
      name: 'via-gate',
      nodes: [role('plan', OUT_TASKS), { id: 'check', type: 'gate' }, role('critic', IN_FILES)],
      edges: [
        { from: 'plan', to: 'check' },
        { from: 'check', to: 'plan', onFail: true },
        { from: 'check', to: 'critic' },
      ],
    });
    expect(checkPipelineContracts(viaGate).map((i) => `${i.from}>${i.to}`)).toEqual(['plan>critic']);

    const files = {
      outputSchema: {
        type: 'object',
        properties: { changedFiles: { type: 'array' } },
        required: ['changedFiles'],
      },
    };
    const joined = (b: Record<string, unknown>) =>
      pipeline({
        name: 'joined',
        nodes: [
          { id: 'split', type: 'fanout' },
          role('a', OUT_TASKS),
          role('b', b),
          { id: 'merge', type: 'join' },
          role('critic', {
            inputSchema: {
              type: 'object',
              properties: { tasks: { type: 'array' }, changedFiles: { type: 'array' } },
              required: ['tasks', 'changedFiles'],
            },
          }),
        ],
        edges: [
          { from: 'split', to: 'a' },
          { from: 'split', to: 'b' },
          { from: 'a', to: 'merge' },
          { from: 'b', to: 'merge' },
          { from: 'merge', to: 'critic' },
        ],
      });
    expect(checkPipelineContracts(joined(files))).toEqual([]);
    expect(checkPipelineContracts(joined(OUT_TASKS))[0]).toMatchObject({
      from: 'a+b',
      to: 'critic',
      message: expect.stringContaining('changedFiles'),
    });
  });
});
