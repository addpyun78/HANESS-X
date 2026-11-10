import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCodexEngine } from '@harness-x/engine-codex';
import { afterEach, describe, expect, it } from 'vitest';
import { PipelineRunner } from '../src/index.js';
import { RUNNER_FX, fakeEngine, pipeline, tmpWorkspace, type FakeCall } from './runner-helpers.js';

let ws: ReturnType<typeof tmpWorkspace>;
afterEach(() => ws?.cleanup());

const BUILD_OUT = {
  type: 'object',
  properties: { changedFiles: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' } },
  required: ['changedFiles'],
};

const P = (outputSchema: Record<string, unknown>) =>
  pipeline({
    name: 'contract',
    nodes: [
      { id: 'build', type: 'role', engine: 'codex', outputSchema },
      { id: 'next', type: 'role', engine: 'codex' },
    ],
    edges: [{ from: 'build', to: 'next' }],
  });

describe('42.2 스키마 검증 실패 시 같은 노드에 누락 필드로 재요청 (최대 2회)', () => {
  it('codex 리플레이: 누락 필드 재요청 → 같은 세션 재개 → 채운 값으로 진행', async () => {
    ws = tmpWorkspace();
    const log = join(ws.dir, 'codex.argv.jsonl');
    const codex = createCodexEngine({
      command: process.execPath,
      prefixArgs: [
        RUNNER_FX('replay-engine.mjs'),
        [RUNNER_FX('build-missing.codex.jsonl'), RUNNER_FX('build-fixed.codex.jsonl')].join(','),
        log,
      ],
      transport: 'exec',
    });
    const r = await new PipelineRunner({ engines: { codex }, workspace: ws.dir }).run(P(BUILD_OUT), 'x');
    expect(r.status).toBe('completed');
    expect(r.outputs.build).toEqual({ summary: '헤더 추가', changedFiles: ['src/Header.tsx'] });
    const calls = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { args: string[]; env: Record<string, string> });
    expect(calls.map((c) => c.env.HARNESS_X_NODE)).toEqual(['build', 'build', 'next']);
    const retry = calls[1]!.args;
    expect(retry.at(-1)).toContain('누락 필드: changedFiles');
    // 같은 노드의 엔진 세션을 재개해서 묻는다
    expect(retry.slice(retry.indexOf('resume'), retry.indexOf('resume') + 2)).toEqual([
      'resume',
      'build-codex-thread-1',
    ]);
    expect(r.visits[0]!.prompts).toHaveLength(2);
  });

  it('2회 재요청 뒤에도 불충족이면 contract_failed, 다음 노드 미실행', async () => {
    ws = tmpWorkspace();
    const calls: FakeCall[] = [];
    const engine = fakeEngine('codex', () => ({ text: '```json\n{"summary":"x"}\n```' }), calls);
    const r = await new PipelineRunner({ engines: { codex: engine }, workspace: ws.dir }).run(
      P(BUILD_OUT),
      'x',
    );
    expect(r.status).toBe('contract_failed');
    expect(r.haltedAt).toBe('build');
    expect(calls.map((c) => c.node)).toEqual(['build', 'build', 'build']);
    expect(calls[1]!.prompt).toContain('재요청 1/2');
    expect(calls[2]!.prompt).toContain('재요청 2/2');
    expect(calls[2]!.resumeId).toBe('codex-session-1');
    expect(r.reason).toContain('changedFiles');
  });

  it('값 목록(enum)·타입이 틀린 필드도 재요청 사유에 들어간다', async () => {
    ws = tmpWorkspace();
    const calls: FakeCall[] = [];
    const engine = fakeEngine(
      'codex',
      (_o, k) => ({ text: k === 0 ? '{"verdict":"maybe"}' : '{"verdict":"pass"}' }),
      calls,
    );
    const r = await new PipelineRunner({ engines: { codex: engine }, workspace: ws.dir }).run(
      P({
        type: 'object',
        properties: { verdict: { type: 'string', enum: ['pass', 'fail'] } },
        required: ['verdict'],
      }),
      'x',
    );
    expect(r.status).toBe('completed');
    expect(calls[1]!.prompt).toContain('잘못된 필드: verdict');
    expect(r.outputs.build).toEqual({ verdict: 'pass' });
  });
});
