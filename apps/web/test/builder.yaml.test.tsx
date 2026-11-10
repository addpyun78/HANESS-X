// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { parsePipelineYaml } from '@harness-x/protocol';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BuilderPage } from '../src/builder/BuilderPage.js';
import { DEFAULT_CATALOG } from '../src/builder/catalog.js';
import { graphFromPipeline } from '../src/builder/graph.js';
import { inspectorReducer } from '../src/builder/inspector/model.js';
import { graphFromYaml, graphToYaml, type PipelineMeta } from '../src/builder/inspector/yaml.js';
import { legoReducer } from '../src/builder/lego/model.js';
import { blockTransfer, mockReactFlowDom } from './flow-mock.js';

beforeAll(mockReactFlowDom);
afterEach(cleanup);

// jsdom 환경에서는 import.meta.url이 file:이 아니다 → 저장소 루트(테스트 cwd) 기준
const DESIGN_QA = readFileSync(join(process.cwd(), 'examples/agents/design-qa/pipeline.yaml'), 'utf8');

const strip = (g: ReturnType<typeof graphFromPipeline>) => ({
  nodes: g.nodes.map((n) => ({ id: n.id, spec: n.spec })),
  edges: g.edges,
});

describe('46.2 YAML 보기 — 왕복 변환 동일', () => {
  it('YAML → 그래프 → YAML: 글자 그대로 같다 (기본값을 채우지 않음)', () => {
    const first = graphFromYaml(DESIGN_QA);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const text = graphToYaml(first.graph, first.meta);
    const again = graphFromYaml(text, first.graph);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(graphToYaml(again.graph, again.meta)).toBe(text);
    // 의미도 같다: 원본 파일과 같은 파이프라인
    expect(parsePipelineYaml(text)).toEqual(parsePipelineYaml(DESIGN_QA));
  });

  it('그래프 → YAML → 그래프: 노드·엣지·위치·그룹이 그대로', () => {
    let g = graphFromPipeline(parsePipelineYaml(DESIGN_QA));
    g = legoReducer(g, { type: 'attachSkill', nodeId: 'build', skill: 'code-review' });
    g = legoReducer(g, {
      type: 'addPlugin',
      pluginId: 'review',
      label: '리뷰',
      pipeline: { name: 'review', nodes: [{ id: 'review', type: 'role' }] },
      position: { x: 0, y: 320 },
    });
    g = legoReducer(g, { type: 'connect', from: 'critic', to: 'review' });
    const meta: PipelineMeta = { name: 'design-qa', displayName: '디자인 QA' };
    const r = graphFromYaml(graphToYaml(g, meta), g);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(strip(r.graph)).toEqual(strip(g));
    expect(r.graph.nodes.map((n) => [n.id, n.position, n.groupId])).toEqual(
      g.nodes.map((n) => [n.id, n.position, n.groupId]),
    );
    expect(r.graph.groups).toEqual(g.groups);
    expect(r.meta).toEqual(meta);
  });

  it('잘못된 YAML·스키마 위반은 그래프를 바꾸지 않고 오류', () => {
    const g = graphFromPipeline(parsePipelineYaml(DESIGN_QA));
    expect(graphFromYaml('nodes: [', g)).toMatchObject({ ok: false });
    const bad = graphFromYaml('name: x\nnodes:\n  - id: a\n    type: nope\n', g);
    expect(bad.ok).toBe(false);
    expect(inspectorReducer(g, { type: 'loadYaml', text: 'nodes: [' })).toBe(g);
  });

  it('화면: YAML 편집 → 그래프에 적용 (노드 추가·엔진 변경)', () => {
    render(<BuilderPage route="/builder/new" catalog={DEFAULT_CATALOG} />);
    fireEvent.click(screen.getByText('빈 캔버스'));
    const canvas = document.querySelector('.hx-canvas') as HTMLElement;
    fireEvent.drop(canvas, { dataTransfer: blockTransfer('node', 'role'), clientX: 50, clientY: 50 });
    fireEvent.click(screen.getByRole('tab', { name: 'YAML 보기' }));
    const area = screen.getByLabelText('pipeline.yaml') as HTMLTextAreaElement;
    expect(area.value).toContain('id: role');
    const edited = area.value.replace('engine: auto', 'engine: codex');
    const withNode = edited
      .replace('edges: []', 'edges:\n  - from: role\n    to: check')
      .replace(/nodes:\n/, 'nodes:\n  - id: check\n    type: role\n    label: 검증\n');
    fireEvent.change(area, { target: { value: withNode } });
    fireEvent.click(screen.getByText('그래프에 적용'));
    expect(canvas.getAttribute('data-node-count')).toBe('2');
    const chip = document.querySelector('.hx-node[data-node-id="role"] .hx-engine-chip');
    expect(chip?.getAttribute('data-engine')).toBe('codex');
    // 그래프 → YAML 자동 갱신: 적용 뒤 텍스트가 그래프 직렬화와 같다
    expect((screen.getByLabelText('pipeline.yaml') as HTMLTextAreaElement).value).toBe(withNode);

    // 오류는 표시만, 그래프는 그대로
    fireEvent.change(area, { target: { value: 'name: x\nnodes: []\n' } });
    fireEvent.click(screen.getByText('그래프에 적용'));
    expect(screen.getByRole('alert').textContent).toBeTruthy();
    expect(canvas.getAttribute('data-node-count')).toBe('2');
  });
});
