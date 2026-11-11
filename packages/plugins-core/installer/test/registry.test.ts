import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HookBus } from '@harness-x/kernel';
import { installToolFirstRunGate } from '@harness-x/permission-gate';
import {
  INSTALLED_TOOLS_SKILL,
  InstalledToolsProjector,
  ToolEntrySchema,
  ToolRegistry,
  claudeMcpConfigWithInstalled,
  codexMcpArgsForInstalled,
  registryFile,
  type InstallPlan,
} from '../src/index.js';
import { WINGET_SHOW_JQ, approval, service, tempHome } from './helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((f) => f()));
const home = () => {
  const h = tempHome();
  cleanups.push(h.cleanup);
  return h.dir;
};

const ENTRY = {
  id: 'winget:jqlang.jq',
  name: 'jq',
  kind: 'winget',
  version: '1.7.1',
  command: 'C:\\Users\\u\\AppData\\Local\\Microsoft\\WinGet\\Links\\jq.exe',
  pricing: {
    tier: 'free',
    note: '무료예요.',
    checkedAt: '2026-11-11T00:00:00Z',
    sourceUrl: 'https://jqlang.github.io/jq',
  },
  license: { id: 'MIT', plain: '누구나 무료로 쓸 수 있어요.' },
  source: { url: 'https://jqlang.github.io/jq', publisher: 'jqlang', verified: true },
  installedAt: '2026-11-11T00:00:00Z',
  origin: 'installed',
  purpose: 'JSON을 읽고 바꾸는 도구',
  capabilities: ['cli', 'json'],
  howToUse: ['jq . file.json'],
};

const JQ = {
  'winget show --id jqlang.jq': { stdout: WINGET_SHOW_JQ },
  'winget install --id jqlang.jq': { stdout: 'Successfully installed' },
  'winget list --id jqlang.jq': { stdout: 'jq jqlang.jq 1.7.1' },
  'powershell.exe -NoProfile -Command': {
    stdout: 'C:\\Users\\u\\AppData\\Local\\Microsoft\\WinGet\\Links\\jq.exe',
  },
  'winget uninstall --id jqlang.jq': { stdout: 'Successfully uninstalled' },
};

async function installJq(svc: ReturnType<typeof service>['svc']) {
  const p = (await svc.plan({ kind: 'winget', target: { id: 'jqlang.jq' } })) as InstallPlan;
  return svc.execute(p.id, approval).done;
}

describe('P2-F.1 ~/.harness-x/tools/registry.json 스키마 (Zod)', () => {
  it('필드·절대 경로·origin·howToUse 1~3개', () => {
    expect(ToolEntrySchema.parse(ENTRY)).toEqual(ENTRY);
    expect(ToolEntrySchema.safeParse({ ...ENTRY, command: 'jq.exe' }).success).toBe(false);
    expect(ToolEntrySchema.safeParse({ ...ENTRY, command: '/usr/bin/jq' }).success).toBe(true);
    expect(ToolEntrySchema.safeParse({ ...ENTRY, command: '' }).success).toBe(true);
    expect(ToolEntrySchema.safeParse({ ...ENTRY, origin: 'downloaded' }).success).toBe(false);
    expect(ToolEntrySchema.safeParse({ ...ENTRY, howToUse: [] }).success).toBe(false);
    expect(ToolEntrySchema.safeParse({ ...ENTRY, howToUse: ['a', 'b', 'c', 'd'] }).success).toBe(false);
    expect(
      ToolEntrySchema.safeParse({ ...ENTRY, pricing: { ...ENTRY.pricing, tier: 'cheap' } }).success,
    ).toBe(false);
    const { purpose: _x, ...noPurpose } = ENTRY;
    void _x;
    expect(ToolEntrySchema.safeParse(noPurpose).success).toBe(false);
    // 위치: <home>/tools/registry.json (home 주입 가능)
    expect(registryFile('/h')).toBe(join('/h', 'tools', 'registry.json'));
    const dir = home();
    const r = new ToolRegistry(dir);
    r.upsert(ToolEntrySchema.parse(ENTRY));
    const file = JSON.parse(readFileSync(join(dir, 'tools', 'registry.json'), 'utf8')) as {
      version: number;
      tools: unknown[];
    };
    expect(file.version).toBe(1);
    expect(file.tools).toEqual([ENTRY]);
  });
});

