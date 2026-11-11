// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BuilderChat } from '../src/builder/chat/BuilderChat.js';
import { fakeStt } from './stt-fake.js';

afterEach(cleanup);

const input = () => screen.getByLabelText('설명 입력') as HTMLTextAreaElement;
const flush = () => act(async () => {});

describe('P4-B.9 변환된 글은 입력창에 채우기만 (자동 전송 0회)', () => {
  it('말 → 입력창 채움 → 사용자가 고친 뒤 전송', async () => {
    const onSend = vi.fn();
    const stt = fakeStt({ finalOnStop: '검사는 claude로 바꿔 줘' });
    render(<BuilderChat stt={stt} onSend={onSend} />);
    fireEvent.click(screen.getByRole('button', { name: '말로 입력' }));
    await flush();
    act(() => stt.say('임장노트 화면 디자인을 검수해 주는 에이전트 만들어 줘'));
    expect(input().value).toBe('임장노트 화면 디자인을 검수해 주는 에이전트 만들어 줘');
    fireEvent.click(screen.getByRole('button', { name: '녹음 끝내기' }));
    await flush();
    // 이어진 말은 뒤에 붙는다
    expect(input().value).toBe(
      '임장노트 화면 디자인을 검수해 주는 에이전트 만들어 줘 검사는 claude로 바꿔 줘',
    );
    expect(onSend).toHaveBeenCalledTimes(0);
    expect(screen.getAllByRole('listitem')).toHaveLength(1); // 대화 목록에도 안 올라감

    // 사용자가 고친 뒤 직접 전송
    fireEvent.change(input(), { target: { value: '임장노트 화면 검수 에이전트, 검사는 claude로' } });
    expect(onSend).toHaveBeenCalledTimes(0);
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('임장노트 화면 검수 에이전트, 검사는 claude로');
  });

  it('사용자가 쓰던 글 뒤에 이어 붙이고, 같은 문장이 두 번 와도 보내지 않음', async () => {
    const onSend = vi.fn();
    const stt = fakeStt();
    render(<BuilderChat stt={stt} onSend={onSend} />);
    fireEvent.change(input(), { target: { value: '앱 이름은 임장노트.' } });
    fireEvent.click(screen.getByRole('button', { name: '말로 입력' }));
    await flush();
    act(() => stt.say('디자인 검수'));
    act(() => stt.say('디자인 검수'));
    expect(input().value).toBe('앱 이름은 임장노트. 디자인 검수 디자인 검수');
    expect(onSend).not.toHaveBeenCalled();
  });
});
