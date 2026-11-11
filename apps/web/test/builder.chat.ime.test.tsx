// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BuilderChat } from '../src/builder/chat/BuilderChat.js';
import { imeCases } from './ime-cases.js';

afterEach(cleanup);

const input = () => screen.getByLabelText('설명 입력') as HTMLTextAreaElement;

describe('P4-B.3 대화 탭 입력: 지시 입력창(Composer) 재사용 — IME 테스트 재사용', () => {
  imeCases({
    render: () => {
      const onSend = vi.fn();
      render(<BuilderChat onSend={onSend} />);
      return { onSend, input };
    },
    sentText: (call) => call[0] as string,
  });

  it('같은 컴포넌트: hx-composer 입력창, 엔진·권한 칩·판정 줄은 숨김', () => {
    const { container } = render(<BuilderChat />);
    const composer = container.querySelector('.hx-composer') as HTMLElement;
    expect(within(composer).getByLabelText('설명 입력').classList).toContain('hx-composer__input');
    expect(container.querySelector('.hx-chip--engine')).toBeNull();
    expect(container.querySelector('.hx-chip--permission')).toBeNull();
    expect(container.querySelector('[data-testid="verdict"]')).toBeNull();
    expect(screen.getByRole('button', { name: '전송' })).toBeTruthy();
  });

  it('보낸 글은 대화 목록에 내 말로 쌓인다', () => {
    render(<BuilderChat />);
    const list = screen.getByRole('list', { name: '대화' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    fireEvent.change(input(), { target: { value: '임장노트 검수 에이전트 만들어 줘' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[1]!.getAttribute('data-role')).toBe('user');
    expect(items[1]!.textContent).toContain('임장노트 검수 에이전트 만들어 줘');
  });
});
