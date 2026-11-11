import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { harnessHome } from './loader.js';
import type { ResumeCheckResult, ResumeIssue } from './resume-check.js';

/**
 * T-101 2B.2 입구: `harness-x resume <세션 id>`
 * 켜져 있는 서버(harness-x serve)에 점검(POST /api/resume/:id/check)을 묻고,
 * 문제가 있으면 카드를 글로 보여 준 뒤 확인을 받아 이어서 실행(POST /api/resume/:id)한다.
 */

/** api/server.ts DEFAULT_API_PORT와 같은 포트 */
export const DEFAULT_RESUME_URL = 'http://127.0.0.1:3790';

export interface ResumeCliIo {
  input: Readable;
  output: Writable;
  fetch?: typeof fetch;
  home?: string;
}

const HELP = `harness-x resume <세션 id> [옵션]
  멈춘 작업을 이어서 해요. 먼저 바뀐 것이 있는지 확인하고, 있으면 물어봐요.

옵션:
  --url <주소>        서버 주소 (기본 ${DEFAULT_RESUME_URL})
  --token-file <파일> 서버 토큰 파일 (기본 ~/.harness-x/run/token)
  --files keep|revert|replan   멈춘 뒤 파일이 바뀌었을 때
  --engine <엔진>     다른 AI로 바꿔서 이어하기
  --version pinned|latest      에이전트가 바뀌었을 때
  -y, --yes           물어보지 않고 기본 선택으로 이어하기
`;

export function formatIssue(i: ResumeIssue, n: number): string {
  const lines = [`${n}. ${i.title}`, `   ${i.body}`];
  for (const l of i.list ?? []) lines.push(`   - ${l}`);
  lines.push(
    `   고를 수 있는 것: ${i.choices.map((c) => `${c.label}${c.recommended ? '(추천)' : ''}${c.default ? '(기본)' : ''}`).join(' / ')}`,
  );
  return lines.join('\n');
}

async function ask(io: ResumeCliIo, q: string): Promise<string> {
  io.output.write(q);
  const rl = createInterface({ input: io.input, terminal: false });
  try {
    for await (const line of rl) return line;
    return '';
  } finally {
    rl.close();
  }
}

export async function resumeCli(argv: string[], io: ResumeCliIo): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      url: { type: 'string' },
      'token-file': { type: 'string' },
      files: { type: 'string' },
      engine: { type: 'string' },
      version: { type: 'string' },
      yes: { type: 'boolean', short: 'y' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const id = positionals[0];
  if (values.help || !id) {
    io.output.write(HELP);
    return values.help ? 0 : 1;
  }
  const url = (values.url ?? process.env.HARNESS_X_URL ?? DEFAULT_RESUME_URL).replace(/\/$/, '');
  const tokenFile = values['token-file'] ?? join(io.home ?? harnessHome(), 'run', 'token');
  const token =
    process.env.HARNESS_X_TOKEN ?? (existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8').trim() : '');
  const f = io.fetch ?? fetch;
  const post = async (path: string, body: unknown) => {
    const res = await f(url + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  };

  let check: { status: number; body: Record<string, unknown> };
  try {
    check = await post(`/api/resume/${encodeURIComponent(id)}/check`, {});
  } catch {
    io.output.write('서버에 연결하지 못했어요. 먼저 harness-x serve로 켜 주세요.\n');
    return 1;
  }
  if (check.status === 404) {
    io.output.write(`이어서 할 작업을 찾지 못했어요: ${id}\n`);
    return 1;
  }
  if (check.status !== 200) {
    io.output.write('확인하지 못했어요. 잠시 뒤 다시 해 주세요.\n');
    return 1;
  }
  const r = check.body as unknown as ResumeCheckResult;
  if (!r.ok) {
    io.output.write('이어하기 전에 확인할 것이 있어요.\n\n');
    r.issues.forEach((i, k) => io.output.write(formatIssue(i, k + 1) + '\n\n'));
    if (r.issues.some((i) => i.blocking)) {
      io.output.write('확인 카드에 먼저 대답해 주세요 (harness-x approvals).\n');
      return 2;
    }
    if (!values.yes) {
      const a = (await ask(io, '고른 대로(없으면 기본으로) 이어할까요? (y/n): ')).trim().toLowerCase();
      if (a !== 'y' && a !== 'yes' && a !== '네' && a !== 'ㅇ') {
        io.output.write('이어하지 않았어요.\n');
        return 0;
      }
    }
  }
  const started = await post(`/api/resume/${encodeURIComponent(id)}`, {
    ...(values.files ? { files: values.files } : {}),
    ...(values.engine ? { engine: values.engine } : {}),
    ...(values.version ? { version: values.version } : {}),
  });
  if (started.status !== 202) {
    io.output.write(`이어하지 못했어요. ${String(started.body.message ?? '')}\n`);
    return 1;
  }
  const how = started.body.mode === 'engine' ? '하던 대화 그대로' : '지금까지 한 일 요약으로';
  io.output.write(`이어서 시작했어요 (${how}).\n`);
  return 0;
}
