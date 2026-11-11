// @vitest-environment jsdom
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { bootServer, renderAppOn, teardown, type Booted } from './projects-e2e-fixtures.js';

let b: Booted | undefined;
afterEach(async () => {
  await teardown(b);
  b = undefined;
  localStorage.clear();
});

const sidebar = () => screen.getByRole('navigation', { name: '사이드바' });
const ready = () => screen.findByRole('searchbox', { name: '세션·프로젝트 찾기' });
const newBtn = () => within(sidebar()).getByRole('button', { name: '+ 새 세션' });
const groupOf = (name: string) =>
  within(sidebar())
    .getByRole('button', { name: new RegExp(`^(고정됨\\s*)?${name}$`) })
    .closest('li.hx-pgroup') as HTMLElement;
const send = (text: string) => {
  const box = screen.getByLabelText('지시 입력');
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: 'Enter' });
};

async function withProject(name = 'proj') {
  b = await bootServer();
  const dir = b.dir(name);
  const p = b.projects.add(dir).project;
  renderAppOn(b);
  await ready();
  await waitFor(() => groupOf(name));
  return { dir, p };
}

describe('0B.14 [+ 새 세션] 본체', () => {
  it('지금 고른 프로젝트가 있으면 클릭 → 0.5초 안에 빈 세션 화면 + 입력창 포커스', async () => {
    await withProject('imjang-note');
    const t0 = performance.now();
    fireEvent.click(newBtn());
    await screen.findByRole('heading', { name: 'imjang-note에서 무엇을 할까요?' }, { timeout: 500 });
    expect(performance.now() - t0).toBeLessThan(500);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('지시 입력')));
  });
});

describe('0B.15 프로젝트가 없을 때 "어디서 작업할까요?"', () => {
  it('3경로: [폴더 열기] / [최근 프로젝트 ▸] / [임시 작업 공간에서 시작]', async () => {
    b = await bootServer();
    const recent = b.dir('recent-one');
    const opened = b.dir('opened-one');
    const p = b.projects.add(recent, { select: false }).project;
    renderAppOn(b);
    await ready();
    // ① 폴더 열기
    fireEvent.click(newBtn());
    let where = await screen.findByRole('dialog', { name: '어디서 작업할까요?' });
    b.picks.push(opened);
    fireEvent.click(within(where).getByRole('button', { name: '폴더 열기' }));
    await screen.findByRole('heading', { name: 'opened-one에서 무엇을 할까요?' });
    // 현재 프로젝트를 풀어 다시 "프로젝트 없음"으로
    await b.projects.setCurrent(undefined);
    cleanupAndRender();
    await ready();
    // ② 최근 프로젝트
    fireEvent.click(newBtn());
    where = await screen.findByRole('dialog', { name: '어디서 작업할까요?' });
    fireEvent.click(within(where).getByRole('button', { name: '최근 프로젝트 ▸' }));
    fireEvent.click(
      within(within(where).getByRole('list', { name: '최근 프로젝트' })).getByRole('button', {
        name: /recent-one/,
      }),
    );
    await screen.findByRole('heading', { name: 'recent-one에서 무엇을 할까요?' });
    expect(b.projects.current()?.id).toBe(p.id);
    await b.projects.setCurrent(undefined);
    cleanupAndRender();
    await ready();
    // ③ 임시 작업 공간
    fireEvent.click(newBtn());
    where = await screen.findByRole('dialog', { name: '어디서 작업할까요?' });
    expect(where.textContent).toContain('나중에 원하는 폴더로 옮길 수 있어요');
    fireEvent.click(within(where).getByRole('button', { name: '임시 작업 공간에서 시작' }));
    await screen.findByRole('heading', { name: '임시 작업 1에서 무엇을 할까요?' });
  });
});

function cleanupAndRender() {
  // 같은 서버에 App만 다시 띄운다
  cleanup();
  renderAppOn(b!);
}

