import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClaudeCodeEngine } from '@harness-x/engine-claude-code';
import { createCodexEngine } from '@harness-x/engine-codex';
import { afterEach, describe, expect, it } from 'vitest';
import { PipelineRunner } from '../src/index.js';
import { RUNNER_FX, pipeline, tmpWorkspace } from './runner-helpers.js';

const REPLAY = RUNNER_FX('replay-engine.mjs');

let ws: ReturnType<typeof tmpWorkspace>;
afterEach(() => ws?.cleanup());

const readLog = (f: string) =>
  readFileSync(f, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { args: string[]; env: Record<string, string> });

describe('41.1 노드별 엔진 세션 (plan=claude, build=codex 리플레이)', () => {
  it('노드마다 지정한 엔진 어댑터로 자기 세션을 연다', async () => {
    ws = tmpWorkspace();
    const claudeLog = join(ws.dir, 'claude.argv.jsonl');
    const codexLog = join(ws.dir, 'codex.argv.jsonl');
    const claude = createClaudeCodeEngine({
      command: process.execPath,
      prefixArgs: [REPLAY, RUNNER_FX('plan.claude.jsonl'), claudeLog],
    });
    const codex = createCodexEngine({
      command: process.execPath,
      prefixArgs: [REPLAY, RUNNER_FX('build.codex.jsonl'), codexLog],
      transport: 'exec',
    });
    const p = pipeline({
      name: 'plan-build',
      nodes: [
        { id: 'plan', type: 'role', engine: 'claude-code', permission: 'read-only', prompt: '계획하라' },
        { id: 'build', type: 'role', engine: 'codex', prompt: '구현하라' },
      ],
      edges: [{ from: 'plan', to: 'build' }],
    });
    const runner = new PipelineRunner({
      engines: { 'claude-code': claude, codex },
      workspace: ws.dir,
      log: ws.log,
      sessionId: 'run-41-1',
    });
    const r = await runner.run(p, { request: '랜딩 페이지' });

    expect(r.status).toBe('completed');
    expect(r.visits.map((v) => [v.nodeId, v.engineId, v.status])).toEqual([
      ['plan', 'claude-code', 'completed'],
      ['build', 'codex', 'completed'],
    ]);
    // 각 엔진은 자기 노드 프롬프트만 받았다 (세션 분리)
    const [c] = readLog(claudeLog);
    const [x] = readLog(codexLog);
    expect(c!.args.at(-1)).toContain('계획하라');
    expect(c!.args).toContain('plan'); // --permission-mode plan (read-only)
    expect(c!.env.HARNESS_X_NODE).toBe('plan');
    expect(x!.args[0]).toBe('exec');
    expect(x!.args.at(-1)).toContain('구현하라');
    expect(x!.env.HARNESS_X_NODE).toBe('build');
    expect(c!.env.HARNESS_X_CHECKLIST_DIR).not.toBe(x!.env.HARNESS_X_CHECKLIST_DIR);
    // 엔진 이벤트가 노드별 engineId로 이벤트 로그에 남는다
    ws.log.flush();
    const engines = ws.log.query({ sessionId: 'run-41-1', type: 'turn_end' }).map((e) => e.engineId);
    expect(engines).toEqual(['claude-code', 'codex']);
    expect(r.visits[0]!.events.some((e) => e.type === 'assistant_text')).toBe(true);
    expect(r.visits[1]!.events.some((e) => e.type === 'file_change')).toBe(true);
  });

  it('engine: auto 노드는 defaultEngine을 쓴다', async () => {
    ws = tmpWorkspace();
    const codexLog = join(ws.dir, 'codex.argv.jsonl');
    const codex = createCodexEngine({
      command: process.execPath,
      prefixArgs: [REPLAY, RUNNER_FX('build.codex.jsonl'), codexLog],
      transport: 'exec',
    });
    const r = await new PipelineRunner({
      engines: { codex },
      defaultEngine: 'codex',
      workspace: ws.dir,
    }).run(pipeline({ name: 'one', nodes: [{ id: 'only', type: 'role' }] }), '하나');
    expect(r.status).toBe('completed');
    expect(r.visits[0]!.engineId).toBe('codex');
  });
});
