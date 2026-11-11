import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

import {
  buildJudgeCliArgs,
  createEngineJudge,
  parseJudgeCliOutput,
  type JudgeCliEngineId,
  type JudgeSpawn,
} from '../src/engine.js';
import { buildJudgePrompt } from '../src/questions.js';

const replay = (name: string) =>
  readFileSync(new URL(`../fixtures/replays/${name}`, import.meta.url), 'utf8');

const prompt = buildJudgePrompt({
  kind: 'path',
  itemTitle: '모바일 앱 폴더',
  expected: '하네스/모바일',
  actual: 'ai/mobile',
});

interface SpawnCall {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
}

function replaySpawn(stdout: string, code = 0) {
  const calls: SpawnCall[] = [];
  const spawn: JudgeSpawn = async (command, args, opts) => {
    calls.push({ command, args, env: opts.env, cwd: opts.cwd });
    return { code, stdout, stderr: '' };
  };
  return { spawn, calls };
}

const KEY_ENV = {
  PATH: '/usr/bin',
  HOME: '/home/u',
  ANTHROPIC_API_KEY: 'sk-ant-should-not-leak-0000000000',
  OPENAI_API_KEY: 'sk-should-not-leak-1111111111111',
  GEMINI_API_KEY: 'AIza-should-not-leak',
  CODEX_API_KEY: 'x',
  GOOGLE_API_KEY: 'y',
};

const engine = (id: string, authMode: 'subscription' | 'apiKey' = 'subscription') => ({
  id,
  detected: true,
  loggedIn: true,
  authMode,
});

describe('E.5 엔진 판정기 — 녹화 리플레이 3종, 도구 호출 0건', () => {
  const cases: [JudgeCliEngineId, string, string][] = [
    ['claude-code', 'claude', 'claude-code.stdout'],
    ['codex', 'codex', 'codex.stdout'],
    ['antigravity', 'agy', 'antigravity.stdout'],
  ];

  for (const [id, cmd, file] of cases) {
    it(`${id}: 리플레이 → 답 파싱, 도구 호출 0건, 읽기 전용 짧은 세션`, async () => {
      const out = parseJudgeCliOutput(id, replay(file));
      expect(out.toolCalls).toBe(0);
      const r = replaySpawn(replay(file));
      const j = createEngineJudge(engine(id), { spawn: r.spawn, baseEnv: KEY_ENV });
      const a = await j.ask(prompt);
      expect(a?.same_meaning).toBe('yes');
      expect(a?.difference_kind).toBe('equivalent');
      expect(a?.plain_reason).toMatch(/모바일/);
      expect(r.calls).toHaveLength(1);
      const c = r.calls[0]!;
      expect(c.command).toBe(cmd);
      // 판정 전용 빈 임시 폴더에서 실행 (작업 폴더 아님)
      expect(c.cwd.startsWith(tmpdir())).toBe(true);
      expect(c.cwd).toMatch(/hx-judge-/);
      // 이어하기·MCP·쓰기 권한 없음
      expect(c.args).not.toContain('--resume');
      expect(c.args).not.toContain('resume');
      expect(c.args).not.toContain('--mcp-config');
      expect(c.args.join(' ')).not.toMatch(
        /acceptEdits|bypassPermissions|workspace-write|danger-full-access|accept-edits|--dangerously/,
      );
    });
  }

  it('엔진별 인자: claude -p --output-format json · codex exec --json · agy -p', () => {
    const p = 'PROMPT';
    expect(buildJudgeCliArgs('claude-code', p, { cwd: '/t' })).toEqual([
      '-p',
      '--output-format',
      'json',
      '--permission-mode',
      'plan',
      '--strict-mcp-config',
      '--tools',
      '',
      '--',
      'PROMPT',
    ]);
    expect(buildJudgeCliArgs('codex', p, { cwd: '/t', model: 'gpt-5' })).toEqual([
      'exec',
      '--json',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--cd',
      '/t',
      '--model',
      'gpt-5',
      '--',
      'PROMPT',
    ]);
    expect(buildJudgeCliArgs('antigravity', p, { cwd: '/t' })).toEqual(['--mode', 'plan', '-p', 'PROMPT']);
  });

  it('도구를 호출한 답은 버린다 (codex command_execution 리플레이 → undefined)', async () => {
    expect(parseJudgeCliOutput('codex', replay('codex-tool-call.stdout')).toolCalls).toBeGreaterThan(0);
    const r = replaySpawn(replay('codex-tool-call.stdout'));
    await expect(createEngineJudge(engine('codex'), { spawn: r.spawn }).ask(prompt)).resolves.toBeUndefined();
  });

  it('비정상 종료·빈 출력·실행 실패 → undefined (예외 없음)', async () => {
    const bad = replaySpawn(replay('claude-code.stdout'), 1);
    await expect(
      createEngineJudge(engine('claude'), { spawn: bad.spawn }).ask(prompt),
    ).resolves.toBeUndefined();
    const empty = replaySpawn('');
    await expect(
      createEngineJudge(engine('agy'), { spawn: empty.spawn }).ask(prompt),
    ).resolves.toBeUndefined();
    const boom: JudgeSpawn = () => Promise.reject(new Error('ENOENT'));
    await expect(createEngineJudge(engine('codex'), { spawn: boom }).ask(prompt)).resolves.toBeUndefined();
  });

  it('API 엔진: JSON 응답 강제(response_format json_object), 도구 없음', async () => {
    const bodies: Record<string, unknown>[] = [];
    const answer = JSON.stringify({
      same_meaning: 'no',
      difference_kind: 'wrong-value',
      plain_reason: '값이 달라요.',
    });
    const sse =
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: answer }, finish_reason: 'stop' }] })}\n\n` +
      'data: [DONE]\n\n';
    const fetchMock = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }) as unknown as typeof fetch;
    const j = createEngineJudge(
      {
        id: 'openai-compat',
        detected: true,
        loggedIn: true,
        authMode: 'subscription',
        kind: 'api',
        api: { baseUrl: 'http://127.0.0.1:9/v1', model: 'm' },
      },
      { fetch: fetchMock },
    );
    await expect(j.ask(prompt)).resolves.toEqual({
      same_meaning: 'no',
      difference_kind: 'wrong-value',
      plain_reason: '값이 달라요.',
    });
    expect(bodies[0]!.response_format).toEqual({ type: 'json_object' });
    expect(bodies[0]!.tools).toBeUndefined();
    expect(bodies[0]!.temperature).toBe(0);
  });
});
