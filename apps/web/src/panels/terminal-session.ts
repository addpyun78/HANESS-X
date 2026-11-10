/**
 * 37.2 터미널 WebSocket 세션 (커널 /ws/terminal 과 짝)
 *  보냄: {type:'input', data} | {type:'resize', cols, rows}
 *  받음: {type:'ready', cwd, shell} | {type:'output', data} | {type:'exit', exitCode} | {type:'error', message}
 */

export type TerminalStatus = 'connecting' | 'ready' | 'exited' | 'closed' | 'error';

export interface TerminalSocket {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev: Event) => unknown) | null;
  onmessage: ((ev: MessageEvent) => unknown) | null;
  onclose: ((ev: CloseEvent) => unknown) | null;
  onerror: ((ev: Event) => unknown) | null;
}

export interface TerminalSessionHandlers {
  onOutput(data: string): void;
  onStatus?(s: TerminalStatus, info?: { cwd?: string; exitCode?: number; message?: string }): void;
}

const OPEN = 1;

export class TerminalSession {
  private queue: string[] = [];
  status: TerminalStatus = 'connecting';
  cwd: string | undefined;

  constructor(
    private readonly socket: TerminalSocket,
    private readonly h: TerminalSessionHandlers,
  ) {
    socket.onopen = () => this.flush();
    socket.onmessage = (ev) => this.onMessage(String(ev.data));
    socket.onclose = () => {
      if (this.status !== 'exited' && this.status !== 'error') this.set('closed');
    };
    socket.onerror = () => this.set('error');
  }

  private set(s: TerminalStatus, info?: { cwd?: string; exitCode?: number; message?: string }) {
    this.status = s;
    this.h.onStatus?.(s, info);
  }

  private onMessage(raw: string) {
    let m: { type?: string; data?: string; cwd?: string; exitCode?: number; message?: string };
    try {
      m = JSON.parse(raw) as typeof m;
    } catch {
      return;
    }
    if (m.type === 'output' && typeof m.data === 'string') this.h.onOutput(m.data);
    else if (m.type === 'ready') {
      this.cwd = m.cwd;
      this.set('ready', { cwd: m.cwd });
    } else if (m.type === 'exit') this.set('exited', { exitCode: m.exitCode });
    else if (m.type === 'error') this.set('error', { message: m.message });
  }

  private sendRaw(msg: Record<string, unknown>) {
    const s = JSON.stringify(msg);
    if (this.socket.readyState === OPEN) this.socket.send(s);
    else this.queue.push(s);
  }

  private flush() {
    for (const s of this.queue.splice(0)) this.socket.send(s);
  }

  /** 키 입력 그대로 */
  input(data: string): void {
    this.sendRaw({ type: 'input', data });
  }

  /** 명령 한 줄 실행 (Enter 포함) */
  run(command: string): void {
    this.input(command + '\r');
  }

  resize(cols: number, rows: number): void {
    this.sendRaw({ type: 'resize', cols, rows });
  }

  close(): void {
    this.socket.close();
  }
}
