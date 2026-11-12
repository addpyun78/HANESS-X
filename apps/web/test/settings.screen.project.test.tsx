// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyBrowserSetting } from '../src/design/ui-prefs.js';
import { ProjectsSection } from '../src/settings/sections/ProjectsSection.js';
import type { ProjectView } from '../src/shell/projects/api.js';
import { loadPrefs } from '../src/shell/projects/prefs.js';
import { keysIn, renderScreen } from './settings-screen-fixtures.js';

/**
 * T-101 6B.10 프로젝트 탭: 프로젝트 목록(0-2)·고정·목록에서 빼기(파일은 안 지움)·다시 연결·[프로젝트 설정](0B.41) 바로가기,
 * 임시 작업 공간 위치, 사이드바 묶기·정렬 방식 (사이드바와 같은 저장 이름)
 */

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const P = (over: Partial<ProjectView> & Pick<ProjectView, 'id' | 'name'>): ProjectView => ({
  rootPath: `C:\\work\\${over.id}`,
  createdAt: '2026-11-01T00:00:00.000Z',
  lastOpenedAt: '2026-11-01T00:00:00.000Z',
  pinned: false,
  order: 0,
  missing: false,
  ...over,
});

const PROJECTS = [
  P({ id: 'a', name: '임장 노트', order: 0 }),
  P({ id: 'b', name: '하네스', order: 1, pinned: true }),
  P({ id: 'c', name: '옛 프로젝트', order: 2, missing: true }),
];

async function setup() {
  const onAction = vi.fn();
  const r = await renderScreen({
    initialTab: 'project',
    sections: { project: <ProjectsSection projects={PROJECTS} onAction={onAction} /> },
    onBrowserChange: (f, v) => applyBrowserSetting(f.browserKey!, v),
    storage: window.localStorage,
  });
  const sec = await screen.findByRole('region', { name: '프로젝트' });
  const list = screen.getByRole('region', { name: '프로젝트 목록' });
  return { ...r, onAction, sec, list };
}

const row = (list: HTMLElement, id: string) => list.querySelector(`[data-project-id="${id}"]`) as HTMLElement;

describe('6B.10 프로젝트', () => {
  it('임시 작업 공간 위치·묶기·정렬 + 프로젝트 목록(고정 먼저, 폴더 없음 ⚠) (스냅샷)', async () => {
    const { m, sec, list } = await setup();
    expect(keysIn(sec)).toEqual(['project.scratchDir', 'sidebar.group', 'sidebar.sort']);
    expect(
      [...list.querySelectorAll('[data-project-id]')].map((e) => e.getAttribute('data-project-id')),
    ).toEqual(['b', 'a', 'c']);
    expect(within(row(list, 'c')).getByRole('status').textContent).toContain('폴더를 찾을 수 없어요');
    expect(within(row(list, 'a')).queryByRole('button', { name: '다시 연결' })).toBeNull();
    expect(list).toMatchSnapshot();
    m.dispose();
  });

  it('클릭 동작: 고정·고정 해제·다시 연결·프로젝트 설정, 목록에서 빼기는 확인 뒤에만', async () => {
    const { m, list, onAction } = await setup();
    fireEvent.click(within(row(list, 'a')).getByRole('button', { name: '고정' }));
    expect(onAction).toHaveBeenLastCalledWith(PROJECTS[0], { type: 'pin', pinned: true });
    fireEvent.click(within(row(list, 'b')).getByRole('button', { name: '고정 해제' }));
    expect(onAction).toHaveBeenLastCalledWith(PROJECTS[1], { type: 'pin', pinned: false });
    fireEvent.click(within(row(list, 'c')).getByRole('button', { name: '다시 연결' }));
    expect(onAction).toHaveBeenLastCalledWith(PROJECTS[2], { type: 'relink' });
    fireEvent.click(within(row(list, 'a')).getByRole('button', { name: '프로젝트 설정' }));
    expect(onAction).toHaveBeenLastCalledWith(PROJECTS[0], { type: 'settings' });
    onAction.mockClear();
    fireEvent.click(within(row(list, 'a')).getByRole('button', { name: '목록에서 빼기' }));
    expect(onAction).not.toHaveBeenCalled();
    const confirm = within(row(list, 'a')).getByRole('group', { name: '임장 노트 목록에서 빼기 확인' });
    expect(confirm.textContent).toContain('폴더와 파일은 지우지 않아요.');
    fireEvent.click(within(confirm).getByRole('button', { name: '그만두기' }));
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.click(within(row(list, 'a')).getByRole('button', { name: '목록에서 빼기' }));
    fireEvent.click(within(row(list, 'a')).getByRole('button', { name: '목록에서 빼기' }));
    expect(onAction).toHaveBeenCalledWith(PROJECTS[0], { type: 'remove' });
    m.dispose();
  });

  it('묶기·정렬을 바꾸면 사이드바가 읽는 값이 바뀌고 알림 이벤트가 간다', async () => {
    const { m, sec } = await setup();
    const heard: unknown[] = [];
    const on = (e: Event) => heard.push((e as CustomEvent).detail);
    window.addEventListener('hx-browser-setting', on);
    fireEvent.change(within(sec).getByLabelText('사이드바 묶기 방식'), { target: { value: 'status' } });
    fireEvent.change(within(sec).getByLabelText('사이드바 정렬 방식'), { target: { value: 'name' } });
    window.removeEventListener('hx-browser-setting', on);
    expect(loadPrefs()).toMatchObject({ group: 'status', sort: 'name' });
    expect(heard).toEqual([
      { key: 'hx-sidebar-group', value: 'status' },
      { key: 'hx-sidebar-sort', value: 'name' },
    ]);
    m.dispose();
  });
});
