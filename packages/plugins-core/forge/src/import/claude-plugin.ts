import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { validateSkillMd } from '@harness-x/sdk';
import type { PluginManifestInput } from '@harness-x/protocol';
import { ImportError, js, kebab, prepareDest, semverOr, writePlugin, type ImportResult } from './common.js';
import { readMcpConfig } from './mcp.js';

/**
 * T-053 53.2 Claude Code 플러그인 → 하네스 플러그인
 * 입력 폴더 구조 (Claude Code):
 *   .claude-plugin/plugin.json  {name, version?, description?}
 *   commands/*.md               → provides.command (/이름)
 *   skills/<이름>/SKILL.md       → provides.skill
 *   hooks/hooks.json            → provides.hook (이벤트 → 하네스 훅, 명령은 sh로 실행. 종료코드 2 = 차단)
 *   .mcp.json                   → provides.tool (MCP 서버 이름)
 *   agents/*.md                 → (변환하지 않음, 경고)
 * 원본 파일은 그대로 복사하고 harness-plugin.json + harness-index.js를 만든다.
 */

export const CLAUDE_PLUGIN_MANIFEST = join('.claude-plugin', 'plugin.json');

/** Claude Code 훅 이벤트 → 하네스 훅 (blocking = 차단형) */
export const CLAUDE_HOOK_EVENTS: Record<string, { hook: string; blocking: boolean }> = {
  PreToolUse: { hook: 'tool.before', blocking: true },
  PostToolUse: { hook: 'tool.after', blocking: false },
  UserPromptSubmit: { hook: 'prompt.submit', blocking: true },
  Stop: { hook: 'stop.before', blocking: true },
  SubagentStop: { hook: 'stop.before', blocking: true },
  SessionStart: { hook: 'session.start', blocking: false },
  PreCompact: { hook: 'context.compact', blocking: false },
};

interface HookSpec {
  event: string;
  hook: string;
  blocking: boolean;
  matcher: string;
  command: string;
  timeoutMs?: number;
}

const mdFiles = (dir: string) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.md') && statSync(join(dir, f)).isFile())
        .sort()
    : [];

