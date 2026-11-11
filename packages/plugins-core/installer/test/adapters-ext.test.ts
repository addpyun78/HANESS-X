import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ApiServiceAdapter,
  DirectDownloadAdapter,
  HarnessPluginAdapter,
  McpLocalAdapter,
  McpRemoteAdapter,
  McpServerStore,
  apiKeyAccountOf,
  claudeMcpConfigWithInstalled,
  codexMcpArgsForInstalled,
  mcpServersFile,
  mockRunner,
  trustLevelOfInstalled,
  type CommandSpec,
} from '../src/index.js';
import { memorySecrets, service, table, tempHome } from './helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((f) => f()));
const home = () => {
  const h = tempHome();
  cleanups.push(h.cleanup);
  return h.dir;
};
const t = table({ git: { host: 'linux' }, npm: { host: 'linux' } });

describe('P2-B.7 MCP 로컬 실행형 (npx/uvx)', () => {
  it('mcp-host에 등록 + 엔진별 투영 → 엔진 도구 목록(설정)에 표시, 키는 키체인', async () => {
    const dir = home();
    const secrets = memorySecrets();
    const { svc } = service(dir, {}, { detection: t, secrets });
    const plan = await svc.plan({
      kind: 'mcp-local',
      target: { id: '@modelcontextprotocol/server-github', options: { env: ['GITHUB_TOKEN'] } },
    });
    if ('unavailable' in plan) throw new Error();
    expect(plan.commands).toEqual(['npx -y @modelcontextprotocol/server-github']);
    const job = await svc.execute(plan.id, { gestureId: 'g' }).done;
    expect(job.status).toBe('installed');
    const servers = svc.mcpServers.list();
    expect(servers).toEqual([
      expect.objectContaining({
        name: 'server-github',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        envSecrets: { GITHUB_TOKEN: 'mcp:server-github:GITHUB_TOKEN' },
      }),
    ]);
    // 파일에는 키가 없다(계정 이름만). 키는 키체인에서 투영 시점에만 꺼낸다
    secrets.set('mcp:server-github:GITHUB_TOKEN', 'ghp_secretvalue');
    const claude = claudeMcpConfigWithInstalled(undefined, servers, secrets);
    expect(claude.mcpServers['server-github']).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_TOKEN: 'ghp_secretvalue' },
    });
    const codex = codexMcpArgsForInstalled(servers, secrets);
    expect(codex).toContain('mcp_servers.server-github.command="npx"');
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(mcpServersFile(dir), 'utf8')).not.toContain('ghp_secretvalue');
    expect(svc.registry.get('mcp-local:@modelcontextprotocol/server-github')?.kind).toBe('mcp-local');
    // uvx
    const uvx = await new McpLocalAdapter({
      runner: mockRunner({}),
      platform: 'wsl',
      detection: () => t,
      mcpServers: new McpServerStore(mcpServersFile(dir)),
    }).plan({ id: 'mcp-server-fetch', options: { runner: 'uvx' } });
    expect(uvx.commands).toEqual(['uvx mcp-server-fetch']);
  });
});

describe('P2-B.8 MCP 원격 주소: HTTPS 필수', () => {
  it('http 주소 거부, https는 주소·인증 방식만 등록', async () => {
    const dir = home();
    const store = new McpServerStore(mcpServersFile(dir));
    const a = new McpRemoteAdapter({
      runner: mockRunner({}),
      platform: 'wsl',
      detection: () => t,
      mcpServers: store,
    });
    await expect(a.plan({ id: 'http://example.com/mcp' })).rejects.toThrow('https');
    await expect(a.plan({ id: 'not a url' })).rejects.toThrow('주소');
    const p = await a.plan({ id: 'https://mcp.example.com/mcp', options: { auth: 'bearer' } });
    expect(p.commands).toEqual([]);
    await a.install(p);
    expect(store.list()).toEqual([
      expect.objectContaining({
        transport: 'http',
        url: 'https://mcp.example.com/mcp',
        auth: 'bearer',
        secretAccount: 'mcp:mcp-example-com:token',
      }),
    ]);
  });
});

