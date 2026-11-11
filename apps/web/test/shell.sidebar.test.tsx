// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from '../src/shell/Sidebar.js';
import type { SessionSummary } from '../src/shell/types.js';

afterEach(cleanup);

const s = (
  id: string,
  project: string,
  status: SessionSummary['status'],
  engineId = 'claude-code',
): SessionSummary => ({
  id,
  title: `세션 ${id}`,
  project,
  status,
  engineId,
  updatedAt: '2026-11-10T00:00:00Z',
});

describe('좌측 사이드바', () => {
  it('새 세션, 세션 목록, 하단 메뉴 6개 (스냅샷)', () => {
    const onNew = vi.fn();
    const onNav = vi.fn();
    const onSel = vi.fn();
    const { container } = render(
      <Sidebar
        groups={[
          {
            project: 'harness-x',
            sessions: [s('1', 'harness-x', 'running'), s('2', 'harness-x', 'done', 'codex')],
          },
          { project: 'blog', sessions: [s('3', 'blog', 'blocked')] },
        ]}
        activeSessionId="1"
        onNewSession={onNew}
        onNavigate={onNav}
        onSelectSession={onSel}
      />,
    );
    const menu = screen.getAllByRole('menuitem').map((b) => b.textContent);
    expect(menu).toEqual(['✦에이전트 만들기', '⧉플러그인', '◇스킬', '⬇설치 관리', '⚙엔진', '☰설정']);
    fireEvent.click(screen.getByText('+ 새 세션'));
    expect(onNew).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText('플러그인'));
    expect(onNav).toHaveBeenCalledWith('plugins');
    fireEvent.click(screen.getByText('세션 3'));
    expect(onSel).toHaveBeenCalledWith('3');
    expect(screen.getByText('세션 1').closest('button')?.getAttribute('aria-current')).toBe('true');
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('세션이 없을 때', () => {
    const { container } = render(<Sidebar groups={[]} />);
    expect(screen.getByText('세션이 없습니다')).toBeTruthy();
    expect(container.innerHTML).toMatchSnapshot();
  });
});