describe('P2-F.2 설치 성공 시 자동 등록, 제거 시 자동 삭제', () => {
  it('등록·삭제 테스트', async () => {
    const dir = home();
    const { svc } = service(dir, JQ);
    const job = await installJq(svc);
    expect(job.toolId).toBe('winget:jqlang.jq');
    const e = svc.registry.get('winget:jqlang.jq')!;
    expect(e).toMatchObject({
      name: 'jq',
      kind: 'winget',
      version: '1.7.1',
      origin: 'installed',
      license: { id: 'MIT' },
    });
    expect(e.howToUse[0]).toContain('jq.exe');
    expect(svc.registry.revision()).toBe(1);
    await svc.execute(svc.uninstallPlan(e.id).id, approval).done;
    expect(svc.registry.get(e.id)).toBeUndefined();
    expect(svc.registry.revision()).toBe(2);
    // 실패한 설치는 등록하지 않는다
    const { svc: s2 } = service(home(), { ...JQ, 'winget install --id jqlang.jq': { code: 1 } });
    await installJq(s2);
    expect(s2.registry.list()).toEqual([]);
    expect(existsSync(s2.registry.file)).toBe(false);
  });
});

describe('P2-F.3 AI 바로 탑재 ①: installed-tools 자동 스킬 → 엔진 투영', () => {
  it('세션 시작 시 엔진 컨텍스트(SKILL.md·프롬프트 문맥)에 등록 도구 표시', async () => {
    const dir = home();
    const ws = home();
    const { svc } = service(dir, JQ);
    await installJq(svc);
    const bus = new HookBus();
    const projector = new InstalledToolsProjector(svc.registry, () => ws);
    projector.install(bus);
    await bus.emit('session.start', { sessionId: 's1' });
    await bus.drain();
    const claudeSkill = join(ws, '.claude', 'skills', INSTALLED_TOOLS_SKILL, 'SKILL.md');
    const agentsSkill = join(ws, '.agents', 'skills', INSTALLED_TOOLS_SKILL, 'SKILL.md');
    for (const f of [claudeSkill, agentsSkill]) {
      const text = readFileSync(f, 'utf8');
      expect(text).toMatch(/^---\nname: installed-tools\n/);
      expect(text).toContain('## jq');
      expect(text).toContain('C:\\Users\\u\\AppData\\Local\\Microsoft\\WinGet\\Links\\jq.exe');
      expect(text).toContain('무료');
    }
    const r = projector.start({ sessionId: 's2' });
    expect(r.context).toContain('jq');
  });
});

describe('P2-F.4 AI 바로 탑재 ②: MCP형 도구 자동 연결', () => {
  it('설치된 MCP 서버가 엔진 도구 목록(claude·codex 설정)에 등장, 제거하면 빠짐', async () => {
    const dir = home();
    const { svc } = service(dir, {});
    const base = { mcpServers: { harness: { type: 'stdio' as const, command: 'node', args: ['bin.js'] } } };
    const p = (await svc.plan({
      kind: 'mcp-local',
      target: { id: '@modelcontextprotocol/server-filesystem' },
    })) as InstallPlan;
    await svc.execute(p.id, approval).done;
    const r = (await svc.plan({
      kind: 'mcp-remote',
      target: { id: 'https://mcp.example.com/mcp' },
    })) as InstallPlan;
    await svc.execute(r.id, approval).done;
    const cfg = claudeMcpConfigWithInstalled(base, svc.mcpServers.list());
    expect(Object.keys(cfg.mcpServers).sort()).toEqual(['harness', 'mcp-example-com', 'server-filesystem']);
    expect(cfg.mcpServers['mcp-example-com']).toEqual({ type: 'http', url: 'https://mcp.example.com/mcp' });
    expect(codexMcpArgsForInstalled(svc.mcpServers.list()).join(' ')).toContain(
      'mcp_servers.server-filesystem.args',
    );
    // 제거
    await svc.execute(svc.uninstallPlan('mcp-local:@modelcontextprotocol/server-filesystem').id, approval)
      .done;
    expect(Object.keys(claudeMcpConfigWithInstalled(base, svc.mcpServers.list()).mcpServers).sort()).toEqual([
      'harness',
      'mcp-example-com',
    ]);
  });
});

