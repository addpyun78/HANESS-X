import { execFile, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

/**
 * 13.5 로그인 상태 조회 — 공식 CLI의 상태 명령만 사용한다 (토큰 파일은 읽지 않는다).
 * - codex: `codex login status`, 그다음 `codex app-server` 의 account/read
 * - 상태 명령이 없는 엔진: unknown
 * 로그인 흐름(codex login 등)은 절대 시작하지 않는다.
 */

export type LoginState = 'loggedIn' | 'loggedOut' | 'unknown';

export interface LoginStatus {
  engine: string;
  state: LoginState;
  method?: 'chatgpt' | 'apiKey';
  plan?: string;
  source: 'codex login status' | 'codex app-server account/read' | 'none';
}

export interface StatusExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}
export type StatusExec = (file: string, args: string[], timeoutMs: number) => Promise<StatusExecResult>;

/** JSON-RPC(줄 단위 JSON) 요청들을 보내고 id가 있는 응답들을 받는다 */
export type JsonRpcTransport = (
  file: string,
  args: string[],
  messages: Record<string, unknown>[],
  timeoutMs: number,
) => Promise<Record<string, unknown>[]>;

export const defaultStatusExec: StatusExec = (file, args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: timeoutMs, windowsHide: true, encoding: 'utf8' },
      (err, stdout, stderr) => {
        const e = err as { code?: unknown } | null;
        resolve({ code: e ? (typeof e.code === 'number' ? e.code : null) : 0, stdout, stderr });
      },
    );
  });

export const defaultJsonRpcTransport: JsonRpcTransport = (file, args, messages, timeoutMs) =>
  new Promise((resolve) => {
    const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    const want = new Set(messages.filter((m) => 'id' in m).map((m) => m.id));
    const got: Record<string, unknown>[] = [];
    const done = () => {
      clearTimeout(timer);
      child.kill();
      resolve(got);
    };
    const timer = setTimeout(done, timeoutMs);
    child.on('error', done);
    child.on('exit', done);
    createInterface({ input: child.stdout }).on('line', (line) => {
      try {
        const msg = JSON.parse(line) as Record<string, unknown>;
        if ('id' in msg && want.has(msg.id)) {
          got.push(msg);
          want.delete(msg.id);
          if (want.size === 0) done();
        }
      } catch {
        /* 로그 줄 무시 */
      }
    });
    for (const m of messages) child.stdin.write(JSON.stringify(m) + '\n');
  });

/** `codex login status` 출력 파싱 (stdout·stderr 모두 확인) */
export function parseCodexLoginStatus(r: StatusExecResult): Omit<LoginStatus, 'engine' | 'source'> {
  const text = `${r.stdout}\n${r.stderr}`;
  if (/not logged in/i.test(text)) return { state: 'loggedOut' };
  if (/logged in/i.test(text)) {
    if (/chatgpt/i.test(text)) return { state: 'loggedIn', method: 'chatgpt' };
    if (/api key/i.test(text)) return { state: 'loggedIn', method: 'apiKey' };
    return { state: 'loggedIn' };
  }
  return { state: 'unknown' };
}

/** app-server account/read 결과 파싱: { account: {type, planType?} | null, requiresOpenaiAuth } */
export function parseCodexAccountRead(result: unknown): Omit<LoginStatus, 'engine' | 'source'> {
  if (!result || typeof result !== 'object' || !('account' in result)) return { state: 'unknown' };
  const account = (result as { account: unknown }).account;
  if (account === null) return { state: 'loggedOut' };
  if (!account || typeof account !== 'object') return { state: 'unknown' };
  const a = account as { type?: unknown; planType?: unknown };
  const method = a.type === 'chatgpt' ? 'chatgpt' : a.type === 'apiKey' ? 'apiKey' : undefined;
  return {
    state: 'loggedIn',
    ...(method ? { method } : {}),
    ...(typeof a.planType === 'string' ? { plan: a.planType } : {}),
  };
}

export interface LoginStatusOptions {
  /** 엔진 실행 파일 (기본: codex) */
  executable?: string;
  exec?: StatusExec;
  rpc?: JsonRpcTransport;
  timeoutMs?: number;
}

/** 상태 명령이 있는 엔진 */
const CODEX_IDS = new Set(['codex']);

export async function getLoginStatus(engine: string, opts: LoginStatusOptions = {}): Promise<LoginStatus> {
  if (!CODEX_IDS.has(engine)) return { engine, state: 'unknown', source: 'none' };
  const file = opts.executable ?? 'codex';
  const timeoutMs = opts.timeoutMs ?? 10_000;

  const r = await (opts.exec ?? defaultStatusExec)(file, ['login', 'status'], timeoutMs);
  const viaStatus = parseCodexLoginStatus(r);
  if (viaStatus.state !== 'unknown') return { engine, ...viaStatus, source: 'codex login status' };

  const responses = await (opts.rpc ?? defaultJsonRpcTransport)(
    file,
    ['app-server'],
    [
      { id: 1, method: 'initialize', params: { clientInfo: { name: 'harness-x', version: '0.0.0' } } },
      { method: 'initialized' },
      { id: 2, method: 'account/read', params: { refreshToken: false } },
    ],
    timeoutMs,
  );
  const res = responses.find((m) => m.id === 2);
  const viaRpc = res && 'result' in res ? parseCodexAccountRead(res.result) : { state: 'unknown' as const };
  if (viaRpc.state !== 'unknown') return { engine, ...viaRpc, source: 'codex app-server account/read' };
  return { engine, state: 'unknown', source: 'none' };
}
