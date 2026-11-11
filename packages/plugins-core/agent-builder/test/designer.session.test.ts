import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { JudgeSpawn } from '@harness-x/judge';
import { pickRelevant } from '../src/inventory/relevance.js';
import { buildDesignPrompt, NODE_KIND_GUIDE } from '../src/designer/prompt.js';
import { createDesignerSession } from '../src/designer/session.js';
import { designerInventory, sampleDraft } from './designer-helpers.js';

const claudeResult = (text: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'result', result: text, is_error: false, num_turns: 1, ...extra }) + '\n';

function fakeSpawn(stdout: string) {
  const calls: {
    command: string;
    args: string[];
    cwd: string;
    cwdFiles: string[];
    env: NodeJS.ProcessEnv;
  }[] = [];
  const spawn: JudgeSpawn = (command, args, opts) => {
    calls.push({ command, args, cwd: opts.cwd, cwdFiles: readdirSync(opts.cwd), env: opts.env });
    return Promise.resolve({ code: 0, stdout, stderr: '' });
  };
  return { spawn, calls };
}

const engine = (id: string) => ({
  id,
  detected: true,
  loggedIn: true,
  authMode: 'subscription' as const,
});

describe('P4-C.2 설계 세션: 엔진 어댑터 재사용 · 도구 금지 · 읽기 전용', () => {
  const inv = designerInventory();
  const prompt = buildDesignPrompt({
    request: '임장노트 화면 디자인을 검수해 주는 에이전트 만들어 줘',
    inventory: pickRelevant(inv, '임장노트 화면 디자인 검수', 40).inventory,
    maxQuestions: 3,
  });

  it('입력 = 사용자 요청 + 추린 인벤토리 + 노드 종류 설명 (저장 방법은 없다)', () => {
    expect(prompt.user).toContain('임장노트 화면 디자인을 검수해 주는 에이전트 만들어 줘');
    for (const id of ['ui-audit', 'claude-code', 'codex', 'screenshot', 'design-qa'])
      expect(prompt.user).toContain(id);
    for (const k of Object.keys(NODE_KIND_GUIDE)) expect(prompt.user).toContain(`- ${k}:`);
    expect(prompt.system).toMatch(/no tools/i);
    expect(`${prompt.system}\n${prompt.user}`).not.toMatch(/agent\.save|\/api\/agents/);
  });

  it('claude: 빈 임시 폴더 · plan 모드 · --tools "" · MCP 없음 → 도구 호출 0건이면 답을 쓴다', async () => {
    const text = JSON.stringify(sampleDraft());
    const f = fakeSpawn(claudeResult(text));
    const s = createDesignerSession(engine('claude'), { spawn: f.spawn, baseEnv: { PATH: '/usr/bin' } });
    await expect(s.ask(prompt)).resolves.toBe(text);
    const c = f.calls[0]!;
    expect(c.command).toBe('claude');
    expect(c.args).toEqual(
      expect.arrayContaining(['--permission-mode', 'plan', '--strict-mcp-config', '--tools', '']),
    );
    expect(c.cwdFiles).toEqual([]);
    expect(existsSync(c.cwd)).toBe(false); // 끝나면 지운다
    expect(s.rejectedToolCalls).toBe(0);
  });

  it('codex: exec --sandbox read-only · 빈 폴더에서 실행', async () => {
    const f = fakeSpawn('');
    await createDesignerSession(engine('codex'), { spawn: f.spawn }).ask(prompt);
    expect(f.calls[0]!.args.slice(0, 4)).toEqual(['exec', '--json', '--sandbox', 'read-only']);
    expect(f.calls[0]!.args).toContain('--cd');
  });

  it('도구를 쓴 답은 버린다 (claude 권한 거부 1건 · codex 명령 실행 리플레이)', async () => {
    const c = fakeSpawn(claudeResult('{}', { permission_denials: [{ tool_name: 'Write' }] }));
    const s = createDesignerSession(engine('claude-code'), { spawn: c.spawn });
    await expect(s.ask(prompt)).resolves.toBeUndefined();
    expect(s.rejectedToolCalls).toBe(1);

    const replay = readFileSync(
      new URL('../../verifiers/judge/fixtures/replays/codex-tool-call.stdout', import.meta.url),
      'utf8',
    );
    const x = createDesignerSession(engine('codex'), { spawn: fakeSpawn(replay).spawn });
    await expect(x.ask(prompt)).resolves.toBeUndefined();
    expect(x.rejectedToolCalls).toBeGreaterThan(0);
  });

  it('API 엔진: tools 빈 목록으로 요청, 도구 호출 답은 버린다', async () => {
    const bodies: { tools?: unknown[] }[] = [];
    const fetchFn = ((_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body) as { tools?: unknown[] });
      return Promise.resolve(
        new Response(
          `data: ${JSON.stringify({ choices: [{ delta: { content: '{"a":1}' } }] })}\n\n` +
            `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        ),
      );
    }) as unknown as typeof fetch;
    const s = createDesignerSession(
      { ...engine('local-llm'), kind: 'api', api: { baseUrl: 'http://127.0.0.1:1', model: 'm' } },
      { fetch: fetchFn },
    );
    await expect(s.ask(prompt)).resolves.toBe('{"a":1}');
    expect(bodies[0]!.tools ?? []).toEqual([]);
  });
});
