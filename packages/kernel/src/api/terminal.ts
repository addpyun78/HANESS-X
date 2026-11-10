import { createRequire } from 'node:module';
import type { FastifyInstance } from 'fastify';

/**
 * 37.2 터미널 백엔드 — node-pty(@lydell/node-pty 프리빌드) 셸을 WebSocket으로 중계한다.
 * WS /ws/terminal?token=&cols=&rows=
 *  클라이언트 → {type:'input', data} | {type:'resize', cols, rows}
 *  서버 → {type:'ready', cwd, shell} | {type:'output', data} | {type:'exit', exitCode}
 * 셸의 작업 폴더는 항상 워크스페이스(cwd 옵션)다.
 */

export const TERMINAL_ROUTE = '/ws/terminal';

export interface PtyProcess {
  onData(cb: (data: string) => void): unknown;
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): unknown;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}

export interface PtySpawnOptions {
  cwd: string;
  cols: number;
  rows: number;
  env: Record<string, string>;
  name?: string;
}

export type PtySpawn = (file: string, args: string[], opts: PtySpawnOptions) => PtyProcess;

export interface TerminalOptions {
  /** 워크스페이스 폴더 (함수면 연결할 때마다 다시 읽는다 — 폴더를 바꾸면 새 터미널부터 반영) */
  cwd: string | (() => string);
  /** 기본: Windows powershell.exe, 그 외 $SHELL 또는 bash */
  shell?: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  /** 테스트·플랫폼별 교체용 (기본 @lydell/node-pty) */
  spawn?: PtySpawn;
}

interface NodePtyModule {
  spawn(file: string, args: string[], opts: PtySpawnOptions): PtyProcess;
}

let ptyModule: NodePtyModule | undefined;
/** 네이티브 모듈은 터미널을 처음 열 때만 로드 */
export const nodePtySpawn: PtySpawn = (file, args, opts) => {
  ptyModule ??= createRequire(import.meta.url)('@lydell/node-pty') as NodePtyModule;
  return ptyModule.spawn(file, args, { name: 'xterm-256color', ...opts });
};

export function defaultShell(platform: NodeJS.Platform = process.platform, env = process.env): string {
  if (platform === 'win32') return 'powershell.exe';
  return env.SHELL || 'bash';
}

function cleanEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (typeof v === 'string') out[k] = v;
  return out;
}

const clampDim = (v: unknown, def: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= 1000 ? n : def;
};

export function registerTerminalRoute(app: FastifyInstance, opts: TerminalOptions): void {
  app.get(TERMINAL_ROUTE, { websocket: true }, (socket, req) => {
    const q = req.query as { cols?: string; rows?: string };
    const cwd = typeof opts.cwd === 'function' ? opts.cwd() : opts.cwd;
    const shell = opts.shell ?? defaultShell();
    const send = (m: Record<string, unknown>) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(m));
    };
    let pty: PtyProcess;
    try {
      pty = (opts.spawn ?? nodePtySpawn)(shell, opts.args ?? [], {
        cwd,
        cols: clampDim(q.cols, 80),
        rows: clampDim(q.rows, 24),
        env: cleanEnv({ ...(opts.env ?? process.env), TERM: 'xterm-256color' }),
      });
    } catch (err) {
      send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      socket.close();
      return;
    }
    let alive = true;
    pty.onData((data) => send({ type: 'output', data }));
    pty.onExit(({ exitCode }) => {
      alive = false;
      send({ type: 'exit', exitCode });
      socket.close();
    });
    socket.on('message', (raw: Buffer) => {
      let m: { type?: unknown; data?: unknown; cols?: unknown; rows?: unknown };
      try {
        m = JSON.parse(raw.toString()) as typeof m;
      } catch {
        return;
      }
      if (!alive) return;
      if (m.type === 'input' && typeof m.data === 'string') pty.write(m.data);
      else if (m.type === 'resize') pty.resize(clampDim(m.cols, 80), clampDim(m.rows, 24));
    });
    socket.on('close', () => {
      if (alive) pty.kill();
      alive = false;
    });
    send({ type: 'ready', cwd, shell });
  });
}
