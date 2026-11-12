import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { EngineAdapter, EngineRunOptions, HarnessEvent } from '@harness-x/protocol';
import { StageTreeStore } from '@harness-x/checklist-ledger';
import {
  Dispatcher,
  EventLog,
  createResumeService,
  eventFactory,
  stageTreeResolver,
  type DispatchAgent,
} from '@harness-x/kernel';
import { PipelineRunner, stageRunnerOptions } from '../src/index.js';
import { completeItems, items, tmpWorkspace } from './runner-helpers.js';
import { json } from './stages-run.js';
import { THREE } from './stages-pipelines.js';

let ws: ReturnType<typeof tmpWorkspace>;
afterEach(() => ws?.cleanup());

/** 노드별 대본 엔진: build 첫 턴은 build1만 하고 멈출 때까지 기다린다 */
function engine() {
  const calls: EngineRunOptions[] = [];
  const e: EngineAdapter = {
    id: 'fake',
    displayName: 'fake',
    capabilities: { nativeStopHook: false, resume: false, mcp: false, interrupt: true },
    run(o) {
      calls.push(o);
      const node = o.env?.HARNESS_X_NODE;
      const first = calls.filter((c) => c.env?.HARNESS_X_NODE === node).length === 1;
      const ev = eventFactory({ sessionId: o.sessionId, engineId: 'fake' });
      async function* events(): AsyncGenerator<HarnessEvent> {
        if (node === 'build' && first) {
          completeItems(o, ['build1']);
          await new Promise<void>((r) => {
            if (o.signal?.aborted) return r();
            o.signal?.addEventListener('abort', () => r(), { once: true });
          });
          yield ev({ type: 'turn_end', reason: 'interrupted' });
          return;
        }
        completeItems(o);
        const out =
          node === 'plan'
            ? { screens: ['home'], summary: '화면 1개를 고치기로 했어요.' }
            : { summary: '맡은 일을 마쳤어요.' };
        yield ev({ type: 'assistant_text', text: json(out), partial: false });
        yield ev({ type: 'turn_end', reason: 'completed' });
      }
      return {
        events: events(),
        engineSessionId: () => undefined,
        interrupt: async () => {},
        done: Promise.resolve({ exitCode: 0 }),
      };
    },
  };
  return { e, calls };
}

async function until(fn: () => boolean, ms = 10_000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('시간 초과');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('4F.6 이어하기를 단계 트리 기준으로 (3단계 에이전트 멈춤 → 이어하기 리플레이)', () => {
  it('카드 진행률 "단계 2/3 · 항목 1/2", 재구성 컨텍스트에 단계 트리·handoff, 이어서 끝까지', async () => {
    ws = tmpWorkspace();
    const log = new EventLog({ root: join(ws.dir, 'logs') });
    const { e, calls } = engine();
    const agent: DispatchAgent = { name: 'three', command: '/three', displayName: '셋', pipeline: THREE };
    const d = new Dispatcher({
      log,
      resolve: (n) => (n.replace('/', '') === 'three' ? agent : undefined),
      engines: () => ['fake'],
      run: (i) =>
        new PipelineRunner({
          engines: { fake: e },
          workspace: ws.dir,
          sessionId: i.sessionId,
          log,
          onEvent: i.onEvent,
          signal: i.signal,
          checklists: (n) => (n.type === 'role' ? items(n.id, 2) : undefined),
          // cli.ts와 같은 연결: 실행 시작 순간 stages.json
          ...stageRunnerOptions({
            workspace: ws.dir,
            sessionId: i.sessionId,
            agent: { name: 'three', pipeline: i.pipeline },
          }),
        }).run(i.pipeline, i.prompt),
    });
    const stages = stageTreeResolver(ws.dir);
    const service = createResumeService({
      log,
      dispatcher: d,
      agentFor: (n) => (n === 'three' ? agent : undefined),
      engines: () => ['fake'],
      stages,
    });
    const s = d.dispatch({ agent: 'three', prompt: '화면 고쳐 줘' });
    await until(() => calls.some((c) => c.env?.HARNESS_X_NODE === 'build'));
    await d.stopNow(s.sessionId);
    await until(() => d.get(s.sessionId)?.status === 'paused');
    log.flush();

    // 이어하기 카드: 단계 기준 진행률
    const card = service.list().find((x) => x.sessionId === s.sessionId)!;
    expect(card.stageProgress).toBe('단계 2/3 · 항목 1/2');

    // 이어하기: 재구성 컨텍스트에 단계 트리·handoff
    const r = await service.start(s.sessionId);
    expect(r.mode).toBe('summary');
    expect(r.prompt).toContain('단계 트리:');
    expect(r.prompt).toContain('1) plan 단계 [done] — 화면 1개를 고치기로 했어요.');
    expect(r.prompt).toContain('2) build 단계 [running] ← 지금');
    expect(r.prompt).toContain('- plan: {"screens":["home"],"summary":"화면 1개를 고치기로 했어요."}');
    const end = await d.wait(s.sessionId);
    expect(end.status).toBe('completed');

    // 같은 트리를 이어 써서 끝까지
    const tree = new StageTreeStore({
      dir: join(ws.dir, '.harness-x', 'sessions', s.sessionId),
      sessionId: s.sessionId,
    }).read()!;
    expect(tree.stages.map((x) => [x.stageId, x.status])).toEqual([
      ['plan', 'done'],
      ['build', 'done'],
      ['test', 'done'],
    ]);
    log.close();
  });

  it('7일 이상 쉬면 "지금까지 한 일"에 단계 요약을 쓴다', async () => {
    const { stageRecap } = await import('@harness-x/kernel');
    expect(
      stageRecap({
        stages: [
          {
            stageId: 'plan',
            title: 'plan',
            kind: 'role',
            status: 'done',
            summary: '화면 1개를 고치기로 했어요.',
            items: [],
            children: [],
          },
          { stageId: 'build', title: 'build', kind: 'role', status: 'running', items: [], children: [] },
        ],
      }),
    ).toEqual([{ id: 'plan', title: 'plan: 화면 1개를 고치기로 했어요.' }]);
  });
});
