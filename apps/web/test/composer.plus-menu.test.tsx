// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderComposer } from './composer.helpers.js';

afterEach(cleanup);

const RECENT = [
  { name: 'harness-x', path: 'C:\\agentCli\\harness-x', branch: 'main', pinned: true },
  { name: 'app', path: 'C:\\work\\app' },
];

describe('+ 메뉴 (T-034)', () => {
  it('34.1 + 클릭 → 메뉴 3개: 프로젝트 폴더 열기…, 최근 프로젝트, 파일 첨부 (스냅샷)', () => {
    const onOpenFolder = vi.fn();
    const { container, onPlus } = renderComposer({ plusMenu: { recent: RECENT, onOpenFolder } });
    const plus = screen.getByLabelText('추가');
    expect(plus.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(plus);
    expect(onPlus).toHaveBeenCalledOnce();
    expect(plus.getAttribute('aria-expanded')).toBe('true');
    const menu = screen.getByRole('menu', { name: '추가 메뉴' });
    const items = [...menu.querySelectorAll(':scope > [role="menuitem"]')].map((e) => e.textContent?.trim());
    expect(items).toEqual(['📁프로젝트 폴더 열기…', '🕘최근 프로젝트', '📎파일 첨부']);
    expect(container.innerHTML).toMatchSnapshot();

    fireEvent.click(screen.getByRole('menuitem', { name: /프로젝트 폴더 열기/ }));
    expect(onOpenFolder).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull(); // 고르면 닫힘
  });

  it('최근 프로젝트 펼침 → 고르면 onPickRecent', () => {
    const onPickRecent = vi.fn();
    renderComposer({ plusMenu: { recent: RECENT, onPickRecent } });
    fireEvent.click(screen.getByLabelText('추가'));
    expect(screen.queryByRole('group', { name: '최근 프로젝트 목록' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: /최근 프로젝트/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^★?app/ }));
    expect(onPickRecent).toHaveBeenCalledWith(RECENT[1]);
  });

  it('파일 첨부 → 파일 선택 창 → attach 이벤트(source=picker)', () => {
    const { onAttach } = renderComposer({ plusMenu: { recent: [] } });
    const input = screen.getByTestId('attach-input') as HTMLInputElement;
    const click = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByLabelText('추가'));
    fireEvent.click(screen.getByRole('menuitem', { name: /파일 첨부/ }));
    expect(click).toHaveBeenCalledOnce();
    const file = new File(['x'], 'a.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onAttach).toHaveBeenCalledWith({
      type: 'attach',
      attachments: [expect.objectContaining({ name: 'a.txt', source: 'picker' })],
    });
  });

  it('Esc로 닫힘, plusMenu가 없으면 메뉴 없음(기존 동작)', () => {
    renderComposer({ plusMenu: { recent: [] } });
    fireEvent.click(screen.getByLabelText('추가'));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    cleanup();
    renderComposer();
    fireEvent.click(screen.getByLabelText('추가'));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
