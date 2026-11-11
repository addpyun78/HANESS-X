import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentRegistry, PipelineRunner } from '@harness-x/agent-builder';
import { ChecklistLedger, checklistStatus } from '@harness-x/checklist-ledger';
import { Dispatcher, EventLog, HookBus, PluginLoader, startApiServer } from '@harness-x/kernel';
import { AgentListResponseSchema } from '@harness-x/protocol';
import { emptyGraph } from '../apps/web/src/builder/graph.js';
import { inspectorReducer, type InspectorAction } from '../apps/web/src/builder/inspector/model.js';
import { buildSaveRequest } from '../apps/web/src/builder/inspector/save.js';
import {
  completeItems,
  fakeEngine,
  items,
  type FakeCall,
} from '../packages/plugins-core/agent-builder/test/runner-helpers.js';

/**
 * T-048 48.5 EPIC 4 게이트 (유료 호출 없음 — 가짜 엔진)
 * 빌더 모델로 3노드 에이전트를 만든다 → PUT /api/agents/:name 저장 → GET /api/agents(/ 목록)에 나타남
 * → POST /api/sessions로 /명령 + 지시문 실행(@fake 수식어) → 노드마다 체크리스트 전 항목 done, 세션 completed.
 */

describe('48.5 EPIC 4 게이트: 빌더로 만든 3노드 에이전트를 /로 실행해 체크리스트 완료', () => {
  it('build → save → / list → dispatch → checklist complete', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hx-epic4-'));
    const home = join(dir, 'home');
    const workspace = join(dir, 'ws');
    mkdirSync(workspace, { recursive: true });
    const log = new EventLog({ root: join(dir, 'logs') });
    const loader = new PluginLoader({
      hooks: new HookBus({ log }),
      log,
      roots: [],
      lockFile: join(home, 'plugins.lock'),
    });
    await loader.loadAll();

    // 1) 빌더 모델: 노드 3개 끌어 놓기 → 연결 → 인스펙터에서 이름·체크리스트 템플릿 지정
    const acts: InspectorAction[] = [
      { type: 'addNode', nodeType: 'role', position: { x: 0, y: 0 }, id: 'plan' },
      { type: 'addNode', nodeType: 'role', position: { x: 240, y: 0 }, id: 'build' },
      { type: 'addNode', nodeType: 'role', position: { x: 480, y: 0 }, id: 'critic' },
      { type: 'connect', from: 'plan', to: 'build' },
      { type: 'connect', from: 'build', to: 'critic' },
      { type: 'attachSkill', nodeId: 'build', skill: 'code-review' },
      ...['plan', 'build', 'critic'].map((id): InspectorAction => ({
        type: 'patchNode',
        nodeId: id,
        patch: { label: id.toUpperCase(), checklistTemplate: id },
      })),
    ];
    const graph = acts.reduce(inspectorReducer, emptyGraph());
    expect(graph.nodes).toHaveLength(3);
    const req = buildSaveRequest(graph, { name: 'ui-review', displayName: 'UI 리뷰', icon: '🔍' });

    // 2) 서버: 저장 라우트 + 레지스트리(/ 목록) + 디스패처(실행기 주입, 가짜 엔진)
    const calls: FakeCall[] = [];
    const engine = fakeEngine('fake', () => ({ text: '완료', effect: (o) => completeItems(o) }), calls);
    const registry = new AgentRegistry({ plugins: () => loader.plugins.values(), home });
    const dispatch = new Dispatcher({
      log,
      engines: () => ['fake'],
      resolve: (name) => {
        const a = registry.get(name);
        return (
          a && {
            name: a.name,
            command: a.command,
            displayName: a.agent.displayName,
            ...(a.agent.icon ? { icon: a.agent.icon } : {}),
            pipeline: a.pipeline,
          }
        );
      },
      run: (i) =>
        new PipelineRunner({
          engines: { fake: engine },
          workspace,
          sessionId: i.sessionId,
          log,
          onEvent: i.onEvent,
          signal: i.signal,
          checklists: (_node, template) => (template ? items(template, 2) : undefined),
        }).run(i.pipeline, i.prompt),
    });
    const server = await startApiServer({
      loader,
      log,
      port: 0,
      tokenFile: join(home, 'run', 'token'),
      agentsHome: home,
      agents: () => registry.summaries(),
      dispatch,
    });
    const auth = { authorization: `Bearer ${server.token}`, 'content-type': 'application/json' };
    const api = async (method: string, path: string, body?: unknown) => {
      const r = await fetch(server.url + path, {
        method,
        headers: auth,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      return { status: r.status, body: (await r.json()) as Record<string, unknown> };
    };

    try {
      // T-100 보강-1: 저장은 사람 클릭 토큰(save-agent)이 있어야만 된다
      const gesture = await api('POST', '/api/gesture-tokens', { kind: 'save-agent' });
      expect(gesture.status).toBe(201);
      const savedRes = await fetch(server.url + '/api/agents/ui-review', {
        method: 'PUT',
        headers: { ...auth, 'x-harness-gesture': String(gesture.body.token) },
        body: JSON.stringify(req),
      });
      const saved = { status: savedRes.status };
      expect(saved.status).toBe(201);

      // 3) / 목록에 등장
      const list = AgentListResponseSchema.parse((await api('GET', '/api/agents')).body).agents;
      expect(list.find((a) => a.command === '/ui-review')).toMatchObject({
        nodeCount: 3,
        source: 'user',
        icon: '🔍',
      });

      // 4) /ui-review + 지시문(@fake: 이번 실행만 엔진 교체) → 새 세션
      const created = await api('POST', '/api/sessions', {
        agent: '/ui-review',
        prompt: '헤더를 점검해 줘 @fake',
      });
      expect(created.status).toBe(201);
      const sessionId = created.body.sessionId as string;
      expect(created.body).toMatchObject({
        prompt: '헤더를 점검해 줘',
        modifiers: { engine: 'fake' },
        nodeCount: 3,
      });

      let s = created.body;
      const t0 = Date.now();
      while (s.status === 'running' && Date.now() - t0 < 30_000) {
        await new Promise((r) => setTimeout(r, 100));
        s = (await api('GET', `/api/sessions/${sessionId}`)).body;
      }
      expect(s).toMatchObject({
        status: 'completed',
        progress: 1,
        completedNodes: ['plan', 'build', 'critic'],
      });
      expect(calls.map((c) => c.node)).toEqual(['plan', 'build', 'critic']);
      expect(calls[0]!.prompt).toContain('헤더를 점검해 줘');

      // 5) 노드마다 체크리스트 전 항목 done
      for (const id of ['plan', 'build', 'critic']) {
        const ledger = new ChecklistLedger({
          dir: join(workspace, '.harness-x', 'sessions', sessionId, 'nodes', `${id}.1`),
          sessionId,
        });
        const st = checklistStatus(ledger);
        expect(st).toMatchObject({ exists: true, complete: true, total: 2, remaining: 0 });
      }

      // 이벤트 로그: session_created → node_start/node_end ×3 → session_end
      log.flush();
      const marks = log
        .query({ sessionId })
        .filter((e) => ['session_created', 'node_start', 'node_end', 'session_end'].includes(e.type))
        .map((e) => `${e.type}${e.nodeId ? `:${String(e.nodeId)}` : ''}`);
      expect(marks).toEqual([
        'session_created',
        'node_start:plan',
        'node_end:plan',
        'node_start:build',
        'node_end:build',
        'node_start:critic',
        'node_end:critic',
        'session_end',
      ]);
    } finally {
      await server.close();
      log.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