describe('P2-F.5 진행 중 세션에도 설치 직후 다음 턴부터 반영 (핫리로드)', () => {
  it('설치 후 다음 턴에 사용 가능', async () => {
    const dir = home();
    const ws = home();
    const { svc } = service(dir, JQ);
    const bus = new HookBus();
    new InstalledToolsProjector(svc.registry, () => ws).install(bus);
    await bus.emit('session.start', { sessionId: 's1' });
    await bus.drain();
    const skill = join(ws, '.claude', 'skills', INSTALLED_TOOLS_SKILL, 'SKILL.md');
    expect(readFileSync(skill, 'utf8')).not.toContain('## jq');
    // 변화 없는 턴: 패치 없음
    const t1 = await bus.runBlocking('prompt.submit', { sessionId: 's1' });
    expect(t1.patch?.installedTools).toBeUndefined();
    // 세션 중 설치 → 다음 턴에 문맥 패치 + SKILL.md 갱신
    await installJq(svc);
    const t2 = await bus.runBlocking('prompt.submit', { sessionId: 's1' });
    expect(t2.decision).toBe('allow');
    expect(JSON.stringify(t2.patch?.installedTools)).toContain('jq');
    expect(readFileSync(skill, 'utf8')).toContain('## jq');
    // 그다음 턴에는 다시 알리지 않는다
    const t3 = await bus.runBlocking('prompt.submit', { sessionId: 's1' });
    expect(t3.patch?.installedTools).toBeUndefined();
  });
});

describe('P2-F.6 새 도구 첫 실행: permission-gate가 한 번 묻고 "앞으로 허락"이면 기억', () => {
  it('두 번째 실행은 묻지 않음', async () => {
    const dir = home();
    const { svc } = service(dir, JQ);
    await installJq(svc);
    const asks: string[] = [];
    const bus = new HookBus();
    const allowFile = join(dir, 'tools', 'allowed.json');
    installToolFirstRunGate(bus, {
      tools: () => svc.registry.list().map((t) => ({ id: t.id, name: t.name, command: t.command })),
      file: allowFile,
      ask: (req) => {
        asks.push(req.toolId);
        return 'always';
      },
    });
    const call = (command: string) => bus.runBlocking('tool.before', { tool: 'Bash', input: { command } });
    expect((await call('ls -la')).decision).toBe('allow');
    expect(asks).toEqual([]);
    expect((await call('cat a.json | jq .name')).decision).toBe('allow');
    expect(asks).toEqual(['winget:jqlang.jq']);
    expect(
      (await call('"C:\\Users\\u\\AppData\\Local\\Microsoft\\WinGet\\Links\\jq.exe" --version')).decision,
    ).toBe('allow');
    expect((await call('jq . x.json')).decision).toBe('allow');
    expect(asks).toEqual(['winget:jqlang.jq']);
    // 기억은 파일에 남아 새 게이트(재시작)에서도 묻지 않는다
    expect(JSON.parse(readFileSync(allowFile, 'utf8'))).toMatchObject({ allowed: ['winget:jqlang.jq'] });
    const bus2 = new HookBus();
    const asks2: string[] = [];
    installToolFirstRunGate(bus2, {
      tools: () => svc.registry.list().map((t) => ({ id: t.id, name: t.name, command: t.command })),
      file: allowFile,
      ask: (r) => (asks2.push(r.toolId), 'deny'),
    });
    expect(
      (await bus2.runBlocking('tool.before', { tool: 'Bash', input: { command: 'jq .' } })).decision,
    ).toBe('allow');
    expect(asks2).toEqual([]);
    // '이번만'은 기억하지 않고, 거부는 deny
    const bus3 = new HookBus();
    const answers = ['once', 'deny'] as const;
    let i = 0;
    installToolFirstRunGate(bus3, {
      tools: () => [{ id: 'npm-cli:prettier', name: 'prettier', command: '/usr/bin/prettier' }],
      file: join(dir, 'tools', 'allowed2.json'),
      ask: () => answers[i++]!,
    });
    const run3 = () =>
      bus3.runBlocking('tool.before', { tool: 'Bash', input: { command: 'prettier --check .' } });
    expect((await run3()).decision).toBe('allow');
    expect((await run3()).decision).toBe('deny');
    expect(i).toBe(2);
  });
});
