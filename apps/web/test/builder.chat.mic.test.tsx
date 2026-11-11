// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CONSENT_NOTICE } from '@harness-x/stt-browser';
import { BuilderChat } from '../src/builder/chat/BuilderChat.js';
import { formatElapsed, initialMic, micReducer, type MicState } from '../src/builder/chat/mic.js';
import { fakeStt } from './stt-fake.js';

afterEach(cleanup);

const mic = () => screen.getByRole('button', { name: /말로 입력|녹음 끝내기/ });
const flush = () => act(async () => {});

describe('P4-B.8 마이크 버튼 상태 전환', () => {
  it('상태 기계: idle → starting → recording → stopping → idle', () => {
    let s: MicState = initialMic;
    s = micReducer(s, { type: 'press', needsConsent: false });
    expect(s.phase).toBe('starting');
    expect(micReducer(s, { type: 'press', needsConsent: false }).phase).toBe('starting'); // 처리 중 무시
    s = micReducer(s, { type: 'started', at: 1000 });
    expect(s).toMatchObject({ phase: 'recording', startedAt: 1000 });
    s = micReducer(s, { type: 'level', level: 0.5 });
    s = micReducer(s, { type: 'level', level: 2 });
    expect(s.levels).toEqual([0.5, 1]);
    s = micReducer(s, { type: 'press', needsConsent: false });
    expect(s.phase).toBe('stopping');
    s = micReducer(s, { type: 'stopped' });
    expect(s).toEqual(initialMic);
    expect(micReducer(initialMic, { type: 'error', message: '권한 거부' })).toMatchObject({
      phase: 'idle',
      error: '권한 거부',
    });
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(65_400)).toBe('1:05');
  });

  it('화면: 누르면 녹음(파형·경과 시간), 다시 누르면 종료', async () => {
    const stt = fakeStt();
    let now = 10_000;
    render(<BuilderChat stt={stt} />);
    expect(mic().getAttribute('aria-label')).toBe('말로 입력');
    expect(mic().getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByTestId('mic-wave')).toBeNull();

    // MicButton은 BuilderChat 안에서 Date.now를 쓰므로 시계를 바꿔 경과 시간을 확인
    const realNow = Date.now;
    Date.now = () => now;
    try {
      fireEvent.click(mic());
      await flush();
      expect(stt.start).toHaveBeenCalledOnce();
      expect(mic().getAttribute('aria-label')).toBe('녹음 끝내기');
      expect(mic().getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByTestId('mic-wave').children).toHaveLength(16);
      expect(screen.getByTestId('mic-elapsed').textContent).toBe('0:00');
      act(() => stt.level(0.8));
      const last = screen.getByTestId('mic-wave').lastElementChild as HTMLElement;
      expect(last.style.height).toBe('83%');
      now += 3_000;
      act(() => stt.partial('임장노트'));
      expect(screen.getByTestId('mic-elapsed').textContent).toBe('0:03');
      expect(screen.getByText('임장노트')).toBeTruthy();

      fireEvent.click(mic());
      await flush();
      expect(stt.stop).toHaveBeenCalledOnce();
      expect(mic().getAttribute('aria-label')).toBe('말로 입력');
      expect(screen.queryByTestId('mic-wave')).toBeNull();
    } finally {
      Date.now = realNow;
    }
  });

  it('시작 실패(마이크 권한 거부)는 쉬운 말 오류 + 처음 상태', async () => {
    const stt = fakeStt();
    stt.start.mockRejectedValueOnce(new Error('마이크를 쓸 수 없어요'));
    render(<BuilderChat stt={stt} />);
    fireEvent.click(mic());
    await flush();
    expect(screen.getByRole('alert').textContent).toBe('마이크를 쓸 수 없어요');
    expect(mic().getAttribute('aria-pressed')).toBe('false');
  });

  it('STT가 없으면(설정 off) 마이크 버튼 없음', () => {
    render(<BuilderChat />);
    expect(screen.queryByRole('button', { name: '말로 입력' })).toBeNull();
  });
});

describe('P4-B.6 브라우저 음성 인식 첫 사용 동의 (화면)', () => {
  it('동의 전 녹음 시작 안 됨 → 안내 + [동의하고 녹음] 후 시작', async () => {
    const stt = fakeStt({ needsConsent: true });
    render(<BuilderChat stt={stt} />);
    fireEvent.click(mic());
    await flush();
    const dialog = screen.getByRole('dialog', { name: '음성 입력 동의' });
    expect(dialog.textContent).toContain(CONSENT_NOTICE);
    expect(CONSENT_NOTICE).toBe('목소리가 브라우저 회사 서버로 전송될 수 있어요');
    expect(stt.start).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    await flush();
    expect(stt.start).not.toHaveBeenCalled();
    expect(stt.grantConsent).not.toHaveBeenCalled();

    fireEvent.click(mic());
    fireEvent.click(screen.getByRole('button', { name: '동의하고 녹음' }));
    await flush();
    expect(stt.grantConsent).toHaveBeenCalledOnce();
    expect(stt.start).toHaveBeenCalledOnce();
    expect(mic().getAttribute('aria-pressed')).toBe('true');

    // 두 번째부터는 묻지 않음
    fireEvent.click(mic());
    await flush();
    fireEvent.click(mic());
    await flush();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(stt.start).toHaveBeenCalledTimes(2);
  });
});