function frontmatterDescription(text: string): string | undefined {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const d = m && /^description:\s*(.+)$/m.exec(m[1]!);
  return d ? d[1]!.trim().replace(/^['"]|['"]$/g, '') : undefined;
}

function readHooks(src: string, warnings: string[]): HookSpec[] {
  const file = join(src, 'hooks', 'hooks.json');
  if (!existsSync(file)) return [];
  const raw = JSON.parse(readFileSync(file, 'utf8')) as {
    hooks?: Record<
      string,
      { matcher?: string; hooks?: { type?: string; command?: string; timeout?: number }[] }[]
    >;
  };
  const out: HookSpec[] = [];
  for (const [event, groups] of Object.entries(raw.hooks ?? {})) {
    const map = CLAUDE_HOOK_EVENTS[event];
    if (!map) {
      warnings.push(`훅 이벤트 ${event}는 하네스에 대응하는 훅이 없어 건너뜀`);
      continue;
    }
    for (const g of groups ?? [])
      for (const h of g.hooks ?? []) {
        if (h.type !== 'command' || !h.command) {
          warnings.push(`${event} 훅의 type ${h.type ?? '?'}은 지원하지 않음 (command만)`);
          continue;
        }
        out.push({
          event,
          ...map,
          matcher: g.matcher ?? '',
          command: h.command,
          ...(h.timeout ? { timeoutMs: h.timeout * 1000 } : {}),
        });
      }
  }
  return out;
}

export function claudePluginMain(meta: {
  hooks: HookSpec[];
  commands: { command: string; file: string; description?: string }[];
  skills: { name: string; file: string }[];
  mcpServers: unknown[];
}): string {
  return `// 생성됨: Forge 가져오기 (Claude Code 플러그인 → 하네스 플러그인)
const HOOKS = ${js(meta.hooks)};
export const commands = ${js(meta.commands)};
export const skills = ${js(meta.skills)};
export const mcpServers = ${js(meta.mcpServers)};

const matches = (matcher, tool) =>
  !matcher || matcher === '*' || new RegExp('^(?:' + matcher + ')$').test(String(tool ?? ''));

/** Claude Code처럼 훅 입력 JSON을 표준입력으로 넘겨 sh로 실행 (격리 실행이면 ctx.shell, 아니면 child_process) */
async function run(ctx, command, input, timeoutMs) {
  const payload = JSON.stringify(input);
  if (ctx.shell) return ctx.shell.exec('sh', ['-c', 'printf %s "$1" | sh -c "$2"', 'hook', payload, command]);
  const { execFile } = await import('node:child_process');
  return new Promise((resolve) => {
    const child = execFile('sh', ['-c', command], { timeout: timeoutMs ?? 30000 }, (err, stdout, stderr) =>
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) }),
    );
    child.stdin?.end(payload);
  });
}

export function activate(ctx) {
  const root = ctx.dir ?? '.';
  for (const h of HOOKS) {
    const command = h.command.split('\${CLAUDE_PLUGIN_ROOT}').join(root);
    const handler = async (c) => {
      if (h.event.endsWith('ToolUse') && !matches(h.matcher, c.tool)) return { decision: 'allow' };
      const r = await run(
        ctx,
        command,
        { hook_event_name: h.event, session_id: c.sessionId, cwd: c.cwd, tool_name: c.tool, tool_input: c.input, prompt: c.prompt },
        h.timeoutMs,
      );
      if (r.code === 2) return { decision: 'block', reason: (r.stderr || r.stdout).trim() || h.event + ' 훅이 막음' };
      return { decision: 'allow' };
    };
    if (h.blocking) ctx.hooks.onBlocking(h.hook, handler);
    else ctx.hooks.onNotify(h.hook, async (c) => void (await handler(c)));
  }
  ctx.log('claude plugin: hooks ' + HOOKS.length + ', commands ' + commands.length + ', skills ' + skills.length);
}

export function deactivate() {}
`;
}

export function importClaudePlugin(src: string, dest: string): ImportResult {
  const metaFile = join(src, CLAUDE_PLUGIN_MANIFEST);
  if (!existsSync(metaFile)) throw new ImportError(`${CLAUDE_PLUGIN_MANIFEST} 없음: ${src}`);
  const meta = JSON.parse(readFileSync(metaFile, 'utf8')) as {
    name?: string;
    version?: string;
    description?: string;
  };
  const id = kebab(meta.name ?? basename(src));
  if (!id) throw new ImportError('plugin.json name이 비어 있음');
  const warnings: string[] = [];

  const commands = mdFiles(join(src, 'commands')).map((f) => {
    const d = frontmatterDescription(readFileSync(join(src, 'commands', f), 'utf8'));
    return {
      command: `/${kebab(f.replace(/\.md$/, ''))}`,
      file: `commands/${f}`,
      ...(d ? { description: d } : {}),
    };
  });
  const skills: { name: string; file: string }[] = [];
  const skillsDir = join(src, 'skills');
  if (existsSync(skillsDir))
    for (const name of readdirSync(skillsDir).sort()) {
      const f = join(skillsDir, name, 'SKILL.md');
      if (!existsSync(f)) continue;
      const v = validateSkillMd(readFileSync(f, 'utf8'));
      if (!v.ok) {
        warnings.push(`skills/${name}/SKILL.md 검증 실패: ${v.errors.join('; ')}`);
        continue;
      }
      skills.push({ name: v.frontmatter!.name, file: `skills/${name}/SKILL.md` });
    }
  const hooks = readHooks(src, warnings);
  const mcpFile = join(src, '.mcp.json');
  const mcp = existsSync(mcpFile) ? readMcpConfig(JSON.parse(readFileSync(mcpFile, 'utf8'))) : [];
  const agents = mdFiles(join(src, 'agents'));
  if (agents.length)
    warnings.push(`agents/ ${agents.length}개는 변환하지 않음 (하네스 에이전트는 agent.yaml)`);

  const provides: PluginManifestInput['provides'] = {
    ...(commands.length ? { command: commands.map((c) => c.command) } : {}),
    ...(skills.length ? { skill: skills.map((s) => s.name) } : {}),
    ...(hooks.length ? { hook: [id] } : {}),
    ...(mcp.length ? { tool: mcp.map((s) => s.name) } : {}),
  };
  if (Object.keys(provides).length === 0)
    throw new ImportError('변환할 것이 없음 (commands·skills·hooks·.mcp.json)');

  prepareDest(src, dest);
  const manifest = writePlugin(
    dest,
    {
      id,
      version: semverOr(meta.version),
      apiVersion: 1,
      displayName: meta.name ?? id,
      ...(meta.description ? { description: meta.description } : {}),
      provides,
      permissions: { fs: [], net: [], shell: hooks.length > 0 },
    },
    claudePluginMain({ hooks, commands, skills, mcpServers: mcp }),
  );
  return { dir: dest, manifest, warnings };
}
