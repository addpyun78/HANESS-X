import { describe, expect, it } from 'vitest';
import {
  PipelineEdgeSchema,
  PipelineSchema,
  checkPipelineGraph,
  parsePipelineYaml,
  pipelineEntry,
  stringifyPipeline,
  type PipelineInput,
} from '../src/pipeline.js';

const role = (id: string) => ({ id, type: 'role' as const });
const errors = (p: PipelineInput) => {
  const r = PipelineSchema.safeParse(p);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe('40.3 엣지·조건 스키마', () => {
  it('엣지: when·onFail, 기본 onFail=false', () => {
    expect(PipelineEdgeSchema.parse({ from: 'a', to: 'b' })).toEqual({ from: 'a', to: 'b', onFail: false });
    expect(PipelineEdgeSchema.parse({ from: 'a', to: 'b', when: 'output.ok == true' }).when).toBe(
      'output.ok == true',
    );
    expect(PipelineEdgeSchema.safeParse({ from: 'a', to: 'b', when: '  ' }).success).toBe(false);
    expect(PipelineEdgeSchema.safeParse({ from: 'a', to: 'b', if: 'x' }).success).toBe(false);
  });

  it('직선 DAG 통과, 시작 노드 추론', () => {
    const p = PipelineSchema.parse({
      name: 'line',
      nodes: [role('a'), role('b'), role('c')],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ],
    });
    expect(pipelineEntry(p)).toBe('a');
  });

  it('잘못된 순환 거부 (loop 노드 없음)', () => {
    const errs = errors({
      name: 'bad',
      entry: 'a',
      nodes: [role('a'), role('b'), role('c')],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'b' },
      ],
    });
    expect(errs.some((e) => e.includes('잘못된 순환') && e.includes('b → c → b'))).toBe(true);
  });

  it('자기 순환 거부 (loop 제외)', () => {
    expect(
      errors({ name: 'self', nodes: [role('a')], edges: [{ from: 'a', to: 'a' }] }).some((e) =>
        e.includes('자기 순환'),
      ),
    ).toBe(true);
  });

  it('loop 노드를 지나는 순환은 허용', () => {
    const p: PipelineInput = {
      name: 'looped',
      nodes: [role('start'), { id: 'repeat', type: 'loop', maxIterations: 5 }, role('work'), role('done')],
      edges: [
        { from: 'start', to: 'repeat' },
        { from: 'repeat', to: 'work' },
        { from: 'work', to: 'repeat' },
        { from: 'repeat', to: 'done', when: 'loop.finished' },
      ],
    };
    expect(errors(p)).toEqual([]);
  });

  it('loop가 있어도 loop를 지나지 않는 순환은 거부', () => {
    const errs = errors({
      name: 'mixed',
      nodes: [{ id: 'l', type: 'loop' }, role('a'), role('b')],
      entry: 'l',
      edges: [
        { from: 'l', to: 'a' },
        { from: 'a', to: 'l' },
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
    });
    expect(errs.some((e) => e.includes('잘못된 순환'))).toBe(true);
  });

  it('onFail: gate에서 상류로만 허용', () => {
    const ok: PipelineInput = {
      name: 'gated',
      nodes: [role('build'), { id: 'check', type: 'gate' }, role('ship')],
      edges: [
        { from: 'build', to: 'check' },
        { from: 'check', to: 'ship' },
        { from: 'check', to: 'build', onFail: true },
      ],
    };
    expect(errors(ok)).toEqual([]);

    const fromRole = errors({
      name: 'x',
      nodes: [role('a'), role('b')],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a', onFail: true },
      ],
    });
    expect(fromRole.some((e) => e.includes('gate 노드에서만'))).toBe(true);

    const downstream = errors({
      name: 'x',
      nodes: [{ id: 'g', type: 'gate' }, role('b')],
      edges: [
        { from: 'g', to: 'b' },
        { from: 'g', to: 'b', onFail: true },
      ],
    });
    expect(downstream.some((e) => e.includes('상류 노드로만'))).toBe(true);

    const noFail = errors({
      name: 'x',
      nodes: [role('a'), { id: 'g', type: 'gate' }],
      edges: [{ from: 'a', to: 'g' }],
    });
    expect(noFail.some((e) => e.includes('onFail 엣지가 필요'))).toBe(true);
  });

  it('router: when 필수(default 제외), fanout/join 갈래 수', () => {
    const ok: PipelineInput = {
      name: 'routed',
      nodes: [
        { id: 'pick', type: 'router', default: 'b' },
        role('a'),
        role('b'),
        { id: 'fan', type: 'fanout' },
        role('c'),
        role('d'),
        { id: 'merge', type: 'join' },
      ],
      edges: [
        { from: 'pick', to: 'a', when: "input.kind == 'ui'" },
        { from: 'pick', to: 'b' },
        { from: 'a', to: 'fan' },
        { from: 'fan', to: 'c' },
        { from: 'fan', to: 'd' },
        { from: 'c', to: 'merge' },
        { from: 'd', to: 'merge' },
      ],
    };
    expect(errors(ok)).toEqual([]);

    const bad = checkPipelineGraph({
      nodes: [
        { id: 'r', type: 'router' },
        { id: 'a', type: 'role' },
        { id: 'f', type: 'fanout' },
        { id: 'j', type: 'join' },
      ],
      edges: [
        { from: 'r', to: 'a' },
        { from: 'a', to: 'f' },
        { from: 'f', to: 'j' },
      ],
    });
    expect(bad).toEqual(
      expect.arrayContaining([
        'router r → a: when 조건 필요',
        'fanout f: 나가는 엣지 2개 이상 필요',
        'join j: 들어오는 엣지 2개 이상 필요',
      ]),
    );
  });

  it('없는 노드·중복 id·없는 entry 거부', () => {
    const errs = errors({
      name: 'x',
      entry: 'zzz',
      nodes: [role('a'), role('a')],
      edges: [{ from: 'a', to: 'ghost' }],
    });
    expect(errs).toEqual(
      expect.arrayContaining([
        '노드 id 중복: a',
        'entry가 없는 노드를 가리킴: zzz',
        '엣지 a → ghost: 없는 노드 ghost',
      ]),
    );
  });

  it('YAML 왕복 동일', () => {
    const yaml = stringifyPipeline({
      name: 'rt',
      nodes: [role('a'), { id: 'g', type: 'gate', verifiers: ['tests'] }],
      edges: [
        { from: 'a', to: 'g' },
        { from: 'g', to: 'a', onFail: true },
      ],
    });
    const once = parsePipelineYaml(yaml);
    expect(parsePipelineYaml(stringifyPipeline(once))).toEqual(once);
  });
});
