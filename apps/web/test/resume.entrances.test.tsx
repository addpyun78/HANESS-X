// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResumeFlow, toStartChoices, type ResumeApi } from '../src/recovery/ResumeFlow.js';
import { parseResumeCommand, ResumeCountLink, resumeTarget } from '../src/recovery/resume-entry.js';
import { renderApp } from './app-fixtures.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

const AGENT = {
  name: 'design-qa',
  command: '/design-qa',
  displayName: '디자인 QA',
  icon: '🎨',
  source: 'user',
  defaultEngine: 'auto',
  nodeCount: 3,
};

/** POST /api/sessions 응답이 곧바로 멈춘 세션 (사이드바에 ⏸ 줄을 만들기 위해) */
const pausedSession = {
  sessionId: 'dispatch-p1',
  agent: { name: AGENT.name, command: AGENT.command, displayName: AGENT.displayName, icon: AGENT.icon },
  prompt: '헤더 고쳐 줘',
  modifiers: { strict: false, planOnly: false },
  status: 'paused',
  paused: { reason: 'user', at: '2026-11-12T00:00:00.000Z', by: 'user' },
  completedNodes: [],
  nodeCount: 3,
  progress: 0.33,
  startedAt: '2026-11-12T00:00:00.000Z',
  subagents: [],
};

const input = () => screen.getByLabelText('지시 입력') as HTMLTextAreaElement;
const type = (text: string) => {
  fireEvent.change(input(), { target: { value: text } });
  fireEvent.keyDown(input(), { key: 'Enter' });
};

function app() {
  return renderApp({
    'GET /api/agents': () => ({ body: { agents: [AGENT] } }),
    'POST /api/sessions': () => ({ status: 201, body: pausedSession }),
    'POST /api/resume/dispatch-p1/check': () => ({ body: { ok: true, issues: [], checked: [] } }),
    'POST /api/resume/dispatch-p1': () => ({ status: 202, body: { mode: 'engine', version: 'pinned' } }),
  });
}

/** 칩 + 지시문으로 세션 하나를 만든다 (응답이 멈춘 세션) */
async function makePausedSession() {
  const r = app();
  await screen.findByLabelText('지시 입력');
  await waitFor(() => {
    type('/design');
    expect(screen.getByLabelText('에이전트 디자인 QA')).toBeTruthy();
  });
  type('헤더 고쳐 줘');
  await screen.findByTestId('session-paused');
  return r;
}

describe('2B.2 이어하기 입구 5개', () => {
  it('① 사이드바 세션 … 메뉴 [이어하기] — resume.project-entrances.test.tsx(0-2 사이드바)에서 검사', () => {
    // T-102 C2-005: 자리표시 대신 그 검사가 실제로 있는지 확인한다
    const other = readFileSync(
      join(process.cwd(), 'apps/web/test/resume.project-entrances.test.tsx'),
      'utf8',
    );
    expect(other).toContain("it('① 세션 … 메뉴 [이어하기]");
  });

  it('② ⏸ 세션 줄 클릭 → 점검 → 이어하기 (POST check → POST resume)', async () => {
    const { calls } = await makePausedSession();
    fireEvent.click(screen.getByTestId('session-paused').closest('button')!);
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/api/resume/dispatch-p1')).toBe(true),
    );
    expect(calls.filter((c) => c.path.startsWith('/api/resume')).map((c) => c.path)).toEqual([
      '/api/resume/dispatch-p1/check',
      '/api/resume/dispatch-p1',
    ]);
    await waitFor(() => expect(screen.queryByTestId('session-paused')).toBeNull());
  });

  it('③ 빈 세션 화면의 "이어서 할 작업 N개" (0B.18 화면에 붙일 버튼)', () => {
    const onOpen = vi.fn();
    const { container, rerender } = render(<ResumeCountLink count={0} onOpen={onOpen} />);
    expect(container.innerHTML).toBe('');
    rerender(<ResumeCountLink count={2} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: '⏸ 이어서 할 작업 2개' }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('④ /resume 입력 → 가장 최근 멈춘 세션 이어하기 (/resume <id>도)', async () => {
    expect(parseResumeCommand('/resume')).toEqual({});
    expect(parseResumeCommand(' /resume dispatch-9 ')).toEqual({ sessionId: 'dispatch-9' });
    expect(parseResumeCommand('/resumex')).toBeNull();
    expect(parseResumeCommand('헤더 /resume')).toBeNull();
    expect(
      resumeTarget({}, [
        { id: 'a', status: 'paused', updatedAt: '1' },
        { id: 'b', status: 'paused', updatedAt: '3' },
        { id: 'c', status: 'running', updatedAt: '9' },
      ]),
    ).toBe('b');
    const { calls } = await makePausedSession();
    fireEvent.click(screen.getByLabelText('디자인 QA 에이전트 해제'));
    type('/resume'); // 팔레트의 내장 명령 /resume 선택 → 입력창 "/resume "
    expect(input().value).toBe('/resume ');
    fireEvent.keyDown(input(), { key: 'Enter' }); // 전송
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/api/resume/dispatch-p1')).toBe(true),
    );
    expect(calls.filter((c) => c.path === '/api/sessions')).toHaveLength(1); // 새 세션을 만들지 않음
  });

  it('⑤ CLI harness-x resume <id> — packages/kernel/test/resume.entrances.test.ts에서 검사', () => {
    const other = readFileSync(join(process.cwd(), 'packages/kernel/test/resume.entrances.test.ts'), 'utf8');
    expect(other).toContain("it('켜진 서버에 점검 → 이어서 시작 (쉬운 말 출력)'");
  });
});

describe('2B.2 이어하기 흐름 (모든 입구 공통)', () => {
  it('문제가 있으면 카드로 묻고 고른 대로 시작, 기다리기면 시작 안 함', async () => {
    const start = vi.fn(async () => ({ mode: 'summary', version: 'pinned' }));
    const api: ResumeApi = {
      check: async () => ({
        ok: false,
        issues: [
          {
            check: 'files',
            title: '멈춘 뒤에 파일이 바뀌었어요',
            body: '멈춘 뒤에 파일 1개가 바뀌었어요. 어떻게 이어할까요?',
            list: ['a.ts (고쳐짐)'],
            choices: [
              { id: 'keep', label: '바뀐 걸 반영해서 계속', recommended: true, default: true },
              { id: 'revert', label: '멈춘 때로 되돌리고 계속' },
              { id: 'replan', label: '계획부터 다시' },
            ],
          },
        ],
      }),
      start,
    };
    const onDone = vi.fn();
    render(<ResumeFlow api={api} sessionId="s1" onDone={onDone} />);
    await screen.findByText('멈춘 뒤에 파일이 바뀌었어요');
    fireEvent.click(screen.getByRole('button', { name: '멈춘 때로 되돌리고 계속' }));
    fireEvent.click(screen.getByRole('button', { name: '이 선택으로 이어하기' }));
    await waitFor(() => expect(start).toHaveBeenCalledWith('s1', { files: 'revert' }));
    expect(onDone).toHaveBeenCalledWith({ mode: 'summary', version: 'pinned' });
    expect(toStartChoices({ conflict: 'wait' })).toBeNull();
    expect(toStartChoices({ engine: 'engine:codex', version: 'latest', stale: 'replan' })).toEqual({
      engine: 'codex',
      version: 'latest',
      files: 'replan',
    });
  });
});
