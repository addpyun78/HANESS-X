// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Composer } from '../src/composer/Composer.js';
import { ENGINES, renderComposer } from './composer.helpers.js';

afterEach(cleanup);
beforeEach(() => {
  // jsdom에는 object URL이 없다
  URL.createObjectURL = vi.fn((f: Blob) => `blob:${(f as File).name}`);
  URL.revokeObjectURL = vi.fn();
});

const composer = () => document.querySelector('.hx-composer')!;
const file = (name: string, type: string, body = 'x') => new File([body], name, { type });
const drop = (...files: File[]) => fireEvent.drop(composer(), { dataTransfer: { files } });

describe('1E.4 첨부 칩: 종류 아이콘·이름·크기·상태·×, 누르면 미리보기', () => {
  it('서버가 알려 준 상태(바꾸는 중…/✓/⚠)를 칩에 표시', () => {
    const onAttach = vi.fn();
    const props = { engines: ENGINES, onSend: () => {}, onAttach };
    const r = render(<Composer {...props} />);
    drop(file('화면.png', 'image/png'), file('기획.pdf', 'application/pdf'), file('매물.xlsx', ''));
    const ids = onAttach.mock.calls[0]![0].attachments.map((a: { id: string }) => a.id) as string[];
    r.rerender(
      <Composer
        {...props}
        attachmentStatus={{
          [ids[0]!]: { status: 'ready' },
          [ids[1]!]: { status: 'converting' },
          [ids[2]!]: {
            status: 'failed',
            warning: '내용을 바꾸지 못했어요. 원본 파일은 그대로 보낼 수 있어요.',
          },
        }}
      />,
    );
    const status = [...document.querySelectorAll('.hx-attachment__status')].map((e) => e.textContent);
    expect(status).toEqual(['✓', '바꾸는 중…', '⚠']);
    expect(
      document.querySelector('[data-status="failed"] .hx-attachment__status')?.getAttribute('title'),
    ).toContain('원본 파일은 그대로');
  });

  it('칩 모양과 미리보기', async () => {
    renderComposer();
    drop(
      file('화면.png', 'image/png'),
      file('메모.txt', 'text/plain', '첫 줄\n둘째 줄'),
      file('기획.pdf', 'application/pdf'),
      file('매물.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    );
    const list = screen.getByRole('list', { name: '첨부 파일' });
    expect(list.innerHTML).toMatchSnapshot();
    expect([...list.querySelectorAll('li')].map((li) => li.getAttribute('data-kind'))).toEqual([
      'image',
      'text',
      'pdf',
      'sheet',
    ]);
    fireEvent.click(screen.getByLabelText('화면.png 미리보기'));
    await waitFor(() =>
      expect(screen.getByRole('img', { name: '화면.png' }).getAttribute('src')).toBe('blob:화면.png'),
    );
    fireEvent.click(screen.getByLabelText('메모.txt 미리보기'));
    expect(await screen.findByText(/첫 줄/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('기획.pdf 미리보기'));
    await waitFor(() =>
      expect(document.querySelector('object')?.getAttribute('data')).toBe('blob:기획.pdf#page=1'),
    );
    fireEvent.click(screen.getByLabelText('기획.pdf 미리보기'));
    expect(document.querySelector('.hx-attachment-preview')).toBeNull();
    fireEvent.click(screen.getByLabelText('매물.xlsx 첨부 빼기'));
    expect(screen.queryByText('매물.xlsx')).toBeNull();
  });
});
