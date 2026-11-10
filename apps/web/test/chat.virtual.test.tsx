// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChatStream } from '../src/chat/ChatStream.js';
import { manyEvents } from './fixtures/events.js';
import { mockChatLayout } from './layout-mock.js';

let restore = () => {};
beforeEach(() => {
  restore = mockChatLayout({ viewport: { width: 800, height: 600 }, rowHeight: 40 });
});
afterEach(() => {
  cleanup();
  restore();
});

describe('가상 스크롤 (이벤트 5,000개)', () => {
  it('보이는 블록만 DOM에 두고, 스크롤하면 창이 이동한다', async () => {
    const events = manyEvents(5000);
    const t0 = performance.now();
    const { container } = render(
      <ChatStream
        events={events}
        mode="verbose"
        estimateSize={40}
        initialRect={{ width: 800, height: 600 }}
      />,
    );
    const renderMs = performance.now() - t0;
    // tool_call+tool_result가 짝지어져 블록은 4,000개
    expect(screen.getByTestId('block-count').textContent).toBe('블록 4,000개');
    const rows = () => [...container.querySelectorAll<HTMLElement>('.hx-chat__row')];
    // 600px / 40px = 15개 + overscan → 수십 개만
    expect(rows().length).toBeGreaterThan(0);
    expect(rows().length).toBeLessThan(60);
    const inner = container.querySelector<HTMLElement>('.hx-chat__inner')!;
    expect(parseInt(inner.style.height)).toBeGreaterThanOrEqual(4000 * 40 * 0.9);

    // 맨 아래 따라가기: 마지막 블록 근처가 렌더됨
    const scroll = screen.getByTestId('chat-scroll');
    const lastIdx = () => Math.max(...rows().map((r) => Number(r.dataset.index)));
    await waitFor(() => expect(lastIdx()).toBe(3999));

    // 중간으로 스크롤
    await act(async () => {
      scroll.scrollTop = 2000 * 40;
      fireEvent.scroll(scroll);
      await new Promise((r) => setTimeout(r, 30));
    });
    const idx = rows().map((r) => Number(r.dataset.index));
    expect(Math.min(...idx)).toBeGreaterThan(1900);
    expect(Math.max(...idx)).toBeLessThan(2100);
    expect(rows().length).toBeLessThan(60);

    // 참고용 측정값 (jsdom, 레이아웃 없음) — 실제 60fps 여부는 브라우저에서 사람이 확인
    console.info(`[32.5] 5,000 이벤트 첫 렌더 ${renderMs.toFixed(0)}ms, DOM 행 ${rows().length}개`);
    expect(renderMs).toBeLessThan(5000);
  });
});
