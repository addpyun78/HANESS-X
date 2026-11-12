// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAlertPrefs } from '../src/panels/Approvals/alert-prefs.js';
import { useApprovals, type NotifierLike } from '../src/panels/Approvals/useApprovals.js';
import { SettingsScreen } from '../src/settings/SettingsScreen.js';
import { fixtureCard, requestEvent } from './approvals-fixtures.js';
import { memorySettings } from './settings-form-fixtures.js';
import { keysIn } from './settings-screen-fixtures.js';

/**
 * T-101 6B.6 승인·알림 탭: 컴퓨터 알림·다시 알림 간격·소리 (이 기기 화면에만) — 고른 값이 실제 알림 동작(useApprovals)에 쓰인다
 */

let hidden = true;
beforeEach(() => {
  hidden = true;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

function notifier(): NotifierLike & { shown: string[] } {
  const shown: string[] = [];
  return {
    permission: 'granted',
    requestPermission: async () => 'granted',
    show: (_t, body) => void shown.push(body),
    shown,
  };
}

describe('6B.6 승인·알림', () => {
  it('컴퓨터 알림·다시 알림 간격·소리가 보이고 고르면 이 기기 저장소에 남는다 (스냅샷)', async () => {
    const m = memorySettings();
    render(<SettingsScreen api={m.api} initialTab="approval" onBrowserChange={() => {}} />);
    const sec = await screen.findByRole('region', { name: '승인·알림' });
    expect(keysIn(sec)).toEqual(['approval.osNotify', 'approval.remindMinutes', 'approval.sound']);
    expect(sec).toMatchSnapshot();
    fireEvent.change(within(sec).getByLabelText('컴퓨터 알림'), { target: { value: 'off' } });
    fireEvent.change(within(sec).getByLabelText('다시 알림 간격'), { target: { value: '5' } });
    fireEvent.change(within(sec).getByLabelText('알림 소리'), { target: { value: 'on' } });
    expect(loadAlertPrefs()).toEqual({ osNotify: false, remindMinutes: 5, sound: true });
    m.dispose();
  });

  it('컴퓨터 알림을 끄면 알림을 띄우지 않고, 소리를 켜면 소리를 낸다', () => {
    localStorage.setItem('hx.approvals.os-notify', 'off');
    localStorage.setItem('hx.approvals.sound', 'on');
    const n = notifier();
    const chime = vi.fn();
    const { rerender } = renderHook(
      (p: { events: unknown[] }) => useApprovals({ events: p.events, notifier: n, chime }),
      { initialProps: { events: [] as unknown[] } },
    );
    rerender({ events: [requestEvent(fixtureCard('path-1'))] });
    expect(n.shown).toEqual([]);
    expect(chime).toHaveBeenCalledTimes(1);
  });

  it('기본값(알림 켜짐·소리 꺼짐)은 예전과 같고, 다시 알림 5분이면 남은 일을 5분마다 다시 알린다', () => {
    vi.useFakeTimers();
    const n = notifier();
    const chime = vi.fn();
    const { rerender } = renderHook(
      (p: { events: unknown[] }) => useApprovals({ events: p.events, notifier: n, chime }),
      { initialProps: { events: [] as unknown[] } },
    );
    rerender({ events: [requestEvent(fixtureCard('path-1'))] });
    expect(n.shown).toHaveLength(1);
    expect(chime).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(10 * 60_000));
    expect(n.shown).toHaveLength(1); // 다시 알림 기본 = 안 함

    localStorage.setItem('hx.approvals.remind-minutes', '5');
    const n2 = notifier();
    const r2 = renderHook(
      (p: { events: unknown[] }) => useApprovals({ events: p.events, notifier: n2, chime }),
      {
        initialProps: { events: [] as unknown[] },
      },
    );
    r2.rerender({ events: [requestEvent(fixtureCard('path-1'))] });
    expect(n2.shown).toHaveLength(1);
    act(() => vi.advanceTimersByTime(5 * 60_000));
    expect(n2.shown).toEqual([expect.any(String), '확인할 일이 1개 남아 있어요.']);
    hidden = false; // 화면을 보고 있으면 다시 알리지 않음
    act(() => vi.advanceTimersByTime(5 * 60_000));
    expect(n2.shown).toHaveLength(2);
  });
});
