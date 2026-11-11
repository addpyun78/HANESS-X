import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { existsSync, readFileSync } from 'node:fs';
import {
  FIRST_RUN_LABELS,
  HookBus,
  TOOL_FIRST_RUN_EVENT_KIND,
  wireInstaller,
  wireToolFinder,
} from '@harness-x/kernel';
import { checkPlainKorean } from '../../approvals/src/plain-korean.js';
import * as mcpHost from '@harness-x/mcp-host';
import * as permissionGate from '@harness-x/permission-gate';
import * as toolFinder from '@harness-x/tool-finder';
import { bootApi } from '../../../kernel/test/api-fixtures.js';
import * as installer from '../src/index.js';
import { allowTool, type InstallPlan } from '../src/index.js';
import { WINGET_SHOW_JQ, service, tempHome } from './helpers.js';

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

const JQ = {
  'winget show --id jqlang.jq': { stdout: WINGET_SHOW_JQ },
  'winget install --id jqlang.jq': { stdout: 'Successfully installed' },
  'winget list --id jqlang.jq': { stdout: 'jq jqlang.jq 1.7.1' },
  'powershell.exe -NoProfile -Command': {
    stdout: 'C:\\Users\\u\\AppData\\Local\\Microsoft\\WinGet\\Links\\jq.exe',
  },
};

/** 도구 찾기 공급자 (네트워크 없음): 'jq' 후보 1개 */
const fakeProvider = {
  id: 'fake-repo',
  kind: 'package' as const,
  label: '가짜 저장소',
  available: () => true,
  search: async () => [
    {
      providerId: 'fake-repo',
      name: 'jq',
      summary: 'JSON 읽기 도구',
      officialUrl: 'https://jqlang.github.io/jq',
      sourceUrl: 'https://winget.run/pkg/jqlang/jq',
      packageRepo: true,
      license: 'MIT',
      installMethod: { kind: 'winget' as const, id: 'jqlang.jq', label: '윈도우 공식 앱 저장소' },
      os: ['windows' as const],
    },
  ],
};

/** cli.ts serve와 같은 연결: 로드된 플러그인 모듈(구조적) → wireInstaller + wireToolFinder → startApiServer */
async function boot() {
  const h = tempHome();
  cleanups.push(h.cleanup);
  const { svc, runner } = service(h.dir, JQ);
  const plugins = new Map<string, { module: unknown }>([
    ['installer', { module: { ...installer, activeInstallService: () => svc } }],
    ['mcp-host', { module: mcpHost }],
    ['permission-gate', { module: permissionGate }],
    ['tool-finder', { module: toolFinder }],
  ]);
  const hooks = new HookBus();
  const iw = wireInstaller({ plugins, hooks, detect: false })!;
  const events: Record<string, unknown>[] = [];
  const tw = wireToolFinder({
    plugins,
    service: iw.service,
    log: { append: (e) => events.push(e as Record<string, unknown>) },
    finderOptions: { packageProviders: [fakeProvider], webProviders: [], fetch: undefined, runner },
  })!;
  cleanups.push(() => {
    iw.dispose();
    tw.dispose();
  });
  const api = await bootApi({ install: iw.install, toolFinder: tw.toolFinder });
  cleanups.push(() => api.close());
  // mcp-host가 접속마다 만드는 하네스 MCP 서버와 같은 옵션
  const server = mcpHost.createHarnessMcpServer(
    mcpHost.openSession({ dir: h.dir }),
    mcpHost.harnessMcpExtras(),
  );
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: 'engine', version: '0' });
  await client.connect(b);
  cleanups.push(() => client.close());
  return { h, svc, runner, hooks, iw, tw, api, client, events, plugins };
}

