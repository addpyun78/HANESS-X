// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { checkPlainKorean } from './plain-check.js';
import { PAUSE_REASON_LABEL } from '../../../packages/kernel/src/stop.js';
import { agentSessionsFromEvents, fromDispatchSession } from '../src/shell/agent-sessions.js';
import { PAUSED_REASON_LABEL, pausedLabel } from '../src/shell/paused-label.js';
import { Sidebar } from '../src/shell/Sidebar.js';
import type { SessionSummary } from '../src/shell/types.js';

afterEach(cleanup);

const base = (id: string, extra: Partial<SessionSummary>): SessionSummary => ({
  id,
  title: `/qa ${id}`,
  status: 'paused',
  project: 'shop',
  engineId: 'claude-code',
  updatedAt: '2026-11-12T00:00:00Z',
  ...extra,
});

describe('2A.9 사이드바 멈춘 이유 표시', () => {
  it('"멈춤 (사용자가 멈춤)" 등 이유별 표시 (스냅샷)', () => {
    render(
      <Sidebar
        groups={[
          {
            project: 'shop',
            sessions: [
              base('a', { pausedReason: 'user' }),
              base('b', { pausedReason: 'quota' }),
              base('c', {}),
              base('d', { status: 'running' }),
            ],
          },
        ]}
      />,
    );
    const shown = screen.getAllByTestId('session-paused').map((e) => e.textContent);
    expect(shown).toEqual(['⏸ 멈춤 (사용자가 멈춤)', '⏸ 멈춤 (사용량 한도에 닿음)', '⏸ 멈춤']);
    expect(screen.getByLabelText('멈춤 (사용자가 멈춤)')).toBeTruthy();
    expect(screen.getAllByTestId('session-paused')[0]!.closest('button')!.outerHTML).toMatchInlineSnapshot(
      `"<button data-action="sidebar.select-session" type="button" class="hx-session hx-status--paused"><span class="hx-dot" aria-label="멈춤 (사용자가 멈춤)"></span><span class="hx-session__title">/qa a</span><span class="hx-session__engine">claude-code</span><span class="hx-session__paused" data-testid="session-paused">⏸ 멈춤 (사용자가 멈춤)</span></button>"`,
    );
  });

  it('이유 5가지 문구: 커널과 같고 쉬운 말', () => {
    expect(PAUSED_REASON_LABEL).toEqual(PAUSE_REASON_LABEL);
    for (const r of Object.keys(PAUSED_REASON_LABEL)) {
      expect(checkPlainKorean(pausedLabel(r), { label: true }).ok).toBe(true);
    }
    expect(pausedLabel('crash')).toBe('멈춤 (오류로 멈춤)');
    expect(pausedLabel(undefined)).toBe('멈춤');
  });

  it('이벤트 session_paused → 멈춤+이유, session_resumed → 실행 중', () => {
    const ev = [
      { type: 'session_created', sessionId: 's1', ts: '1', command: '/qa', agent: 'qa', nodeCount: 1 },
      {
        type: 'session_paused',
        sessionId: 's1',
        ts: '2',
        paused: { reason: 'approval', at: '2', by: 'kernel' },
      },
    ];
    const [p] = agentSessionsFromEvents(ev, 'shop');
    expect(p).toMatchObject({ status: 'paused', pausedReason: 'approval' });
    const [r] = agentSessionsFromEvents(
      [...ev, { type: 'session_resumed', sessionId: 's1', ts: '3' }],
      'shop',
    );
    expect(r!.status).toBe('running');
    expect(r!.pausedReason).toBeUndefined();
    const d = fromDispatchSession(
      {
        sessionId: 'x',
        agent: { name: 'qa', command: '/qa', displayName: 'QA' },
        prompt: '',
        status: 'paused',
        progress: 0.5,
        startedAt: '1',
        paused: { reason: 'budget' },
      },
      'shop',
    );
    expect(d).toMatchObject({ status: 'paused', pausedReason: 'budget' });
  });
});
