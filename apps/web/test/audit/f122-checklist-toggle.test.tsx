// @vitest-environment jsdom
// @features F-122
// T-102 B.23.F-122 기능 고정: 체크리스트 항목 줄(checklist.toggle)을 누르면 onToggle(항목 id), 펼친 항목은 자세히 보기가 보인다
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChecklistTree } from '../../src/panels/Checklist/ChecklistTree.js';
import { ITEMS } from '../checklist-fixtures.js';

afterEach(cleanup);

function Harness({ onToggle }: { onToggle: (id: string) => void }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  return (
    <ChecklistTree
      items={ITEMS}
      currentItemId={null}
      expanded={open}
      onToggle={(id) => {
        onToggle(id);
        setOpen((s) => {
          const n = new Set(s);
          if (n.has(id)) n.delete(id);
          else n.add(id);
          return n;
        });
      }}
    />
  );
}

describe('F-122 체크리스트 항목 펼치기 (현재 동작 고정)', () => {
  it('항목 줄 클릭 → onToggle(id), aria-expanded true→false로 바뀐다', () => {
    const onToggle = vi.fn();
    const { container } = render(<Harness onToggle={onToggle} />);
    const first = ITEMS[0]!;
    const row = container.querySelector<HTMLButtonElement>('[data-action="checklist.toggle"]')!;
    expect(row.getAttribute('aria-label')).toContain(first.id);
    const li = row.closest('[role="treeitem"]')!;
    expect(li.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(row);
    expect(onToggle).toHaveBeenCalledWith(first.id);
    expect(li.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(row);
    expect(onToggle).toHaveBeenCalledTimes(2);
    expect(li.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getAllByRole('treeitem').length).toBeGreaterThan(1);
  });
});