describe('0B.16 임시 작업 공간', () => {
  it('~/.harness-x/scratch/<날짜-짧은id>/ 자동 등록 "임시 작업 1" → … [다른 폴더로 옮기기]', async () => {
    b = await bootServer();
    const dest = b.dir('real-home-for-it');
    renderAppOn(b);
    await ready();
    fireEvent.click(newBtn());
    const where = await screen.findByRole('dialog', { name: '어디서 작업할까요?' });
    fireEvent.click(within(where).getByRole('button', { name: '임시 작업 공간에서 시작' }));
    await screen.findByRole('heading', { name: '임시 작업 1에서 무엇을 할까요?' });
    const scratch = b.projects.list()[0]!;
    expect(scratch.scratch).toBe(true);
    expect(scratch.rootPath.startsWith(join(b.home, 'scratch'))).toBe(true);
    expect(readdirSync(join(b.home, 'scratch'))[0]).toMatch(/^\d{8}-[0-9a-f]{6}$/);
    send('메모 정리');
    await waitFor(() => expect(within(groupOf('임시 작업 1')).getByText('메모 정리')).toBeTruthy());
    // 옮기기
    b.picks.push(dest);
    fireEvent.click(within(groupOf('임시 작업 1')).getByRole('button', { name: '임시 작업 1 메뉴' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '다른 폴더로 옮기기' }));
    await waitFor(() => expect(within(groupOf('real-home-for-it')).getByText('메모 정리')).toBeTruthy());
    expect(b.projects.get(scratch.id)).toMatchObject({ rootPath: dest });
    expect(b.projects.get(scratch.id)?.scratch).toBeUndefined();
    expect(existsSync(scratch.rootPath)).toBe(false);
    expect(existsSync(join(dest, '.harness-x', 'project.json'))).toBe(true);
  });
});

describe('0B.18 빈 세션 화면', () => {
  it('"<이름>에서 무엇을 할까요?" + 예시 3개(입력창 채움) + 최근 에이전트(/ 칩) + 끌어 놓기 안내 (스냅샷)', async () => {
    await withProject('note');
    fireEvent.click(newBtn());
    const view = (await screen.findByRole('region', { name: '새 세션' })) as HTMLElement;
    expect(view.outerHTML).toMatchSnapshot();
    const examples = within(within(view).getByRole('list', { name: '예시 지시' })).getAllByRole('button');
    expect(examples).toHaveLength(3);
    fireEvent.click(examples[0]!);
    await waitFor(() =>
      expect((screen.getByLabelText('지시 입력') as HTMLTextAreaElement).value).toBe(
        examples[0]!.textContent,
      ),
    );
    expect(view.textContent).toContain('끌어다 놓아도 돼요');
    const agents = within(within(view).getByRole('list', { name: '최근 쓴 에이전트' })).getAllByRole(
      'button',
    );
    expect(agents.length).toBeGreaterThan(0);
    expect(agents.length).toBeLessThanOrEqual(3);
    fireEvent.click(agents[0]!);
    await screen.findByLabelText('에이전트 검토');
  });
});

describe('0B.21 단축키', () => {
  it('Ctrl+N = 지금 프로젝트에서 새 세션, Ctrl+Shift+N = 프로젝트 고르기, 입력창 /new', async () => {
    await withProject('keys');
    fireEvent.keyDown(window, { key: 'n', ctrlKey: true });
    await screen.findByRole('heading', { name: 'keys에서 무엇을 할까요?' });
    fireEvent.keyDown(window, { key: 'N', ctrlKey: true, shiftKey: true });
    expect(await screen.findByRole('menu', { name: '어느 프로젝트에서 시작할까요' })).toBeTruthy();
    // 첫 메시지로 정식 세션 → /new 로 새 초안
    send('첫 일');
    await waitFor(() => expect(within(groupOf('keys')).getByText('첫 일')).toBeTruthy());
    expect(screen.queryByRole('heading', { name: 'keys에서 무엇을 할까요?' })).toBeNull();
    send('/new');
    await screen.findByRole('heading', { name: 'keys에서 무엇을 할까요?' });
    expect(b!.sessions.list()).toHaveLength(1); // /new 는 메시지가 아니다
  });
});

