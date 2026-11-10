import { cpSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentRegistry, PipelineRunner } from '@harness-x/agent-builder';
import { ChecklistLedger, checklistStatus } from '@harness-x/checklist-ledger';
import {
  Dispatcher,
  EventLog,
  HookBus,
  PluginLoader,
  WorkspaceStore,
  startApiServer,
} from '@harness-x/kernel';
import {
  completeItems,
  fakeEngine,
  items,
  type FakeCall,
} from '../packages/plugins-core/agent-builder/test/runner-helpers.js';
import { repoPath, tempDir } from './helpers.js';

/**
 * T-064 64.2 + 버튼 → 폴더 선택 → /design-qa 실행 → 체크리스트 완료 (피커 모킹, 유료 호출 없음)
 * 웹의 + 버튼(폴더 열기)이 부르는 API 순서를 그대로 따른다:
 *   POST /api/native/pick-folder (모킹한 대화상자가 폴더를 돌려줌) → POST /api/workspaces/open
 *   → POST /api/sessions {agent: '/design-qa'} (세션 작업 폴더 = 고른 폴더) → plan·build·critic 체크리스트 전 항목 done
 * design-qa는 examples/agents/design-qa (plan=claude-code, build=codex, critic=antigravity — 가짜 엔진 3개)
 */

const OUTPUTS: Record<string, unknown> = {
  plan: { tasks: ['로그인 폼 정렬', '버튼 대비 수정'], acceptance: ['WCAG AA 대비'] },
  build: { changedFiles: ['src/Login.tsx'] },
  critic: { verdict: 'pass', issues: [] },
};

describe('64.2 + 버튼 → 폴더 선택 → /design-qa → 체크리스트 완료', () => {
  it('피커 모킹 → 워크스페이스 열기 → 디스패치 → 3노드 체크리스트 완료', { timeout: 180_000 }, async () => {
    const t = tempDir('hx-e2e-plus-');
    const home = join(t.dir, 'home');
    const picked = join(t.dir, 'projects', 'login-app');
    mkdirSync(picked, { recursive: true });
    // 사용자 에이전트로 design-qa 설치
    cpSync(repoPath('examples/agents/design-qa'), join(home, 'agents', 'design-qa'), { recursive: true });
    const log = new EventLog({ root: join(t.dir, 'logs') });
    const loader = new PluginLoader({
      hooks: new HookBus({ log }),
      log,
      roots: [],
      lockFile: join(home, 'plugins.lock'),
    });
    await loader.loadAll();
    const workspaces = new WorkspaceStore({ file: join(home, 'workspaces.json') });

    const calls: FakeCall[] = [];
    const cwds: string[] = [];
    const engine = (id: string) =>
      fakeEngine(
        id,
        (o) => {
          cwds.push(o.cwd);
          const node = o.env?.HARNESS_X_NODE ?? '';
          return {
            text: '완료\n```json\n' + JSON.stringify(OUTPUTS[node] ?? {}) + '\n```',
            effect: (x) => completeItems(x),
          };
        },
        calls,
      );
    const engines = {
      'claude-code': engine('claude-code'),
      codex: engine('codex'),
      antigravity: engine('antigravity'),
    };
    const registry = new AgentRegistry({ plugins: () => loader.plugins.values(), home });
    let picks = 0;
    const dispatch = new Dispatcher({
      log,
      engines: () => Object.keys(engines),
      resolve: (name) => {
        const a = registry.get(name);
        return (
          a && { name: a.name, command: a.command, displayName: a.agent.displayName, pipeline: a.pipeline }
        );
      },
      run: (i) =>
        new PipelineRunner({
          engines,
          // 세션 작업 폴더 = 지금 열린 워크스페이스 (+ 버튼으로 고른 폴더)
          workspace: workspaces.sessionCwd(t.dir),
          sessionId: i.sessionId,
          log,
          onEvent: i.onEvent,
          signal: i.signal,
          checklists: (node, template) => (template ? items(node.id, 2) : undefined),
        }).run(i.pipeline, i.prompt),
    });
    const server = await startApiServer({
      loader,
      log,
      port: 0,
      tokenFile: join(home, 'run', 'token'),
      agents: () => registry.summaries(),
      dispatch,
      workspaces,
      folderPicker: {
        pick: async () => {
          picks++;
          return { cancelled: false, path: picked };
        },
      },
    });
    const api = async (method: string, path: string, body?: unknown) => {
      const r = await fetch(server.url + path, {
        method,
        headers: { authorization: `Bearer ${server.token}`, 'content-type': 'application/json' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      return { status: r.status, body: (await r.json()) as Record<string, unknown> };
    };

    try {
      // + 버튼 → 폴더 선택 (모킹 대화상자)
      const pick = await api('POST', '/api/native/pick-folder', {});
      expect(pick).toMatchObject({ status: 200, body: { cancelled: false, path: picked } });
      expect(picks).toBe(1);
      const opened = await api('POST', '/api/workspaces/open', { path: pick.body.path });
      expect(opened.status).toBe(200);
      const ws = (opened.body.workspace as { path: string }).path;
      expect(realpathSync(ws)).toBe(realpathSync(picked));
      expect((await api('GET', '/api/workspaces')).body).toMatchObject({ current: { path: ws }, cwd: ws });

      // /design-qa 실행
      const agents = (await api('GET', '/api/agents')).body.agents as {
        command: string;
        nodeCount: number;
      }[];
      expect(agents.find((a) => a.command === '/design-qa')).toMatchObject({ nodeCount: 3 });
      const created = await api('POST', '/api/sessions', {
        agent: '/design-qa',
        prompt: '로그인 화면 디자인 QA',
      });
      expect(created.status).toBe(201);
      const sessionId = created.body.sessionId as string;
      let s = created.body;
      const t0 = Date.now();
      while (s.status === 'running' && Date.now() - t0 < 60_000) {
        await new Promise((r) => setTimeout(r, 100));
        s = (await api('GET', `/api/sessions/${sessionId}`)).body;
      }
      expect(s).toMatchObject({
        status: 'completed',
        progress: 1,
        completedNodes: ['plan', 'build', 'critic'],
      });
      expect(calls.map((c) => `${c.node}@${c.engineId}`)).toEqual([
        'plan@claude-code',
        'build@codex',
        'critic@antigravity',
      ]);
      expect(new Set(cwds)).toEqual(new Set([ws]));

      // 고른 폴더 안의 노드 체크리스트 전 항목 done
      for (const id of ['plan', 'build', 'critic']) {
        const ledger = new ChecklistLedger({
          dir: join(ws, '.harness-x', 'sessions', sessionId, 'nodes', `${id}.1`),
          sessionId,
        });
        expect(checklistStatus(ledger)).toMatchObject({
          exists: true,
          complete: true,
          total: 2,
          remaining: 0,
        });
      }
    } finally {
      await server.close();
      log.close();
      t.cleanup();
    }
  });
});
