import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { PermissionsSchema } from '@harness-x/protocol';
import { checkFs, checkNet, checkShell, hostMatches } from '../src/sandbox/permissions.js';
import { sandboxSetup } from './sandbox-fixtures.js';

const perms = (p: Record<string, unknown>) => PermissionsSchema.parse(p);

describe('62.2 권한 프록시', () => {
  it('검사기: fs/net/shell', () => {
    const ro = perms({ fs: ['workspace:read'], net: ['api.example.com', '*.cdn.example.com'] });
    expect(checkFs(ro, '/ws', 'read', 'a/b.txt').ok).toBe(true);
    expect(checkFs(ro, '/ws', 'write', 'a/b.txt').reason).toMatch(/fs write 권한 없음/);
    expect(checkFs(ro, '/ws', 'read', '../etc/passwd').reason).toMatch(/워크스페이스 밖/);
    expect(checkFs(ro, '/ws', 'read', '/etc/passwd').reason).toMatch(/워크스페이스 밖/);
    expect(checkFs(perms({}), '/ws', 'read', 'a').ok).toBe(false);
    expect(checkFs(perms({ fs: ['workspace:write'] }), '/ws', 'read', 'a').ok).toBe(true);
    expect(checkNet(ro, 'https://api.example.com/v1').ok).toBe(true);
    expect(checkNet(ro, 'https://x.cdn.example.com/a.js').ok).toBe(true);
    expect(checkNet(ro, 'https://cdn.example.com/a.js').ok).toBe(false);
    expect(checkNet(ro, 'https://api.example.com.evil.io/').ok).toBe(false);
    expect(checkNet(ro, 'file:///etc/passwd').reason).toMatch(/프로토콜/);
    expect(hostMatches('API.EXAMPLE.COM.', 'api.example.com')).toBe(true);
    expect(checkShell(ro).ok).toBe(false);
    expect(checkShell(perms({ shell: true })).ok).toBe(true);
  });

  it('격리 플러그인: 권한 안 호출은 대신 수행, 권한 밖 호출은 거부 + permission_denied 이벤트', async () => {
    const env = sandboxSetup();
    const server = createServer((_req, res) => res.end('pong'));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    try {
      writeFileSync(join(env.workspace, 'in.txt'), 'hello from workspace');
      env.plugin(
        'reader',
        `
export async function activate(ctx) {
  const out = {};
  const tryIt = async (k, f) => { try { out[k] = await f(); } catch (e) { out[k] = e.code + ': ' + e.message; } };
  await tryIt('read', () => ctx.fs.readFile('in.txt'));
  await tryIt('list', () => ctx.fs.readdir('.'));
  await tryIt('write', () => ctx.fs.writeFile('out.txt', 'x'));
  await tryIt('escape', () => ctx.fs.readFile('../home/plugins.lock'));
  await tryIt('netOk', async () => (await fetch('http://127.0.0.1:${port}/ping')).text());
  await tryIt('netBad', () => ctx.net.fetch('https://evil.example.org/'));
  await tryIt('shell', () => ctx.shell.exec('echo', ['hi']));
  ctx.log(JSON.stringify(out));
}`,
        { permissions: { fs: ['workspace:read'], net: ['127.0.0.1'], shell: false } },
      );
      env.plugin(
        'writer',
        `
export async function activate(ctx) {
  await ctx.fs.writeFile('sub/out.txt', 'written by worker');
  const r = await ctx.shell.exec('echo', ['hi']);
  ctx.log('shell ' + r.code + ' ' + r.stdout.trim());
}`,
        { permissions: { fs: ['workspace:write'], net: [], shell: true } },
      );
      const denied: string[] = [];
      env.log.subscribe((e) => {
        if (e.type === 'permission_denied') denied.push(`${e.pluginId}:${(e as { kind?: string }).kind}`);
      });
      const loader = env.mkSandboxed();
      await loader.loadAll();
      expect(loader.plugins.get('reader')!.state).toBe('active');
      expect(loader.plugins.get('writer')!.state).toBe('active');

      const line = env.lines.find((l) => l.startsWith('[reader] {'))!;
      const r = JSON.parse(line.slice('[reader] '.length)) as Record<string, unknown>;
      expect(r.read).toBe('hello from workspace');
      expect(r.list).toContain('in.txt');
      expect(r.netOk).toBe('pong');
      expect(r.write).toMatch(/^ERR_PERMISSION_DENIED: reader: fs.writeFile 거부 — fs write 권한 없음/);
      expect(r.escape).toMatch(/^ERR_PERMISSION_DENIED: .*워크스페이스 밖/);
      expect(r.netBad).toMatch(/^ERR_PERMISSION_DENIED: .*net 권한 없음: evil.example.org/);
      expect(r.shell).toMatch(/^ERR_PERMISSION_DENIED: .*shell 권한 없음/);

      expect(readFileSync(join(env.workspace, 'sub', 'out.txt'), 'utf8')).toBe('written by worker');
      expect(env.lines).toContain('[writer] shell 0 hi');

      expect(denied.sort()).toEqual(['reader:fs', 'reader:fs', 'reader:net', 'reader:shell']);
    } finally {
      server.close();
      env.cleanup();
    }
  });
});
