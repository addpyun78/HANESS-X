import { fireEvent } from '@testing-library/react';
import { expect, it, type Mock } from 'vitest';

/**
 * 멀티라인 입력·Enter 전송·한글 IME 케이스 (T-033 지시 입력창).
 * 지시 입력창을 재사용하는 화면(빌더 대화 탭 P4-B.3)도 같은 케이스를 통과해야 한다.
 */
export interface ImeTarget {
  /** 화면을 그리고 전송 콜백과 입력창을 돌려준다 */
  render(): { onSend: Mock; input: () => HTMLTextAreaElement };
  /** 전송된 글 (호출 인자에서) */
  sentText(call: unknown[]): string;
}

export function imeCases(t: ImeTarget) {
  it('Enter 전송 후 입력창 비움, 빈 입력은 전송 안 함', () => {
    const { onSend, input } = t.render();
    const type = (v: string) => fireEvent.change(input(), { target: { value: v } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
    type('  테스트를 실행해  ');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onSend).toHaveBeenCalledOnce();
    expect(t.sentText(onSend.mock.calls[0]!)).toBe('테스트를 실행해');
    expect(input().value).toBe('');
  });

  it('Shift+Enter는 줄바꿈(전송 안 함), 멀티라인 그대로 전송', () => {
    const { onSend, input } = t.render();
    const type = (v: string) => fireEvent.change(input(), { target: { value: v } });
    type('첫 줄');
    const ev = fireEvent.keyDown(input(), { key: 'Enter', shiftKey: true });
    expect(ev).toBe(true); // 기본 동작(줄바꿈) 막지 않음
    expect(onSend).not.toHaveBeenCalled();
    type('첫 줄\n둘째 줄');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(t.sentText(onSend.mock.calls[0]!)).toBe('첫 줄\n둘째 줄');
  });

  it('한글 IME 조합 중 Enter 무시 (isComposing / compositionstart~end / keyCode 229)', () => {
    const { onSend, input } = t.render();
    const type = (v: string) => fireEvent.change(input(), { target: { value: v } });
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
    expect(t.sentText(onSend.mock.calls[0]!)).toBe('안녕하세요');
  });
}
