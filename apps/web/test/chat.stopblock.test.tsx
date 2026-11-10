// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChatStream } from '../src/chat/ChatStream.js';
import { eventsToBlocks } from '../src/chat/blocks.js';
import { STOP_BLOCK_EVENT } from './fixtures/events.js';
import { mockChatLayout } from './layout-mock.js';

let restore = () => {};
beforeEach(() => {
  restore = mockChatLayout();
});
afterEach(() => {
  cleanup();
  restore();
});

describe('"종료 차단" 카드', () => {
  it('stop block 이벤트(turn_end reason=blocked)로 노란 카드: 남은 항목 수·다음 항목', () => {
    expect(eventsToBlocks([STOP_BLOCK_EVENT])[0]).toMatchObject({
      kind: 'stop_block',
      remaining: 3,
      nextItemId: '2.2',
    });
    const { container } = render(
      <ChatStream events={[STOP_BLOCK_EVENT]} mode="summary" initialRect={{ width: 800, height: 600 }} />,
    );
    const card = screen.getByRole('alert', { name: '종료 차단' });
    expect(card.className).toBe('hx-stop-block');
    expect(screen.getByTestId('stop-remaining').textContent).toBe('남은 항목 3개');
    expect(screen.getByTestId('stop-next').textContent).toContain('2.2');
    expect(screen.getByTestId('stop-next').textContent).toContain('로그인 폼 검증 추가');
    expect(container.querySelector('.hx-stop-block')?.outerHTML).toMatchSnapshot();
  });

  it('확장 필드가 없어도 카드는 뜬다', () => {
    const bare = { ...STOP_BLOCK_EVENT } as Record<string, unknown>;
    delete bare.remaining;
    delete bare.nextItemId;
    delete bare.nextItemTitle;
    render(<ChatStream events={[bare as never]} mode="normal" initialRect={{ width: 800, height: 600 }} />);
    expect(screen.getByRole('alert', { name: '종료 차단' })).toBeTruthy();
    expect(screen.queryByTestId('stop-remaining')).toBeNull();
  });
});
