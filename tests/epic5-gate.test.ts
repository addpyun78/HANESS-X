import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentRegistry, PipelineRunner } from '@harness-x/agent-builder';
import {
  Dispatcher,
  EventLog,
  HookBus,
  PluginLoader,
  startApiServer,
  type LogRecord,
} from '@harness-x/kernel';
import { ForgeBroker, createForge, forgePlugin, registerForgeRoutes, type ForgeSpec } from '@harness-x/forge';
import { AgentListResponseSchema } from '@harness-x/protocol';
import { fakeEngine, type FakeCall } from '../packages/plugins-core/agent-builder/test/runner-helpers.js';
import {
  KOTLIN_HOOK_ALWAYS_ALLOW,
  KOTLIN_HOOK_OK,
  filesReply,
} from '../packages/plugins-core/forge/test/fixtures/kotlin-hook.js';

/**
 * T-052 52.6 EPIC 5 게이트 (유료 호출 없음 — 가짜 엔진)
 * "PR 전에 Kotlin 린트 실패 시 막는 훅 만들어줘"
 * / 목록의 /forge → POST /api/sessions → 인터뷰 카드 5장(사용자는 HTTP로 버튼 응답) → spec 확인 카드
 * → scaffold(가짜 엔진이 본문 작성; 첫 본문은 린트 결과를 무시) → check 통과 → test 실패 → scaffold 재작성 → test 통과
 * → 설치 카드(셸 빨간 경고·미서명·격리) → 설치: <home>/plugins/forge/pr-kotlin-guard Git 저장소.
 */

const REQ = 'PR 전에 Kotlin 린트 실패 시 막는 훅 만들어줘';

