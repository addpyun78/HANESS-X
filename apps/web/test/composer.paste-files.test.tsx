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

describe('1E.2 붙여넣기(Ctrl+V)로 이미지·파일 첨부', () => {
  it('이미지와 일반 파일 모두 첨부, 글 붙여넣기는 그대로 입력', () => {
    const { onAttach } = renderComposer();
    const input = screen.getByLabelText('지시 입력');
    const png = file('', 'image/png');
    const pdf = file('보고서.pdf', 'application/pdf');
    fireEvent.paste(input, {
      clipboardData: {
        items: [
          { kind: 'file', type: 'image/png', getAsFile: () => png },
          { kind: 'file', type: 'application/pdf', getAsFile: () => pdf },
        ],
        files: [],
      },
    });
    expect(onAttach).toHaveBeenCalledOnce();
    expect(
      onAttach.mock.calls[0]![0].attachments.map((a: { name: string; source: string }) => [a.name, a.source]),
    ).toEqual([
      ['붙여넣은 이미지.png', 'paste'],
      ['보고서.pdf', 'paste'],
    ]);
    // 탐색기에서 복사한 파일은 files로만 오기도 한다
    fireEvent.paste(input, { clipboardData: { items: [], files: [file('표.xlsx', '')] } });
    expect(onAttach).toHaveBeenCalledTimes(2);
    fireEvent.paste(input, {
      clipboardData: { items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }], files: [] },
    });
    expect(onAttach).toHaveBeenCalledTimes(2);
  });
});
