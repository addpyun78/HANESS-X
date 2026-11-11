import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { harnessHome } from '../loader.js';
import { ProjectStore } from './project-store.js';
import { SessionRegistry } from './session-registry.js';

/**
 * T-101 CLI 명령
 * - `harness-x reindex` (0B.9): sessions/ 폴더를 다시 읽어 색인을 고친다 (서버 없이).
 * - `harness-x run <에이전트> <지시…> [--project <id|경로>] [--port n]` (0B.37): 실행 중인 서버의
 *   POST /api/sessions로 보낸다 → 서버의 createSession() 하나로 등록되고 /ws/events로 사이드바에 바로 보인다.
 *   (CLI가 세션을 따로 만들면 화면 목록에 안 나타나는 Codex 버그 #25818을 피한다)
 */

export interface CliIo {
  out: (s: string) => void;
  err: (s: string) => void;
}

const defaultIo: CliIo = {
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s),
};

export function reindexCli(o: { home?: string; io?: CliIo } = {}): number {
  const io = o.io ?? defaultIo;
  const reg = new SessionRegistry({ home: o.home ?? harnessHome() });
  const n = reg.reindex();
  io.out(`세션 ${n}개를 다시 읽었어요 (${reg.indexFile})\n`);
  return 0;
}

export interface RunCliOptions {
  home?: string;
  io?: CliIo;
  fetchImpl?: typeof fetch;
  cwd?: string;
}

export async function runCli(argv: string[], o: RunCliOptions = {}): Promise<number> {
  const io = o.io ?? defaultIo;
  const home = o.home ?? harnessHome();
  const args = [...argv];
  const take = (flag: string) => {
    const i = args.indexOf(flag);
    if (i < 0) return undefined;
    const v = args[i + 1];
    args.splice(i, 2);
    return v;
  };
  const projectArg = take('--project');
  const port = Number(take('--port') ?? process.env.HARNESS_X_PORT ?? 3790);
  const [agent, ...rest] = args;
  if (!agent) {
    io.err('사용법: harness-x run <에이전트> <지시> [--project <id|경로>]\n');
    return 1;
  }
  const tokenFile = join(home, 'run', 'token');
  if (!existsSync(tokenFile)) {
    io.err('하네스 서버가 켜져 있지 않아요. 먼저 harness-x serve 를 실행해 주세요\n');
    return 1;
  }
  const token = readFileSync(tokenFile, 'utf8').trim();
  // 프로젝트: id 또는 경로. 경로면 (하위 폴더·작업 트리 포함) 그 프로젝트의 id를 만들 때 정해 보낸다 (0B.39)
  const store = new ProjectStore({ home });
  const where = projectArg ?? o.cwd ?? process.cwd();
  const projectId = store.get(where)?.id ?? store.findForCwd(resolve(where))?.id;
  if (projectArg && !projectId) {
    io.err(`프로젝트를 찾을 수 없어요: ${projectArg}\n`);
    return 1;
  }
  const f = o.fetchImpl ?? fetch;
  const res = await f(`http://127.0.0.1:${port}/api/sessions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      agent,
      prompt: rest.join(' '),
      origin: 'cli',
      ...(projectId ? { projectId } : {}),
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { sessionId?: string; message?: string };
  if (!res.ok) {
    io.err(`세션을 시작하지 못했어요: ${body.message ?? res.status}\n`);
    return 1;
  }
  io.out(`세션을 시작했어요: ${body.sessionId}\n`);
  return 0;
}
