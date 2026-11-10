// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderComposer } from './composer.helpers.js';

afterEach(cleanup);

const input = () => screen.getByLabelText('지시 입력') as HTMLTextAreaElement;
const type = (v: string) => fireEvent.change(input(), { target: { value: v } });

describe('멀티라인 입력·Enter 전송·IME', () => {
  it('Enter 전송 후 입력창 비움, 빈 입력은 전송 안 함', () => {
    const { onSend } = renderComposer();
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
    type('  테스트를 실행해  ');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onSend).toHaveBeenCalledOnce();
    expect(onSend.mock.calls[0]![0].text).toBe('테스트를 실행해');
    expect(input().value).toBe('');
  });

  it('Shift+Enter는 줄바꿈(전송 안 함), 멀티라인 그대로 전송', () => {
    const { onSend } = renderComposer();
    type('첫 줄');
    const ev = fireEvent.keyDown(input(), { key: 'Enter', shiftKey: true });
    expect(ev).toBe(true); // 기본 동작(줄바꿈) 막지 않음
    expect(onSend).not.toHaveBeenCalled();
    type('첫 줄\n둘째 줄');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onSend.mock.calls[0]![0].text).toBe('첫 줄\n둘째 줄');
  });

  it('한글 IME 조합 중 Enter 무시 (isComposing / compositionstart~end / keyCode 229)', () => {
    const { onSend } = renderComposer();
    type('안녕하세');
    // 1) KeyboardEvent.isComposing
    expect(fireEvent.keyDown(input(), { key: 'Enter', isComposing: true })).toBe(true);
    // 2) compositionstart ~ compositionend 사이
    fireEvent.compositionStart(input());
    fireEvent.keyDown(input(), { key: 'Enter' });
    // 3) 일부 브라우저: keyCode 229
    fireEvent.keyDown(input(), { key: 'Enter', keyCode: 229 });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input());
    type('안녕하세요');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onSend).toHaveBeenCalledOnce();
    expect(onSend.mock.calls[0]![0].text).toBe('안녕하세요');
  });
});