describe('P2-B.9 하네스 플러그인·스킬: 격리 폴더 clone → 매니페스트 검증 → 격리 등급', () => {
  /** git clone 모킹: 마지막 인자(대상 폴더)에 파일을 만든다 */
  const cloneWith = (files: Record<string, string>) =>
    mockRunner((line: string, cmd: CommandSpec) => {
      if (!line.startsWith('git clone --depth 1 ')) return undefined;
      const dest = cmd.args[cmd.args.length - 1]!;
      mkdirSync(join(dest, '.git'), { recursive: true });
      for (const [f, text] of Object.entries(files)) {
        mkdirSync(join(dest, f, '..'), { recursive: true });
        writeFileSync(join(dest, f), text);
      }
      return { stdout: '' };
    });

  it('깨진 매니페스트 거부(설치 폴더에 아무것도 남지 않음)', async () => {
    const dir = home();
    const runner = cloneWith({ 'harness-plugin.json': '{"id":"Bad Id","version":"x"}' });
    const a = new HarnessPluginAdapter({ runner, platform: 'wsl', detection: () => t, home: dir });
    const p = await a.plan({ id: 'https://github.com/someone/bad-plugin' });
    expect(p.commands[0]).toBe('git clone --depth 1 https://github.com/someone/bad-plugin.git <격리 폴더>');
    const r = await a.install(p, () => {});
    expect(r.ok).toBe(false);
    expect(r.message).toContain('올바르지 않아요');
    expect(existsSync(join(dir, 'plugins'))).toBe(false);
    expect(readdirSync(dir).filter((x) => x.startsWith('tmp-quarantine'))).toEqual([]);
    await expect(a.plan({ id: 'http://github.com/a/b' })).rejects.toThrow('https');
  });

  it('정상 플러그인은 <home>/plugins/<id>에 놓이고 미서명·격리 등급', async () => {
    const dir = home();
    const manifest = {
      id: 'hello-plugin',
      version: '1.0.0',
      apiVersion: 1,
      main: 'index.js',
      provides: { tool: ['hello'] },
    };
    const runner = cloneWith({ 'harness-plugin.json': JSON.stringify(manifest), 'index.js': 'export {}' });
    const a = new HarnessPluginAdapter({ runner, platform: 'wsl', detection: () => t, home: dir });
    const p = await a.plan({ id: 'https://github.com/someone/hello-plugin' });
    const r = await a.install(p, () => {});
    expect(r).toMatchObject({ ok: true, status: 'installed' });
    const dest = join(dir, 'plugins', 'hello-plugin');
    expect(existsSync(join(dest, 'harness-plugin.json'))).toBe(true);
    expect(existsSync(join(dest, '.git'))).toBe(false);
    expect(await a.locate(p)).toBe(dest);
    expect(trustLevelOfInstalled('hello-plugin', 'abc', join(dir, 'trust.json'))).toBe('unsigned-isolated');
    // 스킬
    const sr = cloneWith({ 'SKILL.md': '---\nname: my-skill\ndescription: 예시 스킬\n---\n본문\n' });
    const s = new HarnessPluginAdapter(
      { runner: sr, platform: 'wsl', detection: () => t, home: dir },
      'skill',
    );
    const sp = await s.plan({ id: 'https://github.com/someone/my-skill' });
    expect((await s.install(sp, () => {})).ok).toBe(true);
    expect(existsSync(join(dir, 'skills', 'my-skill', 'SKILL.md'))).toBe(true);
    const bad = cloneWith({ 'SKILL.md': 'no frontmatter' });
    const bs = new HarnessPluginAdapter(
      { runner: bad, platform: 'wsl', detection: () => t, home: home() },
      'skill',
    );
    expect((await bs.install(await bs.plan({ id: 'https://github.com/x/y' }), () => {})).ok).toBe(false);
  });
});

