// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { agentSessionsFromEvents } from '../src/shell/agent-sessions.js';
import { Sidebar } from '../src/shell/Sidebar.js';

afterEach(cleanup);

const ev = (type: string, extra: Record<string, unknown> = {}, ts = 1) => ({
  id: `${type}-${ts}`,
  ts: `2026-11-11T00:00:0${ts}.000Z`,
  sessionId: 'dispatch-1',
  type,
  ...extra,
});

const CREATED = ev('session_created', {
  agent: 'design-qa',
  command: '/design-qa',
  icon: '🎨',
  nodeCount: 3,
  nodes: ['plan', 'build', 'critic'],
  prompt: '로그인 화면',
  modifiers: { engine: 'codex', strict: false, planOnly: false },
});

describe('48.3 사이드바 세션 항목: 에이전트 아이콘·현재 노드·진행률', () => {
  it('이벤트 → 세션 요약 (현재 노드, 완료 노드/노드 수)', () => {
    const mid = agentSessionsFromEvents(
      [
        CREATED,
        ev('node_start', { nodeId: 'plan' }, 2),
        ev('node_end', { nodeId: 'plan', status: 'completed' }, 3),
        ev('node_start', { nodeId: 'build' }, 4),
        { type: 'assistant_text', sessionId: 'other', text: 'x' },
      ],
      'harness-x',
    );
    expect(mid).toEqual([
      {
        id: 'dispatch-1',
        title: '/design-qa 로그인 화면',
        status: 'running',
        project: 'harness-x',
        engineId: 'codex',
        updatedAt: '2026-11-11T00:00:04.000Z',
        agent: { name: 'design-qa', command: '/design-qa', icon: '🎨' },
        currentNode: 'build',
        progress: 1 / 3,
      },
    ]);
    const end = agentSessionsFromEvents(
      [CREATED, ev('subagent_added', { nodeCount: 1 }, 2), ev('session_end', { status: 'completed' }, 5)],
      'p',
    );
    expect(end[0]).toMatchObject({ status: 'done', progress: 1 });
    expect(end[0]!.currentNode).toBeUndefined();
    const blocked = agentSessionsFromEvents([CREATED, ev('session_end', { status: 'incomplete' }, 2)], 'p');
    expect(blocked[0]).toMatchObject({ status: 'blocked', progress: 0 });
  });

  it('스냅샷: 아이콘 + 현재 노드 + 진행률 막대 (에이전트 없는 세션은 그대로)', () => {
    const [s] = agentSessionsFromEvents(
      [
        CREATED,
        ev('node_start', { nodeId: 'plan' }, 2),
        ev('node_end', { nodeId: 'plan', status: 'completed' }, 3),
        ev('node_start', { nodeId: 'build' }, 4),
      ],
      'harness-x',
    );
    const { container } = render(
      <Sidebar
        groups={[
          {
            project: 'harness-x',
            sessions: [
              s!,
              {
                id: 'plain',
                title: '일반 세션',
                status: 'done',
                project: 'harness-x',
                engineId: 'claude-code',
                updatedAt: '2026-11-10T00:00:00Z',
              },
            ],
          },
        ]}
        activeSessionId="dispatch-1"
      />,
    );
    const bar = screen.getByRole('progressbar', { name: '/design-qa 로그인 화면 진행률' });
    expect(bar.getAttribute('aria-valuenow')).toBe('33');
    expect(screen.getByText('▸ build')).toBeTruthy();
    expect(container.querySelector('.hx-session__agent')?.textContent).toBe('🎨');
    expect(container.querySelectorAll('.hx-session__run')).toHaveLength(1);
    expect(container.innerHTML).toMatchSnapshot();
  });
});
