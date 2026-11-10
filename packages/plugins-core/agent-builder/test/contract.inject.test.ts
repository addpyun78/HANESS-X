import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePipelineYaml } from '@harness-x/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { DESIGN_QA_DIR } from './fixtures.js';
import { PipelineRunner, renderInputValues } from '../src/index.js';
import { fakeEngine, tmpWorkspace, type FakeCall } from './runner-helpers.js';

let ws: ReturnType<typeof tmpWorkspace>;
afterEach(() => ws?.cleanup());

const DESIGN_QA = parsePipelineYaml(readFileSync(join(DESIGN_QA_DIR, 'pipeline.yaml'), 'utf8'));

describe('42.3 다음 노드에는 파일 링크가 아니라 값으로 주입', () => {
  it('design-qa: plan 출력 값이 build 프롬프트에, build 출력 값이 critic 프롬프트에 들어간다', async () => {
    ws = tmpWorkspace();
    const calls: FakeCall[] = [];
    const out = (json: unknown) => ({
      events: [{ type: 'tool_call', callId: 'o', tool: 'mcp__harness__node.output', input: { json } }],
      text: '제출',
    });
    const engines = {
      'claude-code': fakeEngine(
        'claude-code',
        () => out({ tasks: ['헤더 만들기', '버튼 대비 높이기'], acceptance: ['대비 4.5:1 이상'] }),
        calls,
      ),
      codex: fakeEngine('codex', () => out({ changedFiles: ['src/Header.tsx', 'src/Button.tsx'] }), calls),
      antigravity: fakeEngine('antigravity', () => out({ verdict: 'pass', issues: [] }), calls),
    };
    const r = await new PipelineRunner({ engines, workspace: ws.dir }).run(DESIGN_QA, {
      request: '로그인 화면 다듬기',
    });
    expect(r.status).toBe('completed');
    const [plan, build, critic] = calls;
    expect(plan!.prompt).toContain('request: 로그인 화면 다듬기');
    // 값 그대로 (필드별 줄 + JSON 본문)
    expect(build!.prompt).toContain('tasks: ["헤더 만들기","버튼 대비 높이기"]');
    expect(build!.prompt).toContain('acceptance: ["대비 4.5:1 이상"]');
    expect(build!.prompt).toContain('"헤더 만들기"');
    expect(critic!.prompt).toContain('changedFiles: ["src/Header.tsx","src/Button.tsx"]');
    // 파일 링크·원장 경로로 넘기지 않는다
    for (const c of calls) {
      expect(c.prompt).not.toMatch(/file:\/\//);
      expect(c.prompt).not.toContain('.harness-x');
      expect(c.prompt).not.toContain(ws.dir);
    }
    // 출력 형식 안내도 함께 (outputSchema 필드)
    expect(build!.prompt).toContain('필드: changedFiles(필수)');
    expect(r.outputs.critic).toEqual({ verdict: 'pass', issues: [] });
  });

  it('inputSchema가 있으면 선언된 필드만 넘긴다', async () => {
    ws = tmpWorkspace();
    const calls: FakeCall[] = [];
    const engines = {
      'claude-code': fakeEngine('claude-code', () => ({ text: '{"tasks":["a"],"acceptance":["b"]}' }), calls),
      codex: fakeEngine('codex', () => ({ text: '{"changedFiles":["x.ts"],"secret":"내부 메모"}' }), calls),
      antigravity: fakeEngine('antigravity', () => ({ text: '{"verdict":"fail"}' }), calls),
    };
    const p = {
      ...DESIGN_QA,
      nodes: DESIGN_QA.nodes.map((n) =>
        n.id === 'build' && n.type === 'role'
          ? { ...n, outputSchema: { ...n.outputSchema, properties: { changedFiles: {}, secret: {} } } }
          : n,
      ),
    };
    await new PipelineRunner({ engines, workspace: ws.dir }).run(p, { request: 'r' });
    expect(calls[1]!.prompt).toContain('tasks: ["a"]');
    expect(calls[2]!.prompt).toContain('changedFiles: ["x.ts"]');
    expect(calls[2]!.prompt).not.toContain('내부 메모');
  });

  it('renderInputValues: 문자열은 그대로, 나머지는 JSON', () => {
    const s = renderInputValues({ name: '홍', n: 3, list: [1] });
    expect(s).toContain('- name: 홍');
    expect(s).toContain('- n: 3');
    expect(s).toContain('- list: [1]');
  });
});
