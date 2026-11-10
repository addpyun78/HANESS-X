// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BuilderPage } from '../src/builder/BuilderPage.js';
import { DEFAULT_CATALOG } from '../src/builder/catalog.js';
import { CHIP_MIME } from '../src/builder/lego/dnd.js';
import { blockTransfer, mockReactFlowDom } from './flow-mock.js';

beforeAll(mockReactFlowDom);
afterEach(cleanup);

const canvas = () => document.querySelector('.hx-canvas') as HTMLElement;
const node = (id: string) => document.querySelector(`.hx-node[data-node-id="${id}"]`) as HTMLElement;
const chips = (id: string) =>
  Array.from(node(id).querySelectorAll('.hx-skill-chip')).map((c) => c.getAttribute('data-skill'));
const count = () => Number(canvas().getAttribute('data-node-count'));

function start() {
  render(<BuilderPage route="/builder/new" catalog={DEFAULT_CATALOG} />);
  fireEvent.click(screen.getByText('빈 캔버스'));
  fireEvent.drop(canvas(), { dataTransfer: blockTransfer('node', 'role'), clientX: 50, clientY: 50 });
  fireEvent.drop(canvas(), { dataTransfer: blockTransfer('node', 'role'), clientX: 400, clientY: 50 });
}

const chipTransfer = (nodeId: string, skill: string) => {
  const data: Record<string, string> = { [CHIP_MIME]: JSON.stringify({ nodeId, skill }) };
  return { types: Object.keys(data), getData: (k: string) => data[k] ?? '', dropEffect: 'none' };
};

describe('레고 장착·분리 — 화면 상호작용', () => {
  it('45.1 스킬 블록을 노드 위로: 하이라이트 → 칩 장착', () => {
    start();
    const dt = blockTransfer('skill', 'a11y-check');
    fireEvent.dragOver(node('role'), { dataTransfer: dt });
    expect(node('role').getAttribute('data-highlight')).toBe('skill');
    fireEvent.drop(node('role'), { dataTransfer: dt });
    expect(node('role').getAttribute('data-highlight')).toBeNull();
    expect(chips('role')).toEqual(['a11y-check']);
    expect(count()).toBe(2); // 캔버스로 새지 않음
  });

  it('45.2 × 또는 칩을 바깥으로 끌어내면 분리, 다른 노드로 옮기기', () => {
    start();
    fireEvent.drop(node('role'), { dataTransfer: blockTransfer('skill', 'a11y-check') });
    fireEvent.drop(node('role'), { dataTransfer: blockTransfer('skill', 'code-review') });
    fireEvent.click(screen.getByLabelText('a11y-check 스킬 빼기'));
    expect(chips('role')).toEqual(['code-review']);

    // 다른 노드로 끌어 옮기기
    fireEvent.drop(node('role-2'), { dataTransfer: chipTransfer('role', 'code-review') });
    expect(chips('role')).toEqual([]);
    expect(chips('role-2')).toEqual(['code-review']);

    // 노드 밖(캔버스 빈 곳)으로 끌어내기
    fireEvent.drop(canvas(), { dataTransfer: chipTransfer('role-2', 'code-review') });
    expect(chips('role-2')).toEqual([]);

    // 받는 곳 없이 놓기(dragend dropEffect none)
    fireEvent.drop(node('role'), { dataTransfer: blockTransfer('skill', 'design-brief') });
    const chip = node('role').querySelector('.hx-skill-chip')!;
    fireEvent.dragEnd(chip, { dataTransfer: { dropEffect: 'none' } });
    expect(chips('role')).toEqual([]);
  });

  it('45.3 엔진 블록 드롭 → 엔진 칩(색 구분 data-engine)', () => {
    start();
    fireEvent.drop(node('role'), { dataTransfer: blockTransfer('engine', 'codex') });
    const chip = node('role').querySelector('.hx-engine-chip')!;
    expect(chip.getAttribute('data-engine')).toBe('codex');
    expect(node('role-2').querySelector('.hx-engine-chip')!.getAttribute('data-engine')).toBe('auto');
  });

  it('45.4 플러그인 블록 드롭 → 그룹(점선 틀)으로 펼침, × 로 통째 분리', () => {
    start();
    fireEvent.drop(canvas(), {
      dataTransfer: blockTransfer('plugin', 'design-qa'),
      clientX: 50,
      clientY: 300,
    });
    expect(count()).toBe(5);
    const group = document.querySelector('.hx-group[data-plugin="design-qa"]')!;
    expect(group.textContent).toContain('디자인 QA');
    expect(node('plan')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('디자인 QA 플러그인 떼어내기'));
    expect(count()).toBe(2);
    expect(document.querySelector('.hx-group')).toBeNull();
  });

  it('45.6 Ctrl+Z / Ctrl+Y', () => {
    start();
    fireEvent.drop(node('role'), { dataTransfer: blockTransfer('skill', 'a11y-check') });
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(chips('role')).toEqual([]);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(count()).toBe(1);
    fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'Z', ctrlKey: true, shiftKey: true });
    expect(count()).toBe(2);
    expect(chips('role')).toEqual(['a11y-check']);
    expect((screen.getByLabelText('다시 실행') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('실행 취소'));
    expect(chips('role')).toEqual([]);
  });
});
