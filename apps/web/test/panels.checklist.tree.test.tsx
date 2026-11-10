// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ChecklistPanel } from '../src/panels/Checklist/ChecklistPanel.js';
import { buildTree, currentItemId, progressOf } from '../src/panels/Checklist/model.js';
import { PANEL_TABS } from '../src/shell/layout-store.js';
import { RightPanel } from '../src/shell/RightPanel.js';
import { usePanels } from '../src/panels/usePanels.js';
import { ITEMS, view } from './checklist-fixtures.js';

afterEach(cleanup);

describe('36.1 트리 렌더', () => {
  it('parent 관계로 트리, 진행률·현재 항목은 서버 규칙과 같다', () => {
    const t = buildTree(ITEMS);
    expect(t.map((n) => n.item.id)).toEqual(['1', '2', '3']);
    expect(t[0]!.children.map((n) => n.item.id)).toEqual(['1.1']);
    expect(t[1]!.children[0]!.depth).toBe(1);
    expect(progressOf(ITEMS)).toEqual({ done: 2, total: 5, ratio: 0.4 });
    expect(currentItemId(ITEMS)).toBe('2');
    // 없는 parent는 최상위로
    expect(buildTree([{ ...ITEMS[1]!, parent: 'nope' }]).map((n) => n.item.id)).toEqual(['1.1']);
  });

  it('상태 아이콘·진행률 바·현재 항목 강조 (스냅샷)', () => {
    const { container } = render(<ChecklistPanel events={[]} initialView={view()} />);
    const bar = screen.getByRole('progressbar', { name: '체크리스트 진행률' });
    expect(bar.getAttribute('aria-valuenow')).toBe('2');
    expect(bar.getAttribute('aria-valuemax')).toBe('5');
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('40%');
    expect(screen.getByTestId('checklist-progress').textContent).toBe('2/5 완료 · 40%');

    const tree = screen.getByRole('tree', { name: '체크리스트 항목' });
    const rows = within(tree).getAllByRole('treeitem');
    expect(rows.map((r) => r.getAttribute('data-status'))).toEqual(['done', 'done', 'doing', 'todo', 'todo']);
    const current = rows.find((r) => r.getAttribute('aria-current') === 'step')!;
    expect(current.getAttribute('data-current')).toBe('true');
    expect(within(current).getByRole('button', { name: /^2 로그인 화면 구현/ })).toBeTruthy();
    expect(rows.filter((r) => r.getAttribute('aria-current')).length).toBe(1);
    expect(
      [...container.querySelectorAll('.hx-ck-icon')].map(
        (i) => `${i.getAttribute('data-status')}:${i.textContent}`,
      ),
    ).toEqual(['done:●', 'done:●', 'doing:◐', 'todo:○', 'todo:○']);
    expect(container.querySelector('.hx-ck')?.outerHTML).toMatchSnapshot();
  });

  it('우측 패널 체크리스트 탭에 붙는다 (빈 상태 안내)', () => {
    function Shell() {
      const p = usePanels({ events: [] });
      return <RightPanel order={PANEL_TABS.map((t) => t.id)} onOrderChange={() => {}} content={p.content} />;
    }
    render(<Shell />);
    expect(screen.getByRole('tabpanel').textContent).toContain('아직 체크리스트가 없습니다');
  });
});
