import { afterEach, describe, expect, it } from 'vitest';
import type { EngineAdapter, EngineRun } from '@harness-x/protocol';
import { Dispatcher, eventFactory, runLineProcess, type LogRecord } from '@harness-x/kernel';
import { PipelineRunner } from '../src/index.js';
import { pipeline, tmpWorkspace } from './runner-helpers.js';

let ws: ReturnType<typeof tmpWorkspace>;
afterEach(() => ws?.cleanup());

const BRANCHES = ['r1', 'r2', 'r3'];
const P = pipeline({
  name: 'fan',
  nodes: [
    { id: 'split', type: 'fanout', maxConcurrency: 3 },
    ...BRANCHES.map((id) => ({ id, type: 'role' as const, engine: 'slow' })),
    { id: 'merge', type: 'join' },
    { id: 'final', type: 'role', engine: 'slow' },
  ],
  edges: [
    ...BRANCHES.flatMap((id) => [
      { from: 'split', to: id },
      { from: id, to: 'merge' },
    ]),
    { from: 'merge', to: 'final' },
  ],
});

/** 노드마다 실제 자식 프로세스(sleep 300)를 띄우는 엔진 — signal이 오면 프로세스 그룹 종료 */
function slowEngine() {
  const started: string[] = [];
  const runs: { node: string; run: EngineRun }[] = [];
  const engine: EngineAdapter = {
    id: 'slow',
    displayName: 'slow',
    capabilities: { nativeStopHook: false, resume: false, mcp: false, interrupt: true },
    run(o) {
      const node = o.env?.HARNESS_X_NODE ?? '?';
      started.push(node);
      const run = runLineProcess({
        command: 'sh',
        args: ['-c', 'sleep 300 & wait'],
        cwd: o.cwd,
        ...(o.signal ? { signal: o.signal } : {}),
        event: eventFactory({ sessionId: o.sessionId, engineId: 'slow' }),
        parser: {
          line: () => [],
          finish: () => [{ type: 'turn_end', reason: 'completed' }],
          sessionId: () => undefined,
        },
      });
      runs.push({ node, run });
      return run;
    },
  };
  return { engine, started, runs };
}

describe.skipIf(process.platform === 'win32')('2A.7 파이프라인 정지 시 병렬 노드 전부 정지', () => {
  it('fanout 3갈래 실행 중 지금 멈추기 → 3갈래 모두 interrupted, join 뒤(final) 시작 안 함, 세션 paused', async () => {
    ws = tmpWorkspace();
    const e = slowEngine();
    const seen: LogRecord[] = [];
    const d = new Dispatcher({
      resolve: () => ({ name: 'fan', command: '/fan', displayName: 'FAN', pipeline: P }),
      run: (i) =>
        new PipelineRunner({
          engines: { slow: e.engine },
          workspace: ws.dir,
          sessionId: i.sessionId,
          onEvent: i.onEvent,
          log: { append: (r: LogRecord) => seen.push(r) },
          signal: i.signal,
        }).run(i.pipeline, i.prompt),
      log: { append: (r) => seen.push(r) },
    });
    const s = d.dispatch({ agent: 'fan', prompt: '병렬' });
    for (let k = 0; k < 200 && e.runs.length < 3; k++) await new Promise((r) => setTimeout(r, 20));
    expect(e.started.sort()).toEqual(BRANCHES);
    const t0 = Date.now();
    const r = await d.stopNow(s.sessionId);
    expect(r.state).toBe('paused');
    expect(Date.now() - t0).toBeLessThan(5000);
    const dones = await Promise.all(e.runs.map((x) => x.run.done));
    expect(dones).toHaveLength(3);
    // 모든 갈래의 엔진 턴이 interrupted로 끝남
    const ends = seen.filter((x) => x.type === 'turn_end');
    expect(ends).toHaveLength(3);
    expect(ends.every((x) => x.reason === 'interrupted')).toBe(true);
    expect(e.started).not.toContain('final');
    expect(d.get(s.sessionId)).toMatchObject({ status: 'paused', paused: { reason: 'user' } });
    expect(seen.filter((x) => x.type === 'session_paused')).toHaveLength(1);
  });
});
