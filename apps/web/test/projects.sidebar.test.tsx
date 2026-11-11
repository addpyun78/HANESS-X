// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectView, SessionRecordView } from '../src/shell/projects/api.js';
import { archiveSuggestions, groupSessions } from '../src/shell/projects/model.js';
import { ProjectSidebar, type ProjectSidebarProps } from '../src/shell/projects/ProjectSidebar.js';
import { DEFAULT_PREFS, type SidebarPrefs } from '../src/shell/projects/prefs.js';

afterEach(cleanup);

const NOW = new Date('2026-11-12T12:00:00.000Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();

export const proj = (id: string, name: string, extra: Partial<ProjectView> = {}): ProjectView => ({
  id,
  name,
  rootPath: `/mnt/c/work/${name}`,
  createdAt: ago(10_000),
  lastOpenedAt: ago(5_000),
  pinned: false,
  order: 0,
  missing: false,
  ...extra,
});

export const sess = (
  id: string,
  projectId: string | null,
  extra: Partial<SessionRecordView> = {},
): SessionRecordView => ({
  id,
  projectId,
  title: `세션 ${id}`,
  titleLocked: false,
  status: 'idle',
  cwd: '/mnt/c/work',
  origin: 'ui',
  draft: false,
  messageCount: 1,
  archived: false,
  createdAt: ago(100),
  updatedAt: ago(10),
  lastActivityAt: ago(10),
  engine: 'claude-code',
  permission: 'workspace-write',
  ...extra,
});

/** 설계 그림의 예시 그대로 */
const PROJECTS = [
  proj('p1', 'imjang-note', { pinned: true, branch: 'main', order: 0 }),
  proj('p2', 'harness-x', { branch: 'main', order: 1 }),
  proj('p3', 'a2a', { missing: true, order: 2 }),
];
const SESSIONS = [
  sess('s1', 'p1', {
    title: 'design-qa',
    status: 'running',
    mode: 'auto',
    agent: 'design-qa',
    agentIcon: '🎨',
    lastActivityAt: ago(2),
  }),
  sess('s2', 'p1', { title: 'API 리팩터', status: 'needs-approval', lastActivityAt: ago(30) }),
  sess('s3', 'p1', { title: '로고 수정', status: 'paused', lastActivityAt: ago(60 * 5) }),
  ...Array.from({ length: 12 }, (_, i) =>
    sess(`d${i}`, 'p1', { title: `끝난 일 ${i}`, status: 'done', lastActivityAt: ago(60 * 24 * 2 + i) }),
  ),
  sess('s4', 'p2', { title: '하네스 작업', status: 'idle', lastActivityAt: ago(60 * 24 * 3) }),
];

function memPrefs(init: Partial<SidebarPrefs> = {}) {
  let v: SidebarPrefs = { ...DEFAULT_PREFS, ...init };
  return { load: () => v, save: (p: SidebarPrefs) => void (v = p), get: () => v };
}

function setup(over: Partial<ProjectSidebarProps> = {}) {
  const props: ProjectSidebarProps = {
    projects: PROJECTS,
    sessions: SESSIONS,
    currentProjectId: 'p1',
    activeSessionId: 's1',
    onNewSession: vi.fn(),
    onNewSessionIn: vi.fn(),
    onOpenFolder: vi.fn(),
    onSelectProject: vi.fn(),
    onSelectSession: vi.fn(),
    onProjectAction: vi.fn(),
    onSessionAction: vi.fn(),
    onReorder: vi.fn(),
    onArchiveMany: vi.fn(),
    onNavigate: vi.fn(),
    now: NOW,
    prefs: memPrefs(),
    ...over,
  };
  const r = render(<ProjectSidebar {...props} />);
  return { ...r, props };
}

const group = (name: string) =>
  screen.getByRole('button', { name: new RegExp(`^(고정됨\\s*)?${name}$`) }).closest('li') as HTMLElement;

describe('0B.22 사이드바 구조', () => {
  it('[+ 새 세션 │▾] / 찾기 / 프로젝트 머리글 + [폴더 열기] / 프로젝트 묶음 / 묶기·필터 / 하단 메뉴 (스냅샷)', () => {
    const { container } = setup();
    const nav = screen.getByRole('navigation', { name: '사이드바' });
    const order = [
      nav.querySelector('.hx-newsession'),
      nav.querySelector('.hx-psidebar__search'),
      nav.querySelector('.hx-psidebar__head'),
      nav.querySelector('.hx-psidebar__groups'),
      nav.querySelector('.hx-psidebar__controls'),
      nav.querySelector('.hx-sidebar__nav'),
    ];
    expect(order.every(Boolean)).toBe(true);
    for (let i = 1; i < order.length; i++)
      expect(
        order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    expect(within(nav).getByRole('button', { name: '+ 새 세션' })).toBeTruthy();
    expect(within(nav).getByRole('button', { name: '프로젝트 골라서 새 세션' })).toBeTruthy();
    expect(within(nav).getByRole('heading', { name: '프로젝트' })).toBeTruthy();
    expect(within(nav).getByRole('menu', { name: '하단 메뉴' }).textContent).toContain('에이전트 만들기');
    expect(container.firstChild).toMatchSnapshot();
  });
});

describe('0B.23 프로젝트 묶음 줄', () => {
  it('접기·펼치기, 📌, 이름, 브랜치, 진행 중 배지, [+]', () => {
    const { props } = setup();
    const g = group('imjang-note');
    expect(within(g).getByLabelText('고정됨')).toBeTruthy();
    expect(within(g).getByLabelText('브랜치 main')).toBeTruthy();
    expect(within(g).getByLabelText('진행 중 2개')).toBeTruthy();
    fireEvent.click(within(g).getByRole('button', { name: 'imjang-note에서 새 세션' }));
    expect(props.onNewSessionIn).toHaveBeenCalledWith('p1');
    fireEvent.click(within(g).getByRole('button', { name: /imjang-note$/ }));
    expect(props.onSelectProject).toHaveBeenCalledWith('p1');
    expect(within(g).getByText('design-qa')).toBeTruthy();
    fireEvent.click(within(g).getByRole('button', { name: 'imjang-note 접기' }));
    expect(within(group('imjang-note')).queryByText('design-qa')).toBeNull();
    fireEvent.click(within(group('imjang-note')).getByRole('button', { name: 'imjang-note 펼치기' }));
    expect(within(group('imjang-note')).getByText('design-qa')).toBeTruthy();
    // 폴더 없는 프로젝트
    expect(within(group('a2a')).getByRole('status').textContent).toContain('⚠ 폴더를 찾을 수 없어요');
  });
});

describe('0B.24 세션 줄', () => {
  it('상태 아이콘 ● ✋ ⏸ ✓, 제목, 에이전트 아이콘, 모드 배지, 마지막 활동 시각 (스냅샷)', () => {
    setup();
    const g = group('imjang-note');
    const rows = [...g.querySelectorAll('.hx-srow')].slice(0, 3);
    expect(rows.map((r) => r.querySelector('.hx-srow__state')?.textContent)).toEqual(['●', '✋', '⏸']);
    expect(within(rows[0] as HTMLElement).getByLabelText('에이전트 design-qa').textContent).toBe('🎨');
    expect(within(rows[0] as HTMLElement).getByLabelText('모드 오토')).toBeTruthy();
    expect(rows[0]!.querySelector('time')?.textContent).toBe('2분 전');
    expect(rows[2]!.querySelector('time')?.textContent).toBe('5시간 전');
    expect(rows[1]!.querySelector('.hx-srow__mode')).toBeNull(); // 모드 없는 세션은 배지 없음
    fireEvent.click(within(g).getByRole('button', { name: /완료됨 \(12\)/ }));
    expect(within(g).getAllByLabelText('완료')[0]!.textContent).toBe('✓');
    expect(rows.map((r) => r.outerHTML).join('\n')).toMatchSnapshot();
  });
});

describe('0B.25 묶기 방식', () => {
  it('프로젝트(기본) / 상태 / 날짜 / 없음, 선택 기억', () => {
    const prefs = memPrefs();
    setup({ prefs });
    const labels = () =>
      [...document.querySelectorAll('li.hx-pgroup .hx-pgroup__name')].map((x) =>
        x.textContent?.replace(/[📌📁]/gu, '').trim(),
      );
    expect(labels()).toEqual(['imjang-note', 'harness-x', 'a2a']);
    fireEvent.change(screen.getByLabelText('묶기'), { target: { value: 'status' } });
    expect(labels()).toEqual(['확인 필요', '진행 중', '멈춤', '대기', '완료']);
    fireEvent.change(screen.getByLabelText('묶기'), { target: { value: 'date' } });
    expect(labels()).toEqual(['오늘', '지난 7일']);
    fireEvent.change(screen.getByLabelText('묶기'), { target: { value: 'none' } });
    expect(labels()).toEqual(['모든 세션']);
    expect(prefs.get().group).toBe('none');
    cleanup();
    setup({ prefs });
    expect((screen.getByLabelText('묶기') as HTMLSelectElement).value).toBe('none');
  });
});

describe('0B.26 정렬', () => {
  it('최근 활동(기본) / 이름순, 고정은 항상 맨 위, 끌어서 바꾸면 순서 저장(onReorder) + 내가 정한 순서', () => {
    const projects = [
      proj('a', 'zeta', { order: 2 }),
      proj('b', 'alpha', { order: 0 }),
      proj('c', 'mid', { order: 1, pinned: true }),
    ];
    const sessions = [
      sess('x', 'a', { lastActivityAt: ago(1) }),
      sess('y', 'b', { lastActivityAt: ago(500) }),
    ];
    const prefs = memPrefs();
    const { props } = setup({ projects, sessions, prefs });
    const names = () =>
      [...document.querySelectorAll('li.hx-pgroup .hx-pgroup__name')].map((x) =>
        x.textContent?.replace(/[📌📁]/gu, '').trim(),
      );
    expect(names()).toEqual(['mid', 'zeta', 'alpha']);
    fireEvent.change(screen.getByLabelText('정렬'), { target: { value: 'name' } });
    expect(names()).toEqual(['mid', 'alpha', 'zeta']);
    fireEvent.dragStart(group('zeta'));
    fireEvent.drop(group('alpha'));
    expect(props.onReorder).toHaveBeenCalledWith(['c', 'a', 'b']);
    expect(prefs.get().sort).toBe('manual');
  });
});

describe('0B.27 필터', () => {
  it('상태·엔진·에이전트 + 찾기(세션 제목·프로젝트 이름)', () => {
    const sessions = [
      sess('1', 'p1', { title: '로그인 고치기', engine: 'codex', agent: 'fixer', status: 'running' }),
      sess('2', 'p1', { title: '문서 쓰기', engine: 'claude-code', status: 'idle' }),
      sess('3', 'p2', { title: '하네스 빌드', engine: 'claude-code', agent: 'fixer', status: 'running' }),
    ];
    setup({ sessions });
    const titles = () => [...document.querySelectorAll('.hx-srow__title')].map((x) => x.textContent);
    expect(titles()).toHaveLength(3);
    fireEvent.change(screen.getByLabelText('상태 필터'), { target: { value: 'running' } });
    expect(titles()).toEqual(['로그인 고치기', '하네스 빌드']);
    fireEvent.change(screen.getByLabelText('엔진 필터'), { target: { value: 'codex' } });
    expect(titles()).toEqual(['로그인 고치기']);
    fireEvent.change(screen.getByLabelText('엔진 필터'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('상태 필터'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('에이전트 필터'), { target: { value: 'fixer' } });
    expect(titles()).toEqual(['로그인 고치기', '하네스 빌드']);
    fireEvent.change(screen.getByLabelText('에이전트 필터'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('세션·프로젝트 찾기'), { target: { value: '문서' } });
    expect(titles()).toEqual(['문서 쓰기']);
    fireEvent.change(screen.getByLabelText('세션·프로젝트 찾기'), { target: { value: 'harness' } });
    expect(titles()).toEqual(['하네스 빌드']); // 프로젝트 이름으로 찾기
  });
});

describe('0B.28 프로젝트 … 메뉴', () => {
  it('새 세션 / 이름 바꾸기 / 고정 해제 / 탐색기 / 목록에서 빼기(확인 카드) / 다시 연결 / 옮기기(임시만) / 프로젝트 설정', () => {
    const projects = [...PROJECTS, proj('p4', '임시 작업 1', { scratch: true, order: 3 })];
    const { props } = setup({ projects });
    const act = props.onProjectAction as ReturnType<typeof vi.fn>;
    const open = (name: string) =>
      fireEvent.click(within(group(name)).getByRole('button', { name: `${name} 메뉴` }));
    const pick = (label: string) => fireEvent.click(screen.getByRole('menuitem', { name: label }));

    open('imjang-note');
    const menu = screen.getByRole('menu', { name: 'imjang-note 메뉴' });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((x) => x.textContent),
    ).toEqual([
      '새 세션',
      '이름 바꾸기',
      '고정 해제',
      '탐색기에서 열기',
      '프로젝트 설정',
      '폴더 다시 연결',
      '목록에서 빼기',
    ]);
    pick('새 세션');
    expect(props.onNewSessionIn).toHaveBeenCalledWith('p1');
    open('imjang-note');
    pick('고정 해제');
    expect(act).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'p1' }), {
      type: 'pin',
      pinned: false,
    });
    open('imjang-note');
    pick('탐색기에서 열기');
    expect(act).toHaveBeenLastCalledWith(expect.anything(), { type: 'reveal' });
    open('imjang-note');
    pick('폴더 다시 연결');
    expect(act).toHaveBeenLastCalledWith(expect.anything(), { type: 'relink' });
    open('imjang-note');
    pick('프로젝트 설정');
    expect(act).toHaveBeenLastCalledWith(expect.anything(), { type: 'settings' });
    open('imjang-note');
    pick('이름 바꾸기');
    const input = screen.getByLabelText('프로젝트 새 이름');
    fireEvent.change(input, { target: { value: '임장 노트' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(act).toHaveBeenLastCalledWith(expect.anything(), { type: 'rename', name: '임장 노트' });
    // 목록에서 빼기 → 확인 카드(파일은 지우지 않음)
    open('harness-x');
    pick('목록에서 빼기');
    const card = screen.getByRole('alertdialog');
    expect(card.textContent).toContain('폴더와 파일은 지우지 않아요');
    expect(act).not.toHaveBeenCalledWith(expect.anything(), { type: 'remove' });
    fireEvent.click(within(card).getByRole('button', { name: '목록에서 빼기' }));
    expect(act).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'p2' }), { type: 'remove' });
    // 옮기기는 임시 작업 공간만
    open('harness-x');
    expect(screen.queryByRole('menuitem', { name: '다른 폴더로 옮기기' })).toBeNull();
    open('harness-x');
    open('임시 작업 1');
    pick('다른 폴더로 옮기기');
    expect(act).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'p4' }), { type: 'move' });
  });
});