describe('0B.31 선택 동기화', () => {
  it('사이드바에서 고른 프로젝트 = 상단 바 프로젝트 = + 메뉴 기준 폴더', async () => {
    b = await bootServer();
    const one = b.dir('one');
    const two = b.dir('two');
    b.projects.add(one);
    b.projects.add(two);
    renderAppOn(b);
    await ready();
    await waitFor(() => expect(screen.getByTestId('workspace').textContent).toContain('two'));
    fireEvent.click(within(groupOf('one')).getByRole('button', { name: /one$/ }));
    await waitFor(() => expect(screen.getByTestId('workspace').textContent).toContain(one));
    expect(groupOf('one').querySelector('.hx-pgroup__row')?.getAttribute('aria-current')).toBe('true');
    await waitFor(() => expect(b!.projects.current()?.rootPath).toBe(one));
    // + 메뉴: 최근 프로젝트에서 two를 고르면 세 곳이 다시 함께 바뀐다
    fireEvent.click(screen.getByLabelText('추가'));
    fireEvent.click(screen.getByRole('menuitem', { name: /최근 프로젝트/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /two/ }));
    await waitFor(() => expect(screen.getByTestId('workspace').textContent).toContain(two));
    expect(groupOf('two').querySelector('.hx-pgroup__row')?.getAttribute('aria-current')).toBe('true');
    await waitFor(() => expect(b!.projects.current()?.rootPath).toBe(two));
    // 새 세션도 그 폴더에서
    fireEvent.click(newBtn());
    await screen.findByRole('heading', { name: 'two에서 무엇을 할까요?' });
  });
});

describe('0B.13 + 메뉴로 다른 폴더를 고를 때', () => {
  it('초안이면 프로젝트 변경, 대화가 있으면 "그 폴더에서 새 세션을 열게요" + 새 초안', async () => {
    b = await bootServer();
    b.projects.add(b.dir('first'));
    b.projects.add(b.dir('second'));
    b.projects.setCurrent(b.projects.list().find((p) => p.name === 'first')!.id);
    renderAppOn(b);
    await ready();
    fireEvent.click(newBtn());
    await screen.findByRole('heading', { name: 'first에서 무엇을 할까요?' });
    const pickRecent = (name: string) => {
      fireEvent.click(screen.getByLabelText('추가'));
      fireEvent.click(screen.getByRole('menuitem', { name: /최근 프로젝트/ }));
      fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(name) }));
    };
    // 초안 → 프로젝트만 바뀐다 (같은 초안)
    pickRecent('second');
    await screen.findByRole('heading', { name: 'second에서 무엇을 할까요?' });
    send('second에서 할 일');
    await waitFor(() => expect(within(groupOf('second')).getByText('second에서 할 일')).toBeTruthy());
    // 대화가 있는 세션 → 새 초안 + 안내
    pickRecent('first');
    await screen.findByRole('heading', { name: 'first에서 무엇을 할까요?' });
    expect(screen.getByText('그 폴더에서 새 세션을 열게요')).toBeTruthy();
    const second = b.projects.list().find((p) => p.name === 'second')!;
    expect(b.sessions.list({ projectId: second.id })).toHaveLength(1);
  });
});

describe('0B.41 프로젝트 설정', () => {
  it('프로젝트 설정 저장 → 새 세션에 반영 (기본 AI·권한·모드)', async () => {
    const { p } = await withProject('settings-proj');
    fireEvent.click(within(groupOf('settings-proj')).getByRole('button', { name: 'settings-proj 메뉴' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '프로젝트 설정' }));
    const dlg = await screen.findByRole('dialog', { name: 'settings-proj 프로젝트 설정' });
    await waitFor(() => expect(within(dlg).getByText('AGENTS.md 없음')).toBeTruthy());
    fireEvent.change(within(dlg).getByLabelText('기본 모델'), { target: { value: 'opus' } });
    fireEvent.change(within(dlg).getByLabelText('기본 권한'), { target: { value: 'read-only' } });
    fireEvent.change(within(dlg).getByLabelText('기본 모드'), { target: { value: 'plan' } });
    fireEvent.change(within(dlg).getByLabelText('이름'), { target: { value: '설정 프로젝트' } });
    fireEvent.click(within(dlg).getByRole('button', { name: '저장' }));
    await within(dlg).findByText('저장했어요');
    expect(b!.projects.get(p.id)).toMatchObject({
      name: '설정 프로젝트',
      rootPath: p.rootPath,
      defaults: { model: 'opus', permission: 'read-only', mode: 'plan' },
    });
    fireEvent.click(within(dlg).getByRole('button', { name: '닫기' }));
    fireEvent.click(newBtn());
    await screen.findByRole('heading', { name: '설정 프로젝트에서 무엇을 할까요?' });
    send('설정 확인');
    await waitFor(() => expect(b!.sessions.list()).toHaveLength(1));
    expect(b!.sessions.list()[0]).toMatchObject({
      model: 'opus',
      permission: 'read-only',
      mode: 'plan',
      engine: 'claude-code',
    });
  });
});
