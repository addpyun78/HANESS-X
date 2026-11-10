// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { HarnessApiClient } from '../src/api/client.js';
import { LOGIN_COMMANDS } from '../src/panels/login-commands.js';
import { TerminalPanel, type CreateTerminalView, type TerminalView } from '../src/panels/TerminalPanel.js';
import type { TerminalSocket } from '../src/panels/terminal-session.js';

afterEach(cleanup);

class FakeSocket implements TerminalSocket {
  readyState = 0;
  sent: unknown[] = [];
  closed = false;
  onopen: TerminalSocket['onopen'] = null;
  onmessage: TerminalSocket['onmessage'] = null;
  onclose: TerminalSocket['onclose'] = null;
  onerror: TerminalSocket['onerror'] = null;
  send(d: string) {
    this.sent.push(JSON.parse(d));
  }
  close() {
    this.closed = true;
  }
  open() {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }
  emit(m: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(m) }));
  }
}

function fakeView() {
  const written: string[] = [];
  let input: ((d: string) => void) | undefined;
  const view: TerminalView = {
    write: (d) => void written.push(d),
    onData: (cb) => void (input = cb),
    size: () => ({ cols: 100, rows: 30 }),
    dispose: () => {},
  };
  const create: CreateTerminalView = async () => view;
  return { create, written, type: (d: string) => input?.(d) };
}

async function mount(loginEngines = [{ id: 'codex', label: 'Codex' }]) {
  const sock = new FakeSocket();
  const sizes: { cols: number; rows: number }[] = [];
  const v = fakeView();
  render(
    <TerminalPanel
      connect={(s) => {
        sizes.push(s);
        return sock;
      }}
      loginEngines={loginEngines}
      createView={v.create}
    />,
  );
  await act(async () => {});
  return { sock, sizes, v };
}

describe('37.2 터미널 패널 (xterm.js ↔ /ws/terminal)', () => {
  it('터미널 크기로 연결, 출력은 화면에, 키 입력은 서버로; ready의 cwd 표시', async () => {
    const { sock, sizes, v } = await mount();
    expect(sizes).toEqual([{ cols: 100, rows: 30 }]);
    v.type('p'); // 열리기 전 입력은 대기열
    expect(sock.sent).toEqual([]);
    act(() => {
      sock.open();
      sock.emit({ type: 'ready', cwd: '/work/space', shell: 'bash' });
      sock.emit({ type: 'output', data: '/work/space\r\n' });
    });
    expect(sock.sent).toEqual([{ type: 'input', data: 'p' }]);
    expect(v.written).toEqual(['/work/space\r\n']);
    expect(screen.getByRole('status').textContent).toBe('연결됨 · /work/space');
    act(() => sock.emit({ type: 'exit', exitCode: 0 }));
    expect(screen.getByRole('status').textContent).toContain('종료됨');
  });

  it('API 클라이언트 터미널 주소: ws + token + cols/rows', () => {
    const c = new HarnessApiClient({ baseUrl: 'http://127.0.0.1:3790', token: 't k' });
    expect(c.terminalUrl({ cols: 80, rows: 24 })).toBe(
      'ws://127.0.0.1:3790/ws/terminal?token=t+k&cols=80&rows=24',
    );
  });
});

describe('37.3 터미널에서 로그인', () => {
  it('버튼 → 이 터미널에 공식 로그인 명령(codex login) 실행', async () => {
    const { sock } = await mount();
    const btn = screen.getByRole('button', { name: '터미널에서 로그인' });
    expect((btn as HTMLButtonElement).disabled).toBe(true); // 연결 전
    act(() => {
      sock.open();
      sock.emit({ type: 'ready', cwd: '/w' });
    });
    fireEvent.click(btn);
    expect(sock.sent).toEqual([{ type: 'input', data: 'codex login\r' }]);
  });

  it('엔진 선택 → 그 엔진의 공식 명령, 명령 없는 엔진은 목록에서 제외', async () => {
    const { sock } = await mount([
      { id: 'codex', label: 'Codex' },
      { id: 'claude-code', label: 'Claude Code' },
      { id: 'openai-compat', label: '로컬 LLM' },
    ]);
    const select = screen.getByRole('combobox', { name: '로그인할 엔진' }) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['codex', 'claude-code']);
    act(() => {
      sock.open();
      sock.emit({ type: 'ready', cwd: '/w' });
    });
    fireEvent.change(select, { target: { value: 'claude-code' } });
    fireEvent.click(screen.getByRole('button', { name: '터미널에서 로그인' }));
    expect(sock.sent).toEqual([{ type: 'input', data: `${LOGIN_COMMANDS['claude-code']}\r` }]);
  });

  it('로그인 가능한 엔진이 없으면 버튼 없음, 언마운트 시 소켓 닫음', async () => {
    const { sock } = await mount([]);
    expect(screen.queryByRole('button', { name: '터미널에서 로그인' })).toBeNull();
    cleanup();
    expect(sock.closed).toBe(true);
  });
});
