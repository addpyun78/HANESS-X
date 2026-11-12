// @vitest-environment jsdom
// @features F-095
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SentMessage, toSentAttachments } from '../src/chat/SentMessage.js';

afterEach(cleanup);
beforeEach(() => {
  // jsdom에는 object URL이 없다
  URL.createObjectURL = vi.fn((f: Blob) => `blob:${(f as File).name}`);
  URL.revokeObjectURL = vi.fn();
});

const file = (name: string, type: string, body = 'x') => new File([body], name, { type });

describe('1E.6 보낸 메시지에 첨부 썸네일·이름 기록', () => {
  it('스냅샷', () => {
    const sent = toSentAttachments(
      [
        { id: '1', name: '화면.png', mime: 'image/png', size: 2048, file: file('화면.png', 'image/png') },
        { id: '2', name: '기획서.hwpx', mime: '', size: 4096 },
        {
          id: '3',
          name: '보고서.pdf',
          mime: 'application/pdf',
          size: 10,
          previewUrl: '/api/att/3/page-1.jpg',
        },
      ],
      (f) => `blob:${f.name}`,
    );
    const { container } = render(<SentMessage text="이대로 만들어 주세요" attachments={sent} />);
    expect(screen.getByRole('img', { name: '화면.png' }).getAttribute('src')).toBe('blob:화면.png');
    expect(screen.getByText('기획서.hwpx')).toBeTruthy();
    expect(container.innerHTML).toMatchSnapshot();
  });
});
