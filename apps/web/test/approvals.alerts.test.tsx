// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalsArea } from '../src/panels/Approvals/ApprovalsArea.js';
import { Toasts } from '../src/panels/Approvals/Toasts.js';
import { useApprovals, type NotifierLike } from '../src/panels/Approvals/useApprovals.js';
import { SessionNav } from '../src/shell/SessionNav.js';
import type { SessionSummary } from '../src/shell/types.js';
import { fixtureCard, requestEvent, resolvedEvent } from './approvals-fixtures.js';

const SESSIONS: SessionSummary[] = [
  {
    id: 's-fixture',
    title: '모바일 앱',
    status: 'running',
    project: 'demo',
    engineId: 'codex',
    updatedAt: '',
  },
  { id: 's-other', title: '웹 셸', status: 'idle', project: 'demo', engineId: 'codex', updatedAt: '' },
];

function Harness({ events, notifier }: { events: unknown[]; notifier?: NotifierLike }) {
  const a = useApprovals({ events, baseTitle: 'HARNESS-X', ...(notifier ? { notifier } : {}) });
  const sessions = SESSIONS.map((s) => (a.bySession[s.id] ? { ...s, needsApproval: a.bySession[s.id] } : s));
  return (
    <>
      <SessionNav sessions={sessions} />
      <ApprovalsArea cards={a.pending} variant="panel" />
      <Toasts toasts={a.toasts} onDismiss={a.dismissToast} />
    </>
  );
}

let hidden = false;
beforeEach(() => {
  hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  document.title = '';
});

function fakeNotifier(permission: NotificationPermission, answer: NotificationPermission = 'granted') {
  const n = {
    permission,
    shown: [] as { title: string; body: string }[],
    asked: 0,
    requestPermission: vi.fn(async () => {
      n.asked++;
      n.permission = answer;
      return answer;
    }),
    show(title: string, body: string) {
      n.shown.push({ title, body });
    },
  };
  return n;
}

describe('H.12 카드 생성 시 토스트 + 사이드바 "확인 필요" 배지 + 탭 제목 "(1)"', () => {
  it('3곳 표시, 처리되면 사라짐', () => {
    const card = fixtureCard('path-1');
    const { rerender } = render(<Harness events={[]} />);
    expect(document.title).toBe('HARNESS-X');
    expect(screen.queryByTestId('session-needs-approval')).toBeNull();

    rerender(<Harness events={[requestEvent(card)]} />);
    // ① 토스트
    const toast = screen.getByRole('status', { name: '알림' });
    expect(toast.textContent).toContain('확인이 필요해요 — 계획에는 "하네스/모바일" 폴더에');
    // ② 사이드바 세션 배지 (그 세션에만)
    const badges = screen.getAllByTestId('session-needs-approval');
    expect(badges).toHaveLength(1);
    expect(badges[0]!.textContent).toBe('확인 필요');
    expect(badges[0]!.closest('button')?.textContent).toContain('모바일 앱');
    // ③ 탭 제목
    expect(document.title).toBe('(1) HARNESS-X');

    rerender(<Harness events={[requestEvent(card), requestEvent(fixtureCard('text-1'))]} />);
    expect(document.title).toBe('(2) HARNESS-X');

    rerender(
      <Harness
        events={[
          requestEvent(card),
          requestEvent(fixtureCard('text-1')),
          resolvedEvent(card),
          resolvedEvent(fixtureCard('text-1')),
        ]}
      />,
    );
    expect(document.title).toBe('HARNESS-X');
    expect(screen.queryByTestId('session-needs-approval')).toBeNull();
  });

  it('토스트를 누르면 닫힌다', () => {
    const { rerender } = render(<Harness events={[]} />);
    rerender(<Harness events={[requestEvent(fixtureCard('path-1'))]} />);
    fireEvent.click(screen.getByRole('button', { name: /확인이 필요해요 — / }));
    expect(screen.queryByRole('status', { name: '알림' })).toBeNull();
  });
});

describe('H.13 브라우저가 백그라운드면 OS 알림 (첫 1회 권한 요청) — 자동 확인 부분', () => {
  it('보이는 탭이면 OS 알림 없음', () => {
    const n = fakeNotifier('granted');
    const { rerender } = render(<Harness events={[]} notifier={n} />);
    rerender(<Harness events={[requestEvent(fixtureCard('path-1'))]} notifier={n} />);
    expect(n.shown).toEqual([]);
  });

  it('백그라운드: 처음 한 번만 권한을 묻고, 허락되면 알림', async () => {
    hidden = true;
    const n = fakeNotifier('default', 'granted');
    const { rerender } = render(<Harness events={[]} notifier={n} />);
    await act(async () => {
      rerender(<Harness events={[requestEvent(fixtureCard('path-1'))]} notifier={n} />);
    });
    expect(n.asked).toBe(1);
    expect(n.shown).toEqual([{ title: '확인이 필요해요', body: fixtureCard('path-1').whatHappened }]);
    await act(async () => {
      rerender(
        <Harness
          events={[requestEvent(fixtureCard('path-1')), requestEvent(fixtureCard('text-1'))]}
          notifier={n}
        />,
      );
    });
    expect(n.asked).toBe(1);
    expect(n.shown).toHaveLength(2);
  });

  it('거절했으면 다시 묻지 않는다', async () => {
    hidden = true;
    const n = fakeNotifier('default', 'denied');
    const { rerender } = render(<Harness events={[]} notifier={n} />);
    await act(async () => {
      rerender(<Harness events={[requestEvent(fixtureCard('path-1'))]} notifier={n} />);
    });
    n.permission = 'default'; // 브라우저가 다시 default로 돌려도 1회 기록이 있으면 묻지 않음
    await act(async () => {
      rerender(
        <Harness
          events={[requestEvent(fixtureCard('path-1')), requestEvent(fixtureCard('text-1'))]}
          notifier={n}
        />,
      );
    });
    expect(n.asked).toBe(1);
    expect(n.shown).toEqual([]);
  });
});