describe('52.6 EPIC 5 게이트: 대화로 훅 플러그인 생성 → 샌드박스 시험 → 설치', () => {
  it('"PR 전에 Kotlin 린트 실패 시 막는 훅 만들어줘" 완주', { timeout: 300_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hx-epic5-'));
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

    // 가짜 엔진(LLM): spec은 이름만 다듬고, scaffold는 처음엔 잘못된 본문 → 되돌림 뒤 올바른 본문
    const calls: FakeCall[] = [];
    let scaffolds = 0;
    const llm = fakeEngine(
      'fake',
      (o) => {
        if (o.env?.HARNESS_X_NODE === 'spec')
          return { text: '```json\n{"displayName":"PR 전 Kotlin 린트 가드"}\n```' };
        if (o.env?.HARNESS_X_NODE === 'scaffold')
          return { text: filesReply(scaffolds++ === 0 ? KOTLIN_HOOK_ALWAYS_ALLOW : KOTLIN_HOOK_OK) };
        return { text: '' };
      },
      calls,
    );

    const broker = new ForgeBroker({ log });
    const forge = createForge({ broker, log, home });
    const registry = new AgentRegistry({ plugins: () => [...loader.plugins.values(), forgePlugin()], home });
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
      // cli.ts와 같은 배선: /forge면 Forge 실행기 옵션
      run: (i) =>
        new PipelineRunner({
          workspace,
          sessionId: i.sessionId,
          log,
          onEvent: i.onEvent,
          signal: i.signal,
          ...(i.pipeline.name === 'forge'
            ? forge.runnerOptions({
                sessionId: i.sessionId,
                request: i.prompt,
                workspace,
                engines: (id) => (id === 'fake' ? llm : undefined),
                defaultEngine: i.modifiers.engine ?? 'fake',
              })
            : { engines: { fake: llm } }),
        }).run(i.pipeline, i.prompt),
    });
    const server = await startApiServer({
      loader,
      log,
      port: 0,
      tokenFile: join(home, 'run', 'token'),
      agents: () => registry.summaries(),
      dispatch,
      routes: (app) => registerForgeRoutes(app, broker),
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

    // 사용자: Forge 카드가 뜨면 버튼을 누른다 (질문은 제안 답, spec은 확인, 설치는 설치)
    const cards: LogRecord[] = [];
    const answered: Promise<unknown>[] = [];
    const off = log.subscribe((rec) => {
      if (rec.type !== 'approval_request' || !String(rec.kind).startsWith('forge_')) return;
      cards.push(rec);
      const detail = (rec.detail ?? {}) as { suggested?: unknown };
      const value =
        rec.kind === 'forge_spec' ? 'confirm' : rec.kind === 'forge_install' ? 'install' : detail.suggested;
      answered.push(
        api('POST', `/api/forge/answers/${encodeURIComponent(String(rec.approvalId))}`, { value }),
      );
    });

    try {
      // / 목록에 /forge
      const list = AgentListResponseSchema.parse((await api('GET', '/api/agents')).body).agents;
      expect(list.find((a) => a.command === '/forge')).toMatchObject({ nodeCount: 6, source: 'plugin' });

      const created = await api('POST', '/api/sessions', { agent: '/forge', prompt: `${REQ} @fake` });
      expect(created.status).toBe(201);
      const sessionId = created.body.sessionId as string;
      let s = created.body;
      const t0 = Date.now();
      while (s.status === 'running' && Date.now() - t0 < 240_000) {
        await new Promise((r) => setTimeout(r, 200));
        s = (await api('GET', `/api/sessions/${sessionId}`)).body;
      }
      expect(s).toMatchObject({
        status: 'completed',
        progress: 1,
        // test 실패로 scaffold를 한 번 더 돌았다
        completedNodes: ['interview', 'spec', 'scaffold', 'check', 'scaffold', 'test', 'install'],
      });
      const replies = (await Promise.all(answered)) as { status: number }[];
      expect(replies.every((r) => r.status === 200)).toBe(true);

      // 카드: 질문 5 → spec 확인 → 설치
      expect(cards.map((c) => c.kind)).toEqual([
        ...Array(5).fill('forge_question'),
        'forge_spec',
        'forge_install',
      ]);
      const spec = (cards[5]!.detail as { spec: ForgeSpec }).spec;
      expect(spec).toMatchObject({
        id: 'pr-kotlin-guard',
        displayName: 'PR 전 Kotlin 린트 가드',
        kind: 'hook',
        trigger: { hook: 'tool.before', match: 'gh pr create' },
        command: './gradlew ktlintCheck',
        permissions: { shell: true, net: [], fs: [] },
      });
      expect(cards[6]!.detail).toMatchObject({
        trust: 'unsigned-isolated',
        trustLabel: '미서명·격리',
        warnings: [{ kind: 'shell', level: 'danger' }],
      });

      // check 통과 → test 실패(린트 결과 무시) → scaffold 재작성 → test 통과
      const st = forge.session(sessionId)!;
      expect(st.scaffoldRuns).toBe(2);
      expect(st.gates.map((g) => `${g.gate}:${g.ok}`)).toEqual(['check:true', 'test:false', 'test:true']);
      expect(calls.filter((c) => c.node === 'scaffold')[1]!.prompt).toContain('결정 allow (기대 block)');

      // 설치: Git 저장소, 미서명·격리
      const installed = join(home, 'plugins', 'forge', 'pr-kotlin-guard');
      expect(st.installed).toMatchObject({
        dir: installed,
        trust: 'unsigned-isolated',
        trustLabel: '미서명·격리',
      });
      expect(existsSync(join(installed, '.git'))).toBe(true);
      expect(existsSync(join(installed, 'dist', 'index.js'))).toBe(true);
      expect(readFileSync(join(installed, 'src', 'index.ts'), 'utf8')).toBe(KOTLIN_HOOK_OK);
      expect(execFileSync('git', ['log', '--format=%s'], { cwd: installed, encoding: 'utf8' }).trim()).toBe(
        `forge: install pr-kotlin-guard (${sessionId})`,
      );

      // 이벤트 로그: 답변 7건, node_start/node_end 순서
      log.flush();
      expect(log.query({ sessionId, type: 'forge_answer' })).toHaveLength(7);
      const ends = log
        .query({ sessionId, type: 'node_end' })
        .map((e) => `${String(e.nodeId)}:${String(e.status)}`);
      expect(ends).toEqual([
        'interview:completed',
        'spec:completed',
        'scaffold:completed',
        'check:completed',
        'scaffold:completed',
        'test:completed',
        'install:completed',
      ]);
    } finally {
      off();
      await server.close();
      log.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
