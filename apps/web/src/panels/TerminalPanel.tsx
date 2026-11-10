import { useEffect, useRef, useState } from 'react';
import { loginCommand } from './login-commands.js';
import { TerminalSession, type TerminalSocket, type TerminalStatus } from './terminal-session.js';
import './panels.css';

/** 화면 출력 장치 — 기본은 xterm.js, 테스트에서는 가짜로 바꾼다 */
export interface TerminalView {
  write(data: string): void;
  onData(cb: (data: string) => void): void;
  /** 현재 크기 (fit 후) */
  size(): { cols: number; rows: number };
  dispose(): void;
}

export type CreateTerminalView = (host: HTMLElement) => Promise<TerminalView>;

/** xterm.js + fit 애드온 (처음 열 때만 불러온다) */
export const xtermView: CreateTerminalView = async (host) => {
  const [{ Terminal }, { FitAddon }] = await Promise.all([
    import('@xterm/xterm'),
    import('@xterm/addon-fit'),
    import('@xterm/xterm/css/xterm.css'),
  ]);
  const term = new Terminal({ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 13 });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host);
  try {
    fit.fit();
  } catch {
    /* 보이지 않는 탭 */
  }
  return {
    write: (d) => term.write(d),
    onData: (cb) => void term.onData(cb),
    size: () => ({ cols: term.cols, rows: term.rows }),
    dispose: () => term.dispose(),
  };
};

export interface TerminalPanelProps {
  /** 소켓 열기 (cols·rows는 쿼리로 전달) */
  connect: (size: { cols: number; rows: number }) => TerminalSocket;
  /** "터미널에서 로그인" 대상 엔진 */
  loginEngines?: { id: string; label: string }[];
  createView?: CreateTerminalView;
}

const STATUS_LABEL: Record<TerminalStatus, string> = {
  connecting: '연결 중',
  ready: '연결됨',
  exited: '종료됨',
  closed: '연결 끊김',
  error: '오류',
};

/** 37.2 터미널 패널(xterm.js ↔ 커널 node-pty, cwd = 워크스페이스) + 37.3 터미널에서 로그인 */
export function TerminalPanel({ connect, loginEngines = [], createView = xtermView }: TerminalPanelProps) {
  const host = useRef<HTMLDivElement>(null);
  const session = useRef<TerminalSession | undefined>(undefined);
  const [status, setStatus] = useState<TerminalStatus>('connecting');
  const [cwd, setCwd] = useState<string>();
  const [engine, setEngine] = useState<string>();
  const loginable = loginEngines.filter((e) => loginCommand(e.id));
  const selected = engine ?? loginable[0]?.id;

  useEffect(() => {
    let disposed = false;
    let view: TerminalView | undefined;
    createView(host.current!).then((v) => {
      if (disposed) return v.dispose();
      view = v;
      const s = new TerminalSession(connect(v.size()), {
        onOutput: (d) => v.write(d),
        onStatus: (st, info) => {
          setStatus(st);
          if (info?.cwd) setCwd(info.cwd);
        },
      });
      v.onData((d) => s.input(d));
      session.current = s;
    });
    return () => {
      disposed = true;
      session.current?.close();
      session.current = undefined;
      view?.dispose();
    };
  }, [connect, createView]);

  const login = () => {
    const cmd = selected && loginCommand(selected);
    if (cmd) session.current?.run(cmd);
  };

  return (
    <section className="hx-term-panel" aria-label="터미널">
      <header className="hx-term-panel__head">
        {loginable.length > 1 && (
          <select
            aria-label="로그인할 엔진"
            value={selected}
            onChange={(e) => setEngine(e.currentTarget.value)}
          >
            {loginable.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
        )}
        {loginable.length > 0 && (
          <button
            type="button"
            className="hx-icon-btn"
            onClick={login}
            disabled={status !== 'ready'}
            title={selected ? loginCommand(selected) : undefined}
          >
            터미널에서 로그인
          </button>
        )}
        <span className="hx-term-panel__status" role="status" title={cwd}>
          {STATUS_LABEL[status]}
          {cwd && <span className="hx-mono"> · {cwd}</span>}
        </span>
      </header>
      <div ref={host} className="hx-term" data-testid="terminal" />
    </section>
  );
}
