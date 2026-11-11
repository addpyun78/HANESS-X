import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { claudeMcpConfig, codexMcpArgs, type ClaudeMcpConfig, type McpLaunch } from '@harness-x/mcp-host';
import { kindAvailability, type KindAvailability } from '../detect.js';
import {
  InstallBlockedError,
  type AdapterContext,
  type InstalledRecord,
  type InstallerAdapter,
  type InstallOutcome,
  type InstallTarget,
  type SecretLike,
  type VerifyOutcome,
} from '../adapter.js';
import { makePlan, type InstallPlan } from '../plan.js';

/**
 * MCP 서버 설치 (B.7 로컬 실행형 npx/uvx, B.8 원격 주소) — 실행 파일을 깔지 않고
 * 하네스 MCP 서버 목록(~/.harness-x/tools/mcp-servers.json)에 등록한다.
 * 엔진 세션 시작 시 이 목록이 엔진별 설정(claude --mcp-config / codex -c mcp_servers.*)으로 투영된다(F.4).
 * 필요한 키는 키체인에만 둔다(계정 이름 mcp:<이름>:<환경 변수>). 파일에는 계정 이름만 쓴다.
 */

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export const McpServerEntrySchema = z.discriminatedUnion('transport', [
  z.object({
    name: z.string().regex(NAME_RE),
    transport: z.literal('stdio'),
    command: z.enum(['npx', 'uvx']),
    args: z.array(z.string()),
    /** 환경 변수 이름 → 키체인 계정 */
    envSecrets: z.record(z.string(), z.string()).default({}),
    toolId: z.string(),
  }),
  z.object({
    name: z.string().regex(NAME_RE),
    transport: z.literal('http'),
    url: z.string().url(),
    auth: z.enum(['none', 'bearer', 'oauth']),
    /** bearer 키의 키체인 계정 */
    secretAccount: z.string().optional(),
    toolId: z.string(),
  }),
]);
export type McpServerEntry = z.infer<typeof McpServerEntrySchema>;

export function mcpServersFile(home: string): string {
  return join(home, 'tools', 'mcp-servers.json');
}

export class McpServerStore {
  constructor(readonly file: string) {}

  list(): McpServerEntry[] {
    if (!existsSync(this.file)) return [];
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { servers?: unknown[] };
      return (raw.servers ?? []).flatMap((s) => {
        const r = McpServerEntrySchema.safeParse(s);
        return r.success ? [r.data] : [];
      });
    } catch {
      return [];
    }
  }

  get(name: string): McpServerEntry | undefined {
    return this.list().find((s) => s.name === name);
  }

  upsert(e: McpServerEntry): void {
    const all = this.list().filter((s) => s.name !== e.name);
    this.save([...all, McpServerEntrySchema.parse(e)]);
  }

  remove(name: string): boolean {
    const all = this.list();
    const keep = all.filter((s) => s.name !== name);
    if (keep.length === all.length) return false;
    this.save(keep);
    return true;
  }

  private save(servers: McpServerEntry[]): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, servers }, null, 2) + '\n');
    renameSync(tmp, this.file);
  }
}

