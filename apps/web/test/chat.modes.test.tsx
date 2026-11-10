// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChatStream } from '../src/chat/ChatStream.js';
import { eventsToBlocks, visibleBlocks, type ViewMode } from '../src/chat/blocks.js';
import { NINE_EVENTS, STOP_BLOCK_EVENT } from './fixtures/events.js';
import { mockChatLayout } from './layout-mock.js';

let restore = () => {};
beforeEach(() => {
  restore = mockChatLayout({ viewport: { width: 800, height: 4000 } });
});
afterEach(() => {
  cleanup();
  restore();
});

const EVENTS = [...NINE_EVENTS, STOP_BLOCK_EVENT];

describe('보기 모드 3단 (자세히·보통·요약)', () => {
  it('모드별 표시 블록 수', () => {
    const blocks = eventsToBlocks(EVENTS);
    // text, tool, file, usage, error, approval, checklist, turn_end, stop_block
    expect(blocks).toHaveLength(9);
    expect(visibleBlocks(blocks, 'verbose')).toHaveLength(9);
    // 보통: 사용량·체크리스트 변경·일반 턴 종료 숨김
    expect(visibleBlocks(blocks, 'normal').map((b) => b.kind)).toEqual([
      'text',
      'tool',
      'file',
      'error',
      'approval',
      'stop_block',
    ]);
    // 요약: 텍스트·오류·승인·종료 차단만
    expect(visibleBlocks(blocks, 'summary').map((b) => b.kind)).toEqual([
      'text',
      'error',
      'approval',
      'stop_block',
    ]);
  });

  it('UI 전환 시 렌더되는 블록 수가 바뀐다', () => {
    function Harness() {
      const [mode, setMode] = useState<ViewMode>('normal');
      return (
        <ChatStream
          events={EVENTS}
          mode={mode}
          onModeChange={setMode}
          initialRect={{ width: 800, height: 4000 }}
        />
      );
    }
    const { container } = render(<Harness />);
    const rows = () => container.querySelectorAll('.hx-chat__row').length;
    expect(screen.getByRole('radio', { checked: true }).textContent).toBe('보통');
    expect(rows()).toBe(6);
    fireEvent.click(screen.getByText('자세히'));
    expect(rows()).toBe(9);
    fireEvent.click(screen.getByText('요약'));
    expect(rows()).toBe(4);
    expect(screen.getByTestId('block-count').textContent).toBe('블록 4개');
  });
});
