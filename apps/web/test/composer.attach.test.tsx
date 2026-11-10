// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderComposer } from './composer.helpers.js';

afterEach(cleanup);

const composer = () => document.querySelector('.hx-composer')!;

describe('파일 첨부 (드래그앤드롭·붙여넣기 이미지)', () => {
  it('드롭하면 첨부 이벤트 생성, 목록 표시, 전송 페이로드에 포함', () => {
    const { onAttach, onSend } = renderComposer();
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    fireEvent.dragOver(composer());
    expect(composer().hasAttribute('data-drag-over')).toBe(true);
    fireEvent.drop(composer(), { dataTransfer: { files: [file] } });
    expect(composer().hasAttribute('data-drag-over')).toBe(false);
    expect(onAttach).toHaveBeenCalledOnce();
    const ev = onAttach.mock.calls[0]![0];
    expect(ev.type).toBe('attach');
    expect(ev.attachments).toHaveLength(1);
    expect(ev.attachments[0]).toMatchObject({
      name: 'notes.txt',
      mime: 'text/plain',
      size: 5,
      source: 'drop',
    });
    expect(screen.getByText('notes.txt')).toBeTruthy();

    // 첨부만 있어도 전송 가능
    fireEvent.click(screen.getByLabelText('전송'));
    expect(onSend.mock.calls[0]![0].attachments.map((a: { name: string }) => a.name)).toEqual(['notes.txt']);
    expect(screen.queryByText('notes.txt')).toBeNull();
  });

  it('이미지 붙여넣기 → 첨부, 텍스트 붙여넣기는 무시', () => {
    const { onAttach } = renderComposer();
    const input = screen.getByLabelText('지시 입력');
    const png = new File([new Uint8Array([137, 80, 78, 71])], '', { type: 'image/png' });
    fireEvent.paste(input, {
      clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => png }], files: [] },
    });
    expect(onAttach).toHaveBeenCalledOnce();
    expect(onAttach.mock.calls[0]![0].attachments[0]).toMatchObject({
      name: '붙여넣은 이미지.png',
      mime: 'image/png',
      source: 'paste',
    });
    fireEvent.paste(input, {
      clipboardData: { items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }], files: [] },
    });
    expect(onAttach).toHaveBeenCalledOnce();
  });

  it('× 로 첨부 빼기', () => {
    renderComposer();
    fireEvent.drop(composer(), {
      dataTransfer: { files: [new File(['a'], 'a.png', { type: 'image/png' })] },
    });
    fireEvent.click(screen.getByLabelText('a.png 첨부 빼기'));
    expect(screen.queryByText('a.png')).toBeNull();
  });
});