/** 패키지 이름 → 서버 이름 (예: @modelcontextprotocol/server-filesystem → server-filesystem) */
export function mcpNameOf(id: string): string {
  const base = id
    .replace(/^https?:\/\//, '')
    .replace(/^@[^/]+\//, '')
    .split(/[/?#]/)[0]!;
  return (
    base
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 63) || 'mcp'
  );
}

/** 등록된 서버 → 엔진 접속 설정 (키는 이때 키체인에서 꺼낸다) */
export function launchOf(e: McpServerEntry, secrets?: SecretLike): McpLaunch {
  if (e.transport === 'stdio') {
    const env: Record<string, string> = {};
    for (const [k, acct] of Object.entries(e.envSecrets)) {
      const v = secrets?.get(acct);
      if (v) env[k] = v;
    }
    return {
      transport: 'stdio',
      command: e.command,
      args: e.args,
      ...(Object.keys(env).length ? { env } : {}),
    };
  }
  const token = e.secretAccount ? (secrets?.get(e.secretAccount) ?? undefined) : undefined;
  return {
    transport: 'http',
    url: e.url,
    ...(token ? { token, tokenEnvVar: `HX_MCP_${e.name.toUpperCase().replace(/-/g, '_')}_TOKEN` } : {}),
  };
}

/** F.4 claude --mcp-config용: 하네스 서버 + 설치된 MCP 서버 전부 */
export function claudeMcpConfigWithInstalled(
  base: ClaudeMcpConfig | undefined,
  servers: McpServerEntry[],
  secrets?: SecretLike,
): ClaudeMcpConfig {
  const out: ClaudeMcpConfig = { mcpServers: { ...(base?.mcpServers ?? {}) } };
  for (const s of servers)
    Object.assign(out.mcpServers, claudeMcpConfig(launchOf(s, secrets), s.name).mcpServers);
  return out;
}

/** F.4 codex -c mcp_servers.* 인자 */
export function codexMcpArgsForInstalled(servers: McpServerEntry[], secrets?: SecretLike): string[] {
  return servers.flatMap((s) => codexMcpArgs(launchOf(s, secrets), s.name));
}

export interface McpAdapterContext extends AdapterContext {
  mcpServers: McpServerStore;
}

abstract class McpAdapterBase implements InstallerAdapter {
  abstract readonly kind: 'mcp-local' | 'mcp-remote';
  constructor(protected readonly ctx: McpAdapterContext) {}
  available(): KindAvailability {
    return kindAvailability(this.kind, this.ctx.detection(), this.ctx.settings ?? {});
  }
  abstract plan(t: InstallTarget): Promise<InstallPlan>;
  protected abstract entryOf(plan: InstallPlan): McpServerEntry;

  async install(plan: InstallPlan): Promise<InstallOutcome> {
    const e = this.entryOf(plan);
    this.ctx.mcpServers.upsert(e);
    return { ok: true, status: 'installed', message: `MCP 서버 ${e.name}을(를) 등록했어요.`, output: '' };
  }

  async verify(plan: InstallPlan): Promise<VerifyOutcome> {
    const name = mcpNameOf(plan.target);
    const e = this.ctx.mcpServers.get(name);
    return { ok: Boolean(e), output: e ? `registered ${name}` : `missing ${name}` };
  }

  async uninstall(record: InstalledRecord): Promise<InstallOutcome> {
    const name = mcpNameOf(record.target);
    const e = this.ctx.mcpServers.get(name);
    this.ctx.mcpServers.remove(name);
    if (e?.transport === 'stdio')
      for (const acct of Object.values(e.envSecrets)) this.ctx.secrets?.delete(acct);
    if (e?.transport === 'http' && e.secretAccount) this.ctx.secrets?.delete(e.secretAccount);
    return { ok: true, status: 'removed', message: `MCP 서버 ${name}을(를) 뺐어요.`, output: '' };
  }

  uninstallPlan(record: InstalledRecord): InstallPlan {
    return makePlan({
      kind: this.kind,
      name: record.name,
      version: record.version,
      target: record.target,
      host: 'linux',
      action: 'uninstall',
      toolId: record.id,
      source: { url: '', publisher: '', verified: true },
      needsAdmin: false,
      changes: [`AI 도구 목록에서 ${record.name}을(를) 빼요.`],
      risks: [],
      commands: [],
      uninstall: { commands: [] },
      verify: { cmd: '', expect: '' },
    });
  }
}

/** B.7 로컬 실행형 (npx / uvx) */
export class McpLocalAdapter extends McpAdapterBase {
  readonly kind = 'mcp-local' as const;

  async plan(t: InstallTarget): Promise<InstallPlan> {
    const runner = t.options?.runner === 'uvx' ? 'uvx' : 'npx';
    if (!/^(@[\w.-]+\/)?[\w.-]+(@[\w.-]+)?$/.test(t.id))
      throw new InstallBlockedError('INVALID_ID', `MCP 서버 이름이 올바르지 않아요: ${t.id}`);
    const extra = Array.isArray(t.options?.args) ? (t.options.args as unknown[]).map(String) : [];
    const keys = Array.isArray(t.options?.env) ? (t.options.env as unknown[]).map(String) : [];
    const spec = t.version ? `${t.id}@${t.version}` : t.id;
    const args = runner === 'npx' ? ['-y', spec, ...extra] : [spec, ...extra];
    return makePlan({
      kind: this.kind,
      name: t.name ?? mcpNameOf(t.id),
      version: t.version ?? '',
      target: t.id,
      host: 'linux',
      source: {
        url: runner === 'npx' ? `https://www.npmjs.com/package/${t.id}` : `https://pypi.org/project/${t.id}/`,
        publisher: t.id.startsWith('@modelcontextprotocol/')
          ? 'Model Context Protocol'
          : (t.id.split('/')[0] ?? ''),
        verified: t.id.startsWith('@modelcontextprotocol/'),
      },
      needsAdmin: false,
      changes: [
        `AI가 쓸 수 있는 도구 ${mcpNameOf(t.id)}을(를) 연결해요.`,
        ...(keys.length ? [`필요한 키(${keys.join(', ')})는 키체인에만 저장해요.`] : []),
      ],
      risks: ['처음 쓸 때 인터넷에서 프로그램을 받아 실행해요.'],
      commands: [[runner, ...args].join(' ')],
      uninstall: { commands: [] },
      verify: { cmd: '', expect: '' },
    });
  }

  protected entryOf(plan: InstallPlan): McpServerEntry {
    const [command, ...args] = plan.commands[0]!.split(' ');
    const name = mcpNameOf(plan.target);
    const keys = plan.changes
      .map((c) => /필요한 키\((.+?)\)/.exec(c)?.[1])
      .filter(Boolean)
      .flatMap((s) => s!.split(', '));
    return {
      name,
      transport: 'stdio',
      command: command === 'uvx' ? 'uvx' : 'npx',
      args,
      envSecrets: Object.fromEntries(keys.map((k) => [k, `mcp:${name}:${k}`])),
      toolId: `${this.kind}:${plan.target}`,
    };
  }
}

/** B.8 원격 주소: 주소·인증 방식만 등록, HTTPS 필수 */
export class McpRemoteAdapter extends McpAdapterBase {
  readonly kind = 'mcp-remote' as const;

  async plan(t: InstallTarget): Promise<InstallPlan> {
    let url: URL;
    try {
      url = new URL(t.id);
    } catch {
      throw new InstallBlockedError('INVALID_URL', '주소 형식이 올바르지 않아요.');
    }
    if (url.protocol !== 'https:')
      throw new InstallBlockedError('HTTPS_REQUIRED', '보안 연결(https) 주소만 등록할 수 있어요.');
    const auth = t.options?.auth === 'bearer' || t.options?.auth === 'oauth' ? t.options.auth : 'none';
    return makePlan({
      kind: this.kind,
      name: t.name ?? mcpNameOf(url.hostname),
      version: '',
      target: url.href,
      host: 'linux',
      source: { url: url.origin, publisher: url.hostname, verified: false },
      needsAdmin: false,
      changes: [
        `AI가 ${url.hostname}의 도구를 쓸 수 있게 연결해요.`,
        auth === 'bearer'
          ? '연결 키는 키체인에만 저장해요.'
          : auth === 'oauth'
            ? '처음 쓸 때 로그인 창이 열려요.'
            : '로그인은 필요 없어요.',
      ],
      risks: ['AI가 보낸 내용이 이 주소의 서버로 가요.'],
      commands: [],
      uninstall: { commands: [] },
      verify: { cmd: '', expect: '' },
    });
  }

  protected entryOf(plan: InstallPlan): McpServerEntry {
    const name = mcpNameOf(plan.target);
    const bearer = plan.changes.some((c) => c.includes('연결 키는 키체인'));
    const oauth = plan.changes.some((c) => c.includes('로그인 창'));
    return {
      name,
      transport: 'http',
      url: plan.target,
      auth: bearer ? 'bearer' : oauth ? 'oauth' : 'none',
      ...(bearer ? { secretAccount: `mcp:${name}:token` } : {}),
      toolId: `${this.kind}:${plan.target}`,
    };
  }
}
