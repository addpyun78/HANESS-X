// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderComposer } from './composer.helpers.js';

afterEach(cleanup);
beforeEach(() => {
  // jsdom에는 object URL이 없다
  URL.createObjectURL = vi.fn((f: Blob) => `blob:${(f as File).name}`);
  URL.revokeObjectURL = vi.fn();
});

const file = (name: string, type: string, body = 'x') => new File([body], name, { type });

describe('1E.3 + 메뉴 "파일 첨부" → 파일 선택 창(여러 개)', () => {
  it('여러 개 고르면 모두 첨부', () => {
    const { onAttach } = renderComposer({ plusMenu: { recent: [] } });
    const input = screen.getByTestId('attach-input') as HTMLInputElement;
    expect(input.multiple).toBe(true);
    const click = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByLabelText('추가'));
    fireEvent.click(screen.getByRole('menuitem', { name: /파일 첨부/ }));
    expect(click).toHaveBeenCalledOnce();
    fireEvent.change(input, {
      target: { files: [file('a.hwpx', ''), file('b.png', 'image/png'), file('c.txt', 'text/plain')] },
    });
    expect(onAttach.mock.calls[0]![0].attachments.map((a: { name: string }) => a.name)).toEqual([
      'a.hwpx',
      'b.png',
      'c.txt',
    ]);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });
});