describe('0B.29 세션 … 메뉴', () => {
  it('이름 바꾸기 / 보관 / 삭제(확인 카드, 실행 중이면 비활성 + 이유), 이어하기는 2번 전엔 숨김', () => {
    const { props } = setup();
    const act = props.onSessionAction as ReturnType<typeof vi.fn>;
    const g = group('imjang-note');
    fireEvent.click(within(g).getByRole('button', { name: 'design-qa 메뉴' }));
    const m = screen.getByRole('menu', { name: 'design-qa 메뉴' });
    expect(within(m).queryByRole('menuitem', { name: '이어하기' })).toBeNull();
    const del = within(m).getByRole('menuitem', { name: '삭제' }) as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    expect(m.textContent).toContain('실행 중에는 지울 수 없어요');
    fireEvent.click(within(m).getByRole('menuitem', { name: '보관' }));
    expect(act).toHaveBeenLastCalledWith(expect.objectContaining({ id: 's1' }), { type: 'archive' });

    fireEvent.click(within(g).getByRole('button', { name: '로고 수정 메뉴' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '이름 바꾸기' }));
    const input = screen.getByLabelText('세션 새 이름');
    fireEvent.change(input, { target: { value: '로고 바꾸기' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(act).toHaveBeenLastCalledWith(expect.objectContaining({ id: 's3' }), {
      type: 'rename',
      title: '로고 바꾸기',
    });

    fireEvent.click(within(group('imjang-note')).getByRole('button', { name: 'API 리팩터 메뉴' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '삭제' }));
    const card = screen.getByRole('alertdialog');
    fireEvent.click(within(card).getByRole('button', { name: '지우기' }));
    expect(act).toHaveBeenLastCalledWith(expect.objectContaining({ id: 's2' }), { type: 'delete' });

    cleanup();
    setup({ canResume: true });
    fireEvent.click(within(group('imjang-note')).getByRole('button', { name: '로고 수정 메뉴' }));
    expect(screen.getByRole('menuitem', { name: '이어하기' })).toBeTruthy();
  });
});

describe('0B.30 완료 세션', () => {
  it('"완료됨 (n)"으로 접고, 30일 지난 완료 세션은 보관 제안(자동 삭제 없음)', () => {
    const old = sess('old', 'p2', {
      status: 'done',
      doneAt: ago(60 * 24 * 31),
      lastActivityAt: ago(60 * 24 * 31),
    });
    const { props } = setup({ sessions: [...SESSIONS, old] });
    const g = group('imjang-note');
    expect(within(g).queryByText('끝난 일 0')).toBeNull();
    const toggle = within(g).getByRole('button', { name: /완료됨 \(12\)/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(within(g).getByText('끝난 일 0')).toBeTruthy();
    expect(archiveSuggestions([...SESSIONS, old], NOW).map((s) => s.id)).toEqual(['old']);
    const note = screen.getByRole('note');
    expect(note.textContent).toContain('30일 지난 세션이 1개');
    expect(note.textContent).toContain('지우지 않아요');
    fireEvent.click(within(note).getByRole('button', { name: '보관하기' }));
    expect(props.onArchiveMany).toHaveBeenCalledWith(['old']);
    expect(props.onSessionAction).not.toHaveBeenCalledWith(expect.anything(), { type: 'delete' });
  });
});

describe('0B.17 [▾] 펼침', () => {
  it('프로젝트 목록(고정 먼저) + [폴더 열기] → 고르면 그 프로젝트에서 초안', () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole('button', { name: '프로젝트 골라서 새 세션' }));
    const m = screen.getByRole('menu', { name: '어느 프로젝트에서 시작할까요' });
    const items = within(m).getAllByRole('menuitem');
    expect(items.map((x) => x.textContent)).toEqual([
      '📌 📁 imjang-note',
      '📁 harness-x',
      '📁 a2a',
      '폴더 열기…',
    ]);
    expect((items[2] as HTMLButtonElement).disabled).toBe(true); // 폴더 없는 프로젝트
    fireEvent.click(items[1]!);
    expect(props.onNewSessionIn).toHaveBeenCalledWith('p2');
    fireEvent.click(screen.getByRole('button', { name: '프로젝트 골라서 새 세션' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '폴더 열기…' }));
    expect(props.onOpenFolder).toHaveBeenCalled();
  });
});

describe('0B.39 묶음은 저장된 projectId 기준', () => {
  it('하위 폴더 cwd 세션도 같은 묶음에 표시', () => {
    const sessions = [
      sess('root', 'p2', { cwd: '/mnt/c/work/harness-x', title: '루트에서' }),
      sess('sub', 'p2', { cwd: '/mnt/c/work/harness-x/packages/kernel', title: '하위 폴더에서' }),
      sess('wt', 'p2', { cwd: '/mnt/c/elsewhere/worktree-1', title: '작업 트리에서' }),
    ];
    setup({ sessions });
    const g = group('harness-x');
    expect([...g.querySelectorAll('.hx-srow__title')].map((x) => x.textContent).sort()).toEqual(
      ['루트에서', '작업 트리에서', '하위 폴더에서'].sort(),
    );
    expect(groupSessions(sessions, PROJECTS, 'project').find((x) => x.key === 'p2')?.active).toHaveLength(3);
  });
});
