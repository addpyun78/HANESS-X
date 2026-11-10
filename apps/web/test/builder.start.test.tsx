// @vitest-environment jsdom
import { parsePipeline } from '@harness-x/protocol';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BuilderPage } from '../src/builder/BuilderPage.js';
import { DEFAULT_CATALOG } from '../src/builder/catalog.js';
import { startGraph } from '../src/builder/start.js';
import { mockReactFlowDom } from './flow-mock.js';

beforeAll(mockReactFlowDom);
afterEach(cleanup);

const count = () => Number(document.querySelector('.hx-canvas')?.getAttribute('data-node-count'));

describe('44.2 시작 선택 3경로', () => {
  it('기본 카탈로그 파이프라인은 스키마 통과', () => {
    for (const p of DEFAULT_CATALOG.plugins) expect(() => parsePipeline(p.pipeline)).not.toThrow();
  });

  it('startGraph: 빈 캔버스 / 플러그인 / 복제', () => {
    const empty = startGraph({ kind: 'empty' }, DEFAULT_CATALOG);
    expect(empty.graph.nodes).toHaveLength(0);

    const plugin = startGraph({ kind: 'plugin', pluginId: 'code-review' }, DEFAULT_CATALOG);
    expect(plugin.graph.nodes.map((n) => n.id)).toEqual(['review', 'verify']);
    expect(plugin.graph.edges).toHaveLength(2);
    expect(plugin.name).toBe('code-review');

    const clone = startGraph({ kind: 'clone', agentId: 'design-qa' }, DEFAULT_CATALOG);
    expect(clone.graph.nodes.map((n) => n.id)).toEqual(['plan', 'build', 'critic']);
    expect(clone.name).toBe('design-qa-copy');
    // 복제는 원본을 건드리지 않는다
    clone.graph.nodes[0]!.spec.label = '바뀜';
    expect(DEFAULT_CATALOG.agents[0]!.pipeline!.nodes[0]!.label).toBe('계획');

    expect(() => startGraph({ kind: 'plugin', pluginId: 'nope' }, DEFAULT_CATALOG)).toThrow();
  });

  it('화면: 빈 캔버스', () => {
    render(<BuilderPage route="/builder/new" catalog={DEFAULT_CATALOG} />);
    fireEvent.click(screen.getByText('빈 캔버스'));
    expect(count()).toBe(0);
    expect(screen.getByText('왼쪽 서랍에서 노드 블록을 끌어다 놓으세요')).toBeTruthy();
  });

  it('화면: 플러그인에서 시작', () => {
    render(<BuilderPage route="/builder/new" catalog={DEFAULT_CATALOG} />);
    fireEvent.click(screen.getByText('플러그인에서 시작'));
    const list = screen.getByRole('list', { name: '플러그인 목록' });
    fireEvent.click(list.querySelector('button')!);
    expect(count()).toBe(3);
    expect(screen.getByText('플러그인 디자인 QA')).toBeTruthy();
  });

  it('화면: 기존 에이전트 복제 (파이프라인 없는 에이전트는 비활성)', () => {
    const catalog = {
      ...DEFAULT_CATALOG,
      agents: [...DEFAULT_CATALOG.agents, { id: 'remote', label: '원격', nodeCount: 2 }],
    };
    render(<BuilderPage route="/builder/new" catalog={catalog} />);
    fireEvent.click(screen.getByText('기존 에이전트 복제'));
    const buttons = screen.getByRole('list', { name: '에이전트 목록' }).querySelectorAll('button');
    expect(buttons[1]!.disabled).toBe(true);
    fireEvent.click(buttons[0]!);
    expect(count()).toBe(3);
    expect(screen.getByText('디자인 QA 복제')).toBeTruthy();
  });
});
