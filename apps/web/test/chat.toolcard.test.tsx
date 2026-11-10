// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockView } from '../src/chat/BlockView.js';
import { eventsToBlocks } from '../src/chat/blocks.js';
import { NINE_EVENTS } from './fixtures/events.js';

afterEach(cleanup);

describe('도구 카드 접기/펼치기 + 항목 id 태그', () => {
  it('기본 접힘 → 클릭 시 입력·결과 펼침 → 다시 접힘, 오른쪽에 #2.1 태그 (스냅샷)', () => {
    const tool = eventsToBlocks(NINE_EVENTS.slice(2, 4))[0]!;
    const { container } = render(<BlockView block={tool} />);
    const toggle = screen.getByRole('button', { expanded: false });
    expect(toggle.textContent).toContain('Bash');
    expect(toggle.textContent).toContain('pnpm test');
    expect(screen.queryByText('Tests 12 passed')).toBeNull();
    const head = container.querySelector('.hx-card__head')!;
    expect(head.lastElementChild?.textContent).toBe('#2.1'); // 카드 우측 끝
    expect(screen.getByLabelText('성공')).toBeTruthy();
    expect(container.innerHTML).toMatchSnapshot('collapsed');

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Tests 12 passed')).toBeTruthy();
    expect(screen.getByText(/"command": "pnpm test"/)).toBeTruthy();
    expect(container.innerHTML).toMatchSnapshot('expanded');

    fireEvent.click(toggle);
    expect(screen.queryByText('Tests 12 passed')).toBeNull();
  });

  it('결과 대기 중·실패 상태, 파일 변경 카드도 diff 접기', () => {
    const pending = eventsToBlocks([NINE_EVENTS[2]!])[0]!;
    render(<BlockView block={pending} />);
    expect(screen.getByLabelText('실행 중')).toBeTruthy();
    cleanup();
    const failed = eventsToBlocks([NINE_EVENTS[2]!, { ...NINE_EVENTS[3]!, ok: false } as never])[0]!;
    render(<BlockView block={failed} />);
    expect(screen.getByLabelText('실패')).toBeTruthy();
    cleanup();
    const file = eventsToBlocks([NINE_EVENTS[4]!])[0]!;
    const { container } = render(<BlockView block={file} />);
    expect(container.querySelector('.hx-diff')).toBeNull();
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(container.querySelector('.hx-diff')?.textContent).toContain('+new');
    expect(screen.getByLabelText('항목 2.1')).toBeTruthy();
  });
});
