import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render } from '@testing-library/react';
import { vi } from 'vitest';
import {
  Dispatcher,
  EventLog,
  HookBus,
  PluginLoader,
  ProjectStore,
  SessionRegistry,
  startApiServer,
  WorkspaceStore,
  type ApiServer,
  type LogRecord,
} from '@harness-x/kernel';
import { App } from '../src/App.js';

/**
 * T-101 0-2 E2E: 실제 커널 서버(프로젝트·세션 등록부·디스패처) + 실제 App (jsdom).
 * Playwright가 없으므로(오프라인) 브라우저 대신 jsdom에서 화면을 띄우고, fetch·WebSocket만 서버 주소로 돌린다.
 * 폴더 대화상자는 모킹(picks 큐).
 */

interface NodeWs {
  readyState: number;
  on(ev: string, fn: (...a: never[]) => void): void;
  close(): void;
}
const NodeWsCtor = createRequire(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'kernel', 'package.json'),
)('ws') as new (url: string) => NodeWs;

export const TOKEN = 'e2e-token-0123456789abcdef0123456789abcdef';

export interface Booted {
  home: string;
  root: string;
  server: ApiServer;
  projects: ProjectStore;
  sessions: SessionRegistry;
  dispatch: Dispatcher;
  log: EventLog;
  /** 다음 [폴더 열기] 대화상자가 돌려줄 경로 (비면 취소) */
  picks: string[];
  revealed: string[];
  dir: (name: string) => string;
  /** 서버만 끈다 (App은 그대로) */
  stop: () => Promise<void>;
}

const roots: string[] = [];

/** 같은 home으로 서버를 띄운다 (재시작 = 같은 home으로 다시 부르기) */
export async function bootServer(prev?: { home: string; root: string }): Promise<Booted> {
  const root = prev?.root ?? mkdtempSync(join(tmpdir(), 'hx-web-e2e-'));
  if (!prev) roots.push(root);
  const home = prev?.home ?? join(root, 'home');
  mkdirSync(home, { recursive: true });
  process.env.HARNESS_X_HOME = home;
  const log = new EventLog({ root: join(home, 'logs') });
  const projects = new ProjectStore({ home });
  const sessions = new SessionRegistry({
    home,
    projects,
    log: { append: (r: LogRecord) => log.append(r) },
    defaults: () => ({ engine: 'claude-code' }),
  });
  sessions.importLegacy(log);
  const dispatch = new Dispatcher({
    sessions,
    resolve: (n) => {
      const name = n.replace(/^\//, '');
      return {
        name,
        command: `/${name}`,
        displayName: name === 'review' ? '검토' : name,
        icon: '🔎',
        pipeline: { name: 'p', nodes: [], edges: [] } as never,
      };
    },
    run: async () => ({ status: 'completed' }),
  });
  const picks: string[] = [];
  const revealed: string[] = [];
  const loader = new PluginLoader({ hooks: new HookBus({ log }), log, roots: [] });
  const server = await startApiServer({
    loader,
    log,
    port: 0,
    token: TOKEN,
    tokenFile: join(home, 'run', 'token'),
    agentsHome: home,
    dispatch,
    workspaces: new WorkspaceStore({ file: join(home, 'workspaces.json') }),
    folderPicker: {
      pick: async () => {
        const p = picks.shift();
        return p ? { cancelled: false, path: p } : { cancelled: true };
      },
    },
    agents: () => [
      {
        name: 'review',
        command: '/review',
        displayName: '검토',
        icon: '🔎',
        source: 'user',
        defaultEngine: 'claude-code',
        nodeCount: 1,
      } as never,
    ],
    projects: { projects, sessions, reveal: (p) => revealed.push(p) },
  });
  return {
    home,
    root,
    server,
    projects,
    sessions,
    dispatch,
    log,
    picks,
    revealed,
    dir: (name) => {
      const d = join(root, name);
      mkdirSync(d, { recursive: true });
      return d;
    },
    stop: async () => {
      await server.close();
      log.close();
    },
  };
}

/** App을 서버에 붙여 띄운다 (fetch·WebSocket 주소만 바꿔 준다) */
export function renderAppOn(b: Booted) {
  const origin = location.origin;
  const wsOrigin = origin.replace(/^http/, 'ws');
  const real = globalThis.fetch;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
    real(String(input).replace(origin, b.server.url), init),
  );
  // jsdom 환경의 전역 WebSocket(undici)은 jsdom Event와 섞이면 깨진다 → 커널이 쓰는 ws 패키지로 감싼다
  const target = b.server.url.replace(/^http/, 'ws');
  class ServerWS {
    static OPEN = 1;
    onopen?: () => void;
    onmessage?: (m: { data: string }) => void;
    onclose?: () => void;
    onerror?: () => void;
    private readonly sock: NodeWs;
    constructor(url: string | URL) {
      this.sock = new NodeWsCtor(String(url).replace(wsOrigin, target));
      this.sock.on('open', () => this.onopen?.());
      this.sock.on('message', (d: Buffer) => this.onmessage?.({ data: d.toString() }));
      this.sock.on('close', () => this.onclose?.());
      this.sock.on('error', () => this.onerror?.());
    }
    get readyState() {
      return this.sock.readyState;
    }
    close() {
      this.sock.close();
    }
  }
  vi.stubGlobal('WebSocket', ServerWS);
  history.replaceState(null, '', `/?token=${TOKEN}`);
  return render(<App />);
}

export async function teardown(b?: Booted) {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  if (b) await b.stop().catch(() => {});
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
  delete process.env.HARNESS_X_HOME;
}
