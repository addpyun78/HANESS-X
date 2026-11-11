import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApprovalStore, REMIND_DELAYS_MS } from '../src/store.js';
import { buildCard } from '../src/templates.js';
import { PATH_INPUT, tempDir } from './helpers.js';

const MIN = 60_000;

describe('H.22 자동 승인 금지 — 30분·2시간 뒤 알림 재발송만', () => {
  let t: ReturnType<typeof tempDir>;
  beforeEach(() => {
    t = tempDir();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    t.cleanup();
  });

  it('기본 간격은 30분·2시간', () => {
    expect(REMIND_DELAYS_MS).toEqual([30 * MIN, 120 * MIN]);
  });

  it('하루가 지나도 대기 상태 그대로, 알림만 2번', () => {
    const events: { type: string; detail?: { reminder?: number } }[] = [];
    const reminded: number[] = [];
    const store = createApprovalStore({
      dir: t.dir,
      sessionId: 's1',
      log: { append: (e: never) => events.push(e) },
      onRemind: (_c, n) => reminded.push(n),
    });
    const { card } = store.add(buildCard(PATH_INPUT));
    expect(events.filter((e) => e.type === 'approval_request')).toHaveLength(1);

    vi.advanceTimersByTime(29 * MIN);
    expect(reminded).toEqual([]);
    vi.advanceTimersByTime(1 * MIN);
    expect(reminded).toEqual([1]);
    vi.advanceTimersByTime(90 * MIN);
    expect(reminded).toEqual([1, 2]);
    vi.advanceTimersByTime(24 * 60 * MIN);
    expect(reminded).toEqual([1, 2]);

    expect(store.get(card.id).status).toBe('pending');
    expect(store.records()).toEqual([]);
    expect(events.map((e) => e.type)).toEqual(['approval_request', 'approval_request', 'approval_request']);
    expect(events.map((e) => e.detail?.reminder)).toEqual([undefined, 1, 2]);
    expect(events.some((e) => e.type === 'approval_resolved')).toBe(false);
  });

  it('사람이 결정하면 남은 알림은 취소', () => {
    const reminded: number[] = [];
    const store = createApprovalStore({ dir: t.dir, onRemind: (_c, n) => reminded.push(n) });
    const { card } = store.add(buildCard(PATH_INPUT));
    vi.advanceTimersByTime(30 * MIN);
    store.resolve(card.id, 'stop');
    vi.advanceTimersByTime(3 * 60 * MIN);
    expect(reminded).toEqual([1]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
