import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HarnessEvent } from '@harness-x/protocol';
import {
  resolveInWorkspace,
  runAgentLoop,
  toEngineRun,
  workspaceTools,
  type ModelClient,
  type ModelRequest,
  type ModelTurn,
} from '../src/agent-loop.js';
import { HookBus } from '../src/hooks.js';
import { tempDir } from './helpers.js';

/** 정해진 턴을 차례로 돌려주는 가짜 모델 */
function scripted(turns: ModelTurn[]): ModelClient & { reqs: ModelRequest[] } {
  const reqs: ModelRequest[] = [];
  return {
    reqs,
    async complete(req) {
      reqs.push(structuredClone({ messages: req.messages, tools: req.tools }));
      const t = turns[reqs.length - 1] ?? { text: 'done', toolCalls: [] };
      if (t.text) req.onText?.(t.text);
      return t;
    },
  };
}

async function collect(it: AsyncIterable<HarnessEvent>): Promise<HarnessEvent[]> {
  const out: HarnessEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe('agent-loop', () => {
  let t: ReturnType<typeof tempDir>;
  beforeEach(() => (t = tempDir('hx-loop-')));
  afterEach(() => t.cleanup());

  it('workspace 경로 한정: .., 절대 경로, 심볼릭 링크 탈출 거부', () => {
    mkdirSync(join(t.dir, 'sub'));
    expect(resolveInWorkspace(t.dir, 'sub/a.txt')).toMatch(/sub[\\/]a\.txt$/);
    expect(() => resolveInWorkspace(t.dir, '../x')).toThrow(/워크스페이스 밖/);
    expect(() => resolveInWorkspace(t.dir, '/etc/passwd')).toThrow(/워크스페이스 밖/);
    const outside = tempDir('hx-out-');
    try {
      symlinkSync(outside.dir, join(t.dir, 'link'), 'dir');
      expect(() => resolveInWorkspace(t.dir, 'link/new.txt')).toThrow(/워크스페이스 밖/);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EPERM') throw e;
    } finally {
      outside.cleanup();
    }
  });

  it('write_file → file_change, list_dir, read-only 권한이면 write_file 제외', async () => {
    const client = scripted([
      {
        text: '',
        toolCalls: [
          { id: 'w', name: 'write_file', arguments: { path: 'd/n.txt', content: 'abc' } },
          { id: 'l', name: 'list_dir', arguments: { path: 'd' } },
        ],
      },
    ]);
    const events = await collect(runAgentLoop({ client, sessionId: 's', cwd: t.dir, prompt: 'go' }));
    expect(readFileSync(join(t.dir, 'd/n.txt'), 'utf8')).toBe('abc');
    expect(events.find((e) => e.type === 'file_change')).toMatchObject({ path: 'd/n.txt', change: 'create' });
    expect(
      events.filter((e) => e.type === 'tool_result').map((e) => e.type === 'tool_result' && e.output),
    ).toEqual(['wrote 3 bytes to d/n.txt', ['n.txt']]);
    expect(client.reqs[1]!.messages.filter((m) => m.role === 'tool')).toHaveLength(2);

    const ro = scripted([{ text: 'x', toolCalls: [] }]);
    await collect(
      runAgentLoop({ client: ro, sessionId: 's', cwd: t.dir, prompt: 'go', permission: 'read-only' }),
    );
    expect(ro.reqs[0]!.tools.map((x) => x.name)).toEqual(['read_file', 'list_dir']);
  });

  it('tool.before patch가 입력을 고친다 (필드 patch, input 전체 patch)', async () => {
    const hooks = new HookBus();
    hooks.onBlocking('tool.before', () => ({ decision: 'allow', patch: { path: 'fixed.txt' } }));
    const client = scripted([
      {
        text: '',
        toolCalls: [{ id: 'w', name: 'write_file', arguments: { path: '하네스.txt', content: '1' } }],
      },
    ]);
    const events = await collect(runAgentLoop({ client, sessionId: 's', cwd: t.dir, prompt: 'go', hooks }));
    expect(existsSync(join(t.dir, 'fixed.txt'))).toBe(true);
    expect(existsSync(join(t.dir, '하네스.txt'))).toBe(false);
    expect(events.find((e) => e.type === 'tool_call')).toMatchObject({ input: { path: '하네스.txt' } });

    const h2 = new HookBus();
    h2.onBlocking('tool.before', () => ({ decision: 'allow', patch: { input: { path: 'a.txt' } } }));
    writeFileSync(join(t.dir, 'a.txt'), 'A');
    const c2 = scripted([
      { text: '', toolCalls: [{ id: 'r', name: 'read_file', arguments: { path: 'zzz' } }] },
    ]);
    const ev2 = await collect(
      runAgentLoop({ client: c2, sessionId: 's', cwd: t.dir, prompt: 'go', hooks: h2 }),
    );
    expect(ev2.find((e) => e.type === 'tool_result')).toMatchObject({ ok: true, output: 'A' });
  });

  it('알 수 없는 도구는 오류 결과, partial 텍스트 후 최종 텍스트', async () => {
    const client = scripted([{ text: 'hmm', toolCalls: [{ id: 'q', name: 'nope', arguments: {} }] }]);
    const events = await collect(
      runAgentLoop({ client, sessionId: 's', cwd: t.dir, prompt: 'go', itemId: 'i1' }),
    );
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ ok: false, itemId: 'i1' });
    expect(
      events.filter((e) => e.type === 'assistant_text').map((e) => e.type === 'assistant_text' && e.partial),
    ).toEqual([true, false, true, false]);
  });

  it('toEngineRun: interrupt 시 turn_end interrupted', async () => {
    let release!: () => void;
    const client: ModelClient = {
      complete: (req) =>
        new Promise((_, reject) => {
          release = () => reject(new Error('aborted'));
          req.signal?.addEventListener('abort', () => release());
        }),
    };
    const run = toEngineRun((signal) =>
      runAgentLoop({ client, sessionId: 's', cwd: t.dir, prompt: 'x', signal }),
    );
    await new Promise((r) => setTimeout(r, 20));
    await run.interrupt();
    const events = await collect(run.events);
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', reason: 'interrupted' });
    expect(workspaceTools().map((x) => x.name)).toEqual(['read_file', 'list_dir', 'write_file']);
  });
});
