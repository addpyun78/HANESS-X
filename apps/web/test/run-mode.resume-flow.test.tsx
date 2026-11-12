// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResumeFlow, type ResumeApi } from '../src/recovery/ResumeFlow.js';

afterEach(cleanup);

function api() {
  const start = vi.fn(async () => ({ mode: 'summary', version: 'pinned' }));
  const a: ResumeApi = {
    check: async () => ({
      ok: false,
      issues: [
        {
          check: 'files',
          title: '멈춘 뒤에 파일이 바뀌었어요',
          body: '멈춘 뒤에 파일 1개가 바뀌었어요. 어떻게 이어할까요?',
          list: ['a.ts (고쳐짐)'],
          choices: [{ id: 'keep', label: '바뀐 걸 반영해서 계속', recommended: true, default: true }],
        },
      ],
    }),
    start,
  };
  return { a, start };
}

// T-101 3E.6 이어하기 카드에서 모드 유지·변경
describe('3E.6 이어하기 카드의 모드', () => {
  it('기본은 멈추기 전 모드 유지 (runMode를 보내지 않음)', async () => {
    const { a, start } = api();
    render(<ResumeFlow api={a} sessionId="s1" sessionMode="auto" />);
    await screen.findByText('멈춘 뒤에 파일이 바뀌었어요');
    expect(screen.getByLabelText('모드: 오토')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '이 선택으로 이어하기' }));
    await waitFor(() => expect(start).toHaveBeenCalledWith('s1', { files: 'keep' }));
  });

  it('카드에서 일반으로 바꾸면 그 모드로 이어함', async () => {
    const { a, start } = api();
    render(<ResumeFlow api={a} sessionId="s1" sessionMode="auto" />);
    await screen.findByText('멈춘 뒤에 파일이 바뀌었어요');
    fireEvent.click(screen.getByLabelText('모드: 오토'));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^일반/ }));
    fireEvent.click(screen.getByRole('button', { name: '이 선택으로 이어하기' }));
    await waitFor(() => expect(start).toHaveBeenCalledWith('s1', { files: 'keep', runMode: 'normal' }));
  });
});
