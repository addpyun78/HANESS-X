// @vitest-environment jsdom
// @features F-088
import { renameSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '@harness-x/kernel';
import { bootServer, renderAppOn, teardown, type Booted } from './projects-e2e-fixtures.js';

let b: Booted | undefined;
afterEach(async () => {
  await teardown(b);
  b = undefined;
  localStorage.clear();
});

const sidebar = () => screen.getByRole('navigation', { name: '사이드바' });
const groupOf = (name: string) => {
  const btn = within(sidebar()).getByRole('button', { name: new RegExp(`^(고정됨\\s*)?${name}$`) });
  return btn.closest('li.hx-pgroup') as HTMLElement;
};
const groupNames = () =>
  [...sidebar().querySelectorAll('li.hx-pgroup .hx-pgroup__name')].map((x) =>
    (x.textContent ?? '').replace(/[📌📁]/gu, '').trim(),
  );
const send = (text: string) => {
  const box = screen.getByLabelText('지시 입력');
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: 'Enter' });
};

describe('0B.34 E2E: 프로젝트 없음 → 새 세션 → 폴더 열기 → 첫 메시지 → 두 번째 프로젝트 → 고정·순서 → 재시작', () => {
  it('앱 재시작 후에도 묶음·고정·순서·세션이 그대로', async () => {
    b = await bootServer();
    const a = b.dir('alpha');
    const bb = b.dir('beta');
    const c = b.dir('gamma');
    renderAppOn(b);
    await screen.findByRole('searchbox', { name: '세션·프로젝트 찾기' });
    expect(within(sidebar()).getByText(/아직 프로젝트가 없어요/)).toBeTruthy();

    // [+ 새 세션] → 프로젝트가 없으니 "어디서 작업할까요?" → [폴더 열기](모킹)
    fireEvent.click(within(sidebar()).getByRole('button', { name: '+ 새 세션' }));
    const where = await screen.findByRole('dialog', { name: '어디서 작업할까요?' });
    b.picks.push(a);
    fireEvent.click(within(where).getByRole('button', { name: '폴더 열기' }));
    await screen.findByRole('heading', { name: 'alpha에서 무엇을 할까요?' });
    expect(b.sessions.list()).toHaveLength(0); // 초안은 아직 저장 안 됨

    // 첫 메시지 → 저장 · 사이드바 등록
    send('로그인 화면 고쳐 줘');
    await waitFor(() => expect(within(groupOf('alpha')).getByText('로그인 화면 고쳐 줘')).toBeTruthy());
    expect(b.sessions.list()).toHaveLength(1);

    // 두 번째·세 번째 프로젝트 → 묶음 3개
    b.picks.push(bb);
    fireEvent.click(within(sidebar()).getByRole('button', { name: '폴더 열기' }));
    await waitFor(() => expect(groupNames()).toContain('beta'));
    b.picks.push(c);
    fireEvent.click(within(sidebar()).getByRole('button', { name: '폴더 열기' }));
    await waitFor(() => expect(groupNames()).toHaveLength(3));

    // beta 고정 → 맨 위
    fireEvent.click(within(groupOf('beta')).getByRole('button', { name: 'beta 메뉴' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '고정' }));
    await waitFor(() => expect(groupNames()[0]).toBe('beta'));
    // 고정 아래 두 묶음의 순서를 끌어 놓기로 바꾼다 → 내가 정한 순서
    const [, second, third] = groupNames();
    fireEvent.dragStart(groupOf(third!));
    fireEvent.dragOver(groupOf(second!));
    fireEvent.drop(groupOf(second!));
    const wanted = ['beta', third!, second!];
    await waitFor(() => expect(groupNames()).toEqual(wanted));

    // 앱 재시작 (서버·화면 모두)
    cleanup();
    await b.stop();
    b = await bootServer({ home: b.home, root: b.root });
    renderAppOn(b);
    await waitFor(() => expect(groupNames()).toEqual(wanted));
    expect(within(groupOf('beta')).getByLabelText('고정됨')).toBeTruthy();
    expect(within(groupOf('alpha')).getByText('로그인 화면 고쳐 줘')).toBeTruthy();
  });
});

describe('0B.35 E2E: 폴더 이름 변경 → 다시 연결', () => {
  it('"폴더를 찾을 수 없어요" → [다시 연결] → 지난 세션 그대로', async () => {
    b = await bootServer();
    const dir = b.dir('old-name');
    const p = b.projects.add(dir).project;
    b.sessions.createSession({ origin: 'ui', projectId: p.id, firstMessage: '지난번 작업' });
    renameSync(dir, join(b.root, 'new-name'));
    renderAppOn(b);
    const g = await waitFor(() => groupOf('old-name'));
    expect(within(g).getByRole('status').textContent).toContain('⚠ 폴더를 찾을 수 없어요');
    expect(within(g).getByText('지난번 작업')).toBeTruthy();
    b.picks.push(join(b.root, 'new-name'));
    fireEvent.click(within(g).getByRole('button', { name: '다시 연결' }));
    await waitFor(() => expect(within(groupOf('old-name')).queryByRole('status')).toBeNull());
    expect(within(groupOf('old-name')).getByText('지난번 작업')).toBeTruthy();
    expect(b.projects.get(p.id)).toMatchObject({ rootPath: join(b.root, 'new-name'), missing: false });
    expect(b.sessions.list({ projectId: p.id })).toHaveLength(1);
  });
});

describe('0B.37 CLI로 만든 세션', () => {
  it('harness-x run → 3초 안에 사이드바에 표시', async () => {
    b = await bootServer();
    const dir = b.dir('cli-proj');
    b.projects.add(dir);
    renderAppOn(b);
    await waitFor(() => groupOf('cli-proj'));
    const started = Date.now();
    let code = -1;
    await act(async () => {
      code = await runCli(['/review', 'CLI에서 시작한 일', '--port', String(b!.server.port)], {
        home: b!.home,
        cwd: b!.dir('cli-proj/sub'),
        io: { out: () => {}, err: () => {} },
      });
    });
    expect(code).toBe(0);
    // 가짜 실행은 바로 끝나므로 "완료됨 (1)" 안에 들어간다
    const done = await waitFor(
      () => within(groupOf('cli-proj')).getByRole('button', { name: /완료됨 \(1\)/ }),
      {
        timeout: 3000,
      },
    );
    fireEvent.click(done);
    expect(within(groupOf('cli-proj')).getByText('CLI에서 시작한 일')).toBeTruthy();
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
