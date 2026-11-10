// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { subagentTarget } from '../src/composer/SubagentConfirm.js';
import type { SessionSummary } from '../src/shell/types.js';
import { renderApp } from './app-fixtures.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

const AGENTS = [
  {
    name: 'design-qa',
    command: '/design-qa',
    displayName: '디자인 QA',
    icon: '🎨',
    source: 'user',
    defaultEngine: 'auto',
    nodeCount: 3,
  },
  {
    name: 'review',
    command: '/review',
    displayName: '리뷰',
    icon: '🔍',
    source: 'user',
    defaultEngine: 'auto',
    nodeCount: 1,
  },
];

const session = (agent: (typeof AGENTS)[number], prompt: string, id: string) => ({
  sessionId: id,
  agent: { name: agent.name, command: agent.command, displayName: agent.displayName, icon: agent.icon },
  prompt,
  modifiers: { strict: false, planOnly: false },
  status: 'running',
  completedNodes: [],
  nodeCount: agent.nodeCount,
  progress: 0,
  startedAt: '2026-11-11T00:00:00.000Z',
  subagents: [],
});

const input = () => screen.getByLabelText('지시 입력') as HTMLTextAreaElement;
function pickAgent(query: string) {
  fireEvent.change(input(), { target: { value: `/${query}` } });
  fireEvent.keyDown(input(), { key: 'Enter' });
}
function send(text: string) {
  fireEvent.change(input(), { target: { value: text } });
  fireEvent.keyDown(input(), { key: 'Enter' });
}

describe('48.1 칩 + 지시문 전송 → POST /api/sessions, 48.4 실행 중이면 서브에이전트 확인 카드', () => {
  it('전송 → 새 세션이 사이드바에 (아이콘·진행률), 다른 에이전트 → 확인 카드 → 서브에이전트 추가', async () => {
    const { calls } = renderApp({
      'GET /api/agents': () => ({ body: { agents: AGENTS } }),
      'POST /api/sessions': (b) => {
        const req = b as { agent: string; prompt: string };
        const a = AGENTS.find((x) => x.command === req.agent)!;
        return { status: 201, body: session(a, req.prompt, `dispatch-${a.name}`) };
      },
      'POST /api/sessions/dispatch-design-qa/subagents': (b) => ({
        body: {
          ...session(AGENTS[0]!, 'x', 'dispatch-design-qa'),
          subagents: [(b as { agent: string }).agent],
        },
      }),
    });
    await waitFor(() => expect(calls.some((c) => c.path === '/api/agents')).toBe(true));
    await screen.findByLabelText('지시 입력');
    await waitFor(() => {
      pickAgent('design');
      expect(screen.getByLabelText('에이전트 디자인 QA')).toBeTruthy();
    });
    send('로그인 화면 고쳐 줘 @codex');
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/api/sessions')).toBe(true),
    );
    expect(calls.find((c) => c.path === '/api/sessions')!.body).toEqual({
      agent: '/design-qa',
      prompt: '로그인 화면 고쳐 줘 @codex',
    });
    const item = await screen.findByText('/design-qa 로그인 화면 고쳐 줘 @codex');
    expect(item.closest('button')?.querySelector('.hx-session__agent')?.textContent).toBe('🎨');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');

    // 실행 중에 다른 에이전트를 /로 부르면 확인 카드
    fireEvent.click(screen.getByLabelText('디자인 QA 에이전트 해제'));
    pickAgent('review');
    send('이것도 봐 줘');
    const card = await screen.findByRole('alertdialog', { name: '서브에이전트로 추가' });
    expect(card.textContent).toContain('/design-qa');
    expect(card.textContent).toContain('/review');
    expect(calls.filter((c) => c.path === '/api/sessions')).toHaveLength(1);
    fireEvent.click(screen.getByText('서브에이전트로 추가'));
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/api/sessions/dispatch-design-qa/subagents')?.body).toEqual({
        agent: '/review',
      }),
    );
    expect(screen.queryByRole('alertdialog')).toBeNull();

    // 새 세션으로 실행을 고르면 POST /api/sessions
    send('따로 실행');
    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByText('새 세션으로 실행'));
    await waitFor(() => expect(calls.filter((c) => c.path === '/api/sessions')).toHaveLength(2));
  });

  it('subagentTarget: 같은 에이전트·실행 중 세션 없음·칩 없음이면 묻지 않는다', () => {
    const s = (id: string, status: SessionSummary['status'], command?: string): SessionSummary => ({
      id,
      title: id,
      status,
      project: 'p',
      engineId: '',
      updatedAt: '',
      ...(command ? { agent: { name: command.slice(1), command } } : {}),
    });
    const list = [s('a', 'done', '/x'), s('b', 'running', '/design-qa'), s('c', 'running')];
    expect(subagentTarget({ agent: '/review' }, list)?.id).toBe('b');
    expect(subagentTarget({ agent: '/design-qa' }, list)).toBeUndefined();
    expect(subagentTarget({}, list)).toBeUndefined();
    expect(subagentTarget({ agent: '/review' }, [s('a', 'done', '/x')])).toBeUndefined();
  });
});