describe('P2-B.13 직접 다운로드 (.exe/.msi/.zip)', () => {
  const body = Buffer.from('MZ fake installer bytes');
  const sha = createHash('sha256').update(body).digest('hex');
  const fetchOk = (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;

  it('HTTPS만·공식 도메인 확인', async () => {
    const a = new DirectDownloadAdapter({
      runner: mockRunner({}),
      platform: 'wsl',
      detection: () => t,
      home: home(),
    });
    await expect(a.plan({ id: 'http://example.com/setup.exe' })).rejects.toThrow('https');
    await expect(
      a.plan({ id: 'https://evil.example.net/setup.exe', options: { officialDomains: ['example.com'] } }),
    ).rejects.toThrow('공식 주소가 아니에요');
    await expect(a.plan({ id: 'https://example.com/setup.sh' })).rejects.toThrow('.exe');
    const p = await a.plan({
      id: 'https://dl.example.com/setup.exe',
      options: { officialDomains: ['example.com'] },
    });
    expect(p.source.verified).toBe(true);
    expect(p.interactive).toBe(true);
  });

  it('해시 불일치 시 차단(파일 삭제, 실행 없음)', async () => {
    const dir = home();
    const runner = mockRunner({});
    const a = new DirectDownloadAdapter({
      runner,
      platform: 'wsl',
      detection: () => t,
      home: dir,
      fetch: fetchOk,
    });
    const p = await a.plan({ id: 'https://example.com/setup.exe', options: { sha256: 'a'.repeat(64) } });
    const r = await a.install(p, () => {});
    expect(r).toMatchObject({ ok: false, status: 'failed' });
    expect(r.message).toContain('게시된 것과 달라요');
    expect(existsSync(a.quarantineDir(p.id))).toBe(false);
    expect(runner.calls.some((c) => c.line.includes('Start-Process'))).toBe(false);
  });

  it('서명 없음 → 빨간 경고, 자동으로 열지 않음 / 서명 있으면 설치 화면을 무인 옵션 없이 연다', async () => {
    const dir = home();
    const unsigned = mockRunner({
      'wslpath -w': { stdout: 'C:\\tmp\\setup.exe\n' },
      'powershell.exe -NoProfile -Command (Get-AuthenticodeSignature': { stdout: 'NotSigned\r\n' },
    });
    const a = new DirectDownloadAdapter({
      runner: unsigned,
      platform: 'wsl',
      detection: () => t,
      home: dir,
      fetch: fetchOk,
    });
    const p = await a.plan({ id: 'https://example.com/setup.exe', options: { sha256: sha } });
    const r = await a.install(p, () => {});
    expect(r.status).toBe('needs-user');
    expect(r.warnings?.[0]).toContain('서명이 없어요');
    expect(unsigned.calls.some((c) => c.line.includes('Start-Process'))).toBe(false);

    const signed = mockRunner({
      'wslpath -w': { stdout: 'C:\\tmp\\setup.exe\n' },
      'powershell.exe -NoProfile -Command (Get-AuthenticodeSignature': { stdout: 'Valid\r\n' },
      'powershell.exe -NoProfile -Command Start-Process': { stdout: '' },
    });
    const b = new DirectDownloadAdapter({
      runner: signed,
      platform: 'wsl',
      detection: () => t,
      home: dir,
      fetch: fetchOk,
    });
    const p2 = await b.plan({ id: 'https://example.com/setup.exe', options: { sha256: sha } });
    expect((await b.install(p2, () => {})).ok).toBe(true);
    const launch = signed.calls.find((c) => c.line.includes('Start-Process'))!;
    expect(launch.line).not.toMatch(/\/S\b|\/quiet|\/silent|\/qn/i);
    expect(existsSync(b.quarantineDir(p2.id))).toBe(false);
  });
});

describe('P2-B.14 가입형 API 서비스', () => {
  it('설치 대신 가입 페이지 + 키 확인 1회 → 키체인 저장', async () => {
    const secrets = memorySecrets();
    const seen: { url: string; headers: Record<string, string> }[] = [];
    let status = 401;
    const f = (async (url: string, init?: RequestInit) => {
      seen.push({ url, headers: init?.headers as Record<string, string> });
      return new Response('{}', { status });
    }) as unknown as typeof fetch;
    const a = new ApiServiceAdapter({
      runner: mockRunner({}),
      platform: 'wsl',
      detection: () => t,
      secrets,
      fetch: f,
    });
    const p = await a.plan({ id: 'brave-search' });
    expect(p).toMatchObject({
      kind: 'api-service',
      commands: ['open https://brave.com/search/api/'],
      pricing: { tier: 'freemium' },
    });
    expect(p.risks.join(' ')).toContain('하네스는 결제를 하지 않아요');
    expect((await a.install(p, () => {})).status).toBe('needs-user');
    // 틀린 키: 저장 안 함
    expect(await a.submitKey('brave-search', 'wrong')).toMatchObject({ ok: false });
    expect(secrets.get(apiKeyAccountOf('brave-search'))).toBeNull();
    // 맞는 키: 확인 요청 1회 후 저장
    status = 200;
    const before = seen.length;
    expect(await a.submitKey('brave-search', ' good-key ')).toMatchObject({ ok: true });
    expect(seen.length - before).toBe(1);
    expect(seen.at(-1)!.headers['X-Subscription-Token']).toBe('good-key');
    expect(secrets.get(apiKeyAccountOf('brave-search'))).toBe('good-key');
    expect((await a.verify(p)).ok).toBe(true);
    await a.uninstall({
      id: 'api-service:brave-search',
      kind: 'api-service',
      name: 'b',
      version: '',
      target: 'brave-search',
    });
    expect(secrets.get(apiKeyAccountOf('brave-search'))).toBeNull();
  });
});
