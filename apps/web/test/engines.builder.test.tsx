// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { HarnessApiClient } from '../src/api/client.js';
import { aiChoiceMode, engineChipLabel, MAIN_REF, setAiChoiceMode } from '../src/builder/ai-choice.js';
import { BuilderPage } from '../src/builder/BuilderPage.js';
import { DEFAULT_CATALOG, loadCatalog } from '../src/builder/catalog.js';
import { Drawer } from '../src/builder/Drawer.js';
import { graphFromPipeline, type BuilderGraph } from '../src/builder/graph.js';
import { AiChoiceField } from '../src/builder/inspector/AiChoiceField.js';
import { graphFromYaml, graphToYaml } from '../src/builder/inspector/yaml.js';
import { engineBlocksFromModels, groupModels } from '../src/engines/model.js';
import { MODELS } from './engines-fixtures.js';
import { blockTransfer, mockReactFlowDom } from './flow-mock.js';

beforeAll(mockReactFlowDom);
afterEach(cleanup);

const fakeClient = (paths: string[] = []) =>
  ({
    agents: async () => ({ agents: [] }),
    plugins: async () => ({ plugins: [], rejected: [] }),
    request: async (path: string) => {
      paths.push(path);
      if (path === '/api/models') return { models: MODELS, scannedAt: '2026-11-12T00:00:00.000Z' };
      if (path === '/api/main-ai') return { main: { engine: 'claude-code', model: 'sonnet' } };
      throw new Error(path);
    },
  }) as unknown as HarnessApiClient;

const pipeline = () =>
  graphFromPipeline({
    name: 'three',
    nodes: [
      { id: 'plan', type: 'role', engine: 'main' },
      { id: 'build', type: 'role', engine: 'main' },
    ],
    edges: [{ from: 'plan', to: 'build' }],
  });

describe('T-101 5D 에이전트 만들기 연결', () => {
  it('5D.1 빌더 서랍 "엔진" 탭 = 입력창 모델 목록(/api/models)과 같은 데이터, 배지 포함', async () => {
    const paths: string[] = [];
    const catalog = await loadCatalog(fakeClient(paths));
    expect(paths).toContain('/api/models');
    expect(catalog.engines).toEqual(engineBlocksFromModels(MODELS));
    expect(catalog.mainEngine).toBe('claude-code');
    // 입력창 버튼의 엔진 묶음과 같은 엔진들 (+ 맨 앞 "메인 AI 따라가기")
    expect(catalog.engines.slice(1).map((e) => e.id)).toEqual(groupModels(MODELS).map((g) => g.engineId));
    render(<Drawer catalog={catalog} initialTab="engine" />);
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByText('메인 AI 따라가기')).toBeTruthy();
    expect(within(panel).getByText('[구독] · 모델 2개')).toBeTruthy();
    expect(within(panel).getByText('[구독] · 모델 1개 · 로그인 필요')).toBeTruthy();
    expect(within(panel).getByText('[무료 로컬] · 모델 1개')).toBeTruthy();
  });

  it('5D.2 "AI 고르는 방식": 메인 AI 따라가기(기본) / 노드마다 직접 고르기 — 두 방식 저장', () => {
    let g: BuilderGraph = pipeline();
    expect(aiChoiceMode(g)).toBe('follow-main');
    const dispatched: unknown[] = [];
    const { rerender } = render(
      <AiChoiceField graph={g} mainEngine="claude-code" dispatch={(a) => dispatched.push(a)} />,
    );
    const group = screen.getByRole('radiogroup', { name: 'AI 고르는 방식' });
    expect((within(group).getByLabelText('메인 AI 따라가기') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(group).getByLabelText('노드마다 직접 고르기'));
    expect(dispatched).toEqual([
      { type: 'setEngine', nodeId: 'plan', engine: 'claude-code' },
      { type: 'setEngine', nodeId: 'build', engine: 'claude-code' },
    ]);
    g = setAiChoiceMode(g, 'per-node', 'claude-code');
    expect(aiChoiceMode(g)).toBe('per-node');
    expect(graphToYaml(g, { name: 'three' })).toMatch(/engine: claude-code/);
    rerender(<AiChoiceField graph={g} mainEngine="claude-code" dispatch={(a) => dispatched.push(a)} />);
    expect((within(group).getByLabelText('노드마다 직접 고르기') as HTMLInputElement).checked).toBe(true);
    // 다시 따라가기 → 모든 노드 engine: main
    g = setAiChoiceMode(g, 'follow-main', 'claude-code');
    expect(
      g.nodes.filter((n) => n.spec.type === 'role').map((n) => (n.spec as { engine?: string }).engine),
    ).toEqual([MAIN_REF, MAIN_REF]);
  });

  it('5D.3 노드 엔진 칩: 따라가기면 메인(claude-code), 직접이면 고정 이름', () => {
    expect(engineChipLabel('main', 'claude-code')).toBe('메인(claude-code)');
    expect(engineChipLabel('auto', 'codex')).toBe('메인(codex)');
    expect(engineChipLabel(undefined, undefined)).toBe('메인');
    expect(engineChipLabel('antigravity', 'claude-code')).toBe('antigravity');

    // 캔버스 노드 칩 (메인 AI = claude-code)
    render(
      <BuilderPage
        route="/builder/new"
        catalog={{ ...DEFAULT_CATALOG, engines: engineBlocksFromModels(MODELS), mainEngine: 'claude-code' }}
      />,
    );
    fireEvent.click(screen.getByText('빈 캔버스'));
    const canvas = document.querySelector('.hx-canvas') as HTMLElement;
    fireEvent.drop(canvas, { dataTransfer: blockTransfer('node', 'role'), clientX: 50, clientY: 50 });
    fireEvent.drop(canvas, { dataTransfer: blockTransfer('node', 'role'), clientX: 400, clientY: 50 });
    const node = (id: string) => document.querySelector(`.hx-node[data-node-id="${id}"]`) as HTMLElement;
    fireEvent.drop(node('role'), { dataTransfer: blockTransfer('engine', 'main') });
    fireEvent.drop(node('role-2'), { dataTransfer: blockTransfer('engine', 'antigravity') });
    const chip = (id: string) => node(id).querySelector('.hx-engine-chip')!;
    expect(chip('role').textContent).toBe('메인(claude-code)');
    expect(chip('role-2').textContent).toBe('antigravity');
    expect([chip('role').outerHTML, chip('role-2').outerHTML]).toMatchSnapshot();
  });

  it('5D.4 YAML: engine: main 또는 구체 id — 왕복 변환이 글자 하나 다르지 않다', () => {
    for (const g of [pipeline(), setAiChoiceMode(pipeline(), 'per-node', 'codex')]) {
      const yaml = graphToYaml(g, { name: 'three' });
      const back = graphFromYaml(yaml, g);
      expect(back.ok ? [] : back.errors).toEqual([]);
      if (!back.ok) return;
      expect(graphToYaml(back.graph, back.meta)).toBe(yaml);
      expect(aiChoiceMode(back.graph)).toBe(aiChoiceMode(g));
    }
    expect(graphToYaml(pipeline(), { name: 'three' })).toMatch(/engine: main/);
  });
});