describe('T-100 Part 2·3 serve 연결 (cli.ts와 같은 wireInstaller·wireToolFinder)', () => {
  it('P2-C.7·G.5 서버 E2E: AI(MCP)가 install.plan → 같은 서비스의 계획 → 사람 클릭 토큰으로만 실행', async () => {
    const { api, client, svc, runner } = await boot();
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(['install.search', 'install.resolve', 'install.plan', 'tools.request']),
    );
    expect(names.filter((n) => /execute|uninstall/.test(n))).toEqual([]);
    const r = await client.callTool({
      name: 'install.plan',
      arguments: { kind: 'winget', target: { id: 'jqlang.jq' } },
    });
    const plan = r.structuredContent as InstallPlan;
    expect(plan.id).toMatch(/^plan_/);
    // 화면이 보는 API에도 같은 계획 (계획 id 공유)
    expect((await api.get(`/api/install/plans/${plan.id}`, api.auth)).status).toBe(200);
    // 토큰 없이 실행 → 403, 설치 명령 0건
    expect((await api.post('/api/install/execute', { planId: plan.id }, api.auth)).status).toBe(403);
    expect(runner.calls.filter((c) => c.line.startsWith('winget install'))).toEqual([]);
    const tok = (await (await api.post('/api/gesture-tokens', { kind: 'install' }, api.auth)).json()) as {
      token: string;
    };
    const res = await api.post(
      '/api/install/execute',
      { planId: plan.id },
      { ...api.auth, 'x-harness-gesture': tok.token },
    );
    expect(res.status).toBe(202);
    await expect
      .poll(() => svc.tools().tools.map((t) => t.id), { timeout: 10_000 })
      .toEqual(['winget:jqlang.jq']);
  });

  it('first-run gate: 새로 설치한 도구의 첫 실행은 막고, tools allow(<home>/tools/allowed.json) 뒤에는 통과', async () => {
    const { svc, hooks, iw, plugins } = await boot();
    const p = (await svc.plan({ kind: 'winget', target: { id: 'jqlang.jq' } })) as InstallPlan;
    await svc.execute(p.id, { gestureId: 'g' }).done;
    const run = (bus: HookBus) =>
      bus.runBlocking('tool.before', { tool: 'Bash', input: { command: 'jq . a.json' } });
    const first = await run(hooks);
    expect(first.decision).toBe('deny');
    expect(first.reason).toMatch(/first_run_approval/);
    expect(
      (await hooks.runBlocking('tool.before', { tool: 'Bash', input: { command: 'ls' } })).decision,
    ).toBe('allow');
    expect(iw.allowedFile).toBe(installer.allowedFile(svc.home));
    allowTool(svc.home, 'winget:jqlang.jq');
    // 다시 연결(재시작)하면 기억 파일을 읽어 묻지 않는다
    iw.dispose();
    const hooks2 = new HookBus();
    const iw2 = wireInstaller({ plugins, hooks: hooks2, detect: false })!;
    cleanups.push(() => iw2.dispose());
    expect((await run(hooks2)).decision).toBe('allow');
  });

  it('P2-F.6 보강: 첫 실행은 패널 카드로 묻고 클릭을 기다림 → "앞으로 허락"은 바로 기록, 두 번째는 묻지 않음', async () => {
    const { svc, plugins } = await boot();
    const p = (await svc.plan({ kind: 'winget', target: { id: 'jqlang.jq' } })) as InstallPlan;
    await svc.execute(p.id, { gestureId: 'g' }).done;
    const events: Record<string, unknown>[] = [];
    const hooks = new HookBus();
    const iw = wireInstaller({
      plugins,
      hooks,
      detect: false,
      log: { append: (e) => events.push(e as Record<string, unknown>) },
    })!;
    cleanups.push(() => iw.dispose());
    const api = await bootApi({ install: iw.install });
    cleanups.push(() => api.close());
    const run = () => hooks.runBlocking('tool.before', { tool: 'Bash', input: { command: 'jq . a.json' } });
    const cards = () => events.filter((e) => e.type === 'approval_request');

    const pending = run();
    await expect.poll(() => cards().length).toBe(1);
    const card = cards()[0]!;
    expect(card).toMatchObject({
      kind: TOOL_FIRST_RUN_EVENT_KIND,
      sessionId: 'tools',
      options: ['once', 'always', 'deny'],
    });
    // 카드 문구는 쉬운 말 (버튼은 라벨 규칙)
    const d = card.detail as {
      whatHappened: string;
      whyAsking: string;
      timeoutNote: string;
      toolName: string;
    };
    expect(d.toolName).toBe('jq');
    for (const t of [d.whatHappened, d.whyAsking, d.timeoutNote])
      expect(checkPlainKorean(t).ok, t).toBe(true);
    for (const t of Object.values(FIRST_RUN_LABELS))
      expect(checkPlainKorean(t, { label: true }).ok, t).toBe(true);
    expect(checkPlainKorean(card.title as string, { label: true }).ok).toBe(true);
    expect(
      (await api.get('/api/install/first-run', api.auth).then((r) => r.json())) as unknown,
    ).toMatchObject({
      pending: [{ id: card.approvalId, toolName: 'jq' }],
    });
    // 잘못된 선택 400, 패널의 [앞으로 허락] 클릭 → 실행 허락 + allowed.json 바로 기록
    expect(
      (await api.post(`/api/install/first-run/${String(card.approvalId)}`, { choice: 'yes' }, api.auth))
        .status,
    ).toBe(400);
    const res = await api.post(
      `/api/install/first-run/${String(card.approvalId)}`,
      { choice: 'always' },
      api.auth,
    );
    expect(res.status).toBe(200);
    expect((await pending).decision).toBe('allow');
    expect(JSON.parse(readFileSync(iw.allowedFile, 'utf8'))).toMatchObject({ allowed: ['winget:jqlang.jq'] });
    expect(events.find((e) => e.type === 'approval_resolved')).toMatchObject({
      approvalId: card.approvalId,
      choice: 'always',
    });
    // 두 번째 실행: 묻지 않음 (재시작 없음)
    expect((await run()).decision).toBe('allow');
    expect(cards()).toHaveLength(1);
    // 이미 끝난 카드에 다시 답 → 404
    expect(
      (await api.post(`/api/install/first-run/${String(card.approvalId)}`, { choice: 'once' }, api.auth))
        .status,
    ).toBe(404);
  });

  it('P2-F.6 보강: 시간 안에 안 고르면 거부 (자동 허락 없음), 파일 기록 없음 · CLI allow는 재시작 없이 반영', async () => {
    const { svc, plugins } = await boot();
    const p = (await svc.plan({ kind: 'winget', target: { id: 'jqlang.jq' } })) as InstallPlan;
    await svc.execute(p.id, { gestureId: 'g' }).done;
    const events: Record<string, unknown>[] = [];
    const hooks = new HookBus();
    const iw = wireInstaller({
      plugins,
      hooks,
      detect: false,
      log: { append: (e) => events.push(e as Record<string, unknown>) },
      firstRunTimeoutMs: 200,
    })!;
    cleanups.push(() => iw.dispose());
    const run = () => hooks.runBlocking('tool.before', { tool: 'Bash', input: { command: 'jq . a.json' } });
    const r = await run();
    expect(r.decision).toBe('deny');
    expect(r.reason).toMatch(/first_run_denied/);
    expect(events.find((e) => e.type === 'approval_resolved')).toMatchObject({
      choice: 'deny',
      by: 'timeout',
    });
    expect(existsSync(iw.allowedFile)).toBe(false);
    expect(iw.firstRun.pending()).toEqual([]);
    // 다른 곳(CLI `harness-x tools allow`)에서 기록 → 같은 게이트가 다음 검사에서 바로 반영
    allowTool(svc.home, 'winget:jqlang.jq');
    expect((await run()).decision).toBe('allow');
    expect(events.filter((e) => e.type === 'approval_request')).toHaveLength(1);
  });

  it('Part 3: /api/tools/* · tools.request(MCP) → 도구 고르기 카드 이벤트 · plan-selected는 계획까지만', async () => {
    const { api, client, events, runner } = await boot();
    const r = await client.callTool({ name: 'tools.request', arguments: { capability: 'JSON 파일 읽기' } });
    expect(r.structuredContent).toMatchObject({ status: 'waiting-user' });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'approval_request', kind: 'tool.picker', sessionId: 'tools' });
    const result = (events[0]!.detail as { result: { need: unknown; candidates: { id: string }[] } }).result;
    expect(result.candidates.length).toBeGreaterThan(0);
    const found = (await (
      await api.post('/api/tools/find', { capability: 'JSON 파일 읽기' }, api.auth)
    ).json()) as {
      status: string;
    };
    expect(found.status).toBe('candidates');
    const sel = (await (
      await api.post(
        '/api/tools/plan-selected',
        { need: result.need, candidates: [result.candidates[0]] },
        api.auth,
      )
    ).json()) as { plans: { plan?: InstallPlan }[] };
    expect(sel.plans[0]!.plan).toMatchObject({ kind: 'winget', target: 'jqlang.jq' });
    expect(runner.calls.filter((c) => c.line.startsWith('winget install'))).toEqual([]);
  });

  it('설치 관리자가 없으면 연결하지 않는다', () => {
    const plugins = new Map<string, { module: unknown }>([['mcp-host', { module: mcpHost }]]);
    expect(wireInstaller({ plugins, hooks: new HookBus(), detect: false })).toBeUndefined();
  });
});
