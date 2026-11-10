// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BuilderPage } from '../src/builder/BuilderPage.js';
import { DEFAULT_CATALOG } from '../src/builder/catalog.js';
import { emptyGraph, graphReducer } from '../src/builder/graph.js';
import { blockTransfer, mockReactFlowDom } from './flow-mock.js';

beforeAll(mockReactFlowDom);
afterEach(cleanup);

const canvas = () => document.querySelector('.hx-canvas') as HTMLElement;
const count = () => Number(canvas().getAttribute('data-node-count'));

describe('44.5 노드 블록 드래그 추가, Delete 제거', () => {
  it('reducer: 추가(16px 스냅·고유 id·선택) → 선택 삭제', () => {
    let g = graphReducer(emptyGraph(), { type: 'addNode', nodeType: 'role', position: { x: 23, y: 41 } });
    g = graphReducer(g, { type: 'addNode', nodeType: 'role', position: { x: 0, y: 0 } });
    expect(g.nodes.map((n) => n.id)).toEqual(['role', 'role-2']);
    expect(g.nodes[0]!.position).toEqual({ x: 16, y: 48 });
    expect(g.selection).toEqual(['role-2']);
    g = graphReducer(g, { type: 'removeSelected' });
    expect(g.nodes.map((n) => n.id)).toEqual(['role']);
    expect(g.selection).toEqual([]);
  });

  it('화면: 서랍 노드 블록을 캔버스에 놓으면 +1, Delete로 -1', () => {
    render(<BuilderPage route="/builder/new" catalog={DEFAULT_CATALOG} />);
    fireEvent.click(screen.getByText('빈 캔버스'));
    expect(count()).toBe(0);

    const dt = blockTransfer('node', 'role');
    fireEvent.dragOver(canvas(), { dataTransfer: dt });
    fireEvent.drop(canvas(), { dataTransfer: dt, clientX: 100, clientY: 80 });
    expect(count()).toBe(1);
    fireEvent.drop(canvas(), { dataTransfer: blockTransfer('node', 'gate'), clientX: 300, clientY: 80 });
    expect(count()).toBe(2);
    expect(document.querySelector('[data-node-type="gate"]')).toBeTruthy();

    // 입력창에서 누른 Delete는 무시
    fireEvent.keyDown(screen.getByLabelText('블록 검색'), { key: 'Delete' });
    expect(count()).toBe(2);
    // 방금 놓은 노드(gate)가 선택돼 있음 → Delete
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(count()).toBe(1);
    expect(document.querySelector('[data-node-type="gate"]')).toBeNull();
  });
});
