// A.28~A.35 목록 스냅샷 8종 → docs/audit/snapshots/*.json (G.10에서 다시 만들어 비교)
// usage: node scripts/audit/snapshots.mjs [--out <폴더>] [--only plugins,cli,...]
// - plugins / agents-skills: 임시 홈으로 서버를 켜서 API로 받는다(실제 등록 결과)
// - 나머지: 레지스트리 모듈을 직접 불러오거나(설정 키·화면 동작·훅 이름) 소스에서 정적으로 뽑는다(API 경로·MCP 도구·CLI)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { listFiles, rel, root, run as runRaw, writeJson } from './lib.mjs';

const argv = process.argv.slice(2);
const outDir = argv.includes('--out')
  ? argv[argv.indexOf('--out') + 1]
  : join(root, 'docs', 'audit', 'snapshots');
const only = argv.includes('--only') ? new Set(argv[argv.indexOf('--only') + 1].split(',')) : null;
const want = (k) => !only || only.has(k);
mkdirSync(outDir, { recursive: true });

const srcFiles = () =>
  listFiles(
    root,
    (p) =>
      /\.(ts|tsx|mjs|js)$/.test(p) &&
      !/\.test\.(ts|tsx)$/.test(p) &&
      /[\\/]src[\\/]/.test(p) &&
      !p.endsWith('.d.ts'),
    { skipDirs: ['node_modules', 'dist', '.git', '.claude', 'target', '.harness-x-dev', 'docs'] },
  );

// ── 정적: API 경로 ─────────────────────────────────────────
export function apiRoutes(files = srcFiles()) {
  const out = [];
  const re = /\b([a-zA-Z_]+)\.(get|post|put|delete|patch)(?:<[^>]*>)?\(\s*(['`])(\/[^'`]*)\3/g;
  const reConst = /\b([a-zA-Z_]+)\.(get|post|put|delete|patch)(?:<[^>]*>)?\(\s*([A-Z_][A-Z0-9_]+)\s*,/g;
  const consts = {};
  for (const f of files) {
    const t = readFileSync(f, 'utf8');
    for (const m of t.matchAll(/(?:export\s+)?const\s+([A-Z_][A-Z0-9_]+)\s*=\s*['`](\/api[^'`]*)['`]/g))
      consts[m[1]] = m[2];
  }
  for (const f of files) {
    const t = readFileSync(f, 'utf8');
    if (!/fastify|FastifyInstance|app\.(get|post)/.test(t)) continue;
    for (const m of t.matchAll(re)) {
      if (!m[4].startsWith('/api') && !m[4].startsWith('/mcp') && m[4] !== '/') continue;
      if (['fetch', 'http', 'axios', 'client', 'api'].includes(m[1])) continue;
      out.push({
        method: m[2].toUpperCase(),
        path: m[4],
        file: rel(f),
        line: t.slice(0, m.index).split('\n').length,
      });
    }
    for (const m of t.matchAll(reConst)) {
      if (!consts[m[3]]) continue;
      out.push({
        method: m[2].toUpperCase(),
        path: consts[m[3]],
        file: rel(f),
        line: t.slice(0, m.index).split('\n').length,
      });
    }
  }
  out.sort((a, b) => (a.path + a.method).localeCompare(b.path + b.method));
  return out;
}

// ── 정적: MCP 도구 이름 ─────────────────────────────────────
export function mcpTools(files = srcFiles()) {
  const out = [];
  const globalConsts = {};
  for (const f of files)
    for (const m of readFileSync(f, 'utf8').matchAll(
      /export const ([A-Z][A-Z0-9_]+)\s*=\s*['`]([a-z_]+\.[a-z_.-]+)['`]/g,
    ))
      globalConsts[m[1]] = m[2];
  for (const f of files) {
    const t = readFileSync(f, 'utf8');
    for (const m of t.matchAll(/registerTool\(\s*/g)) {
      // 첫 인자만(첫 줄 끝의 ',' 또는 '{' 앞까지) 본다
      const after = t.slice(m.index + m[0].length, m.index + m[0].length + 300);
      const first = after.split(/,\s*\n|,\s*\{/)[0];
      let name = first.match(/['`]([a-z_]+\.[a-z_.-]+)['`]/)?.[1];
      if (!name) {
        const id = first.match(/\b([A-Z][A-Z0-9_]+)\b/)?.[1] ?? first.match(/([A-Za-z_][A-Za-z0-9_.]*)/)?.[1];
        const tail = id?.split('.').pop();
        const def =
          tail && (t.match(new RegExp(`${tail}\\s*=\\s*['\`]([^'\`]+)['\`]`)) ?? globalConsts[tail]);
        name = Array.isArray(def) ? def[1] : (def ?? `<${first.trim().slice(0, 40)}>`);
      }
      out.push({ name, file: rel(f), line: t.slice(0, m.index).split('\n').length });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// ── 정적+실행: CLI ─────────────────────────────────────────
export function cliCommands() {
  const cli = join(root, 'packages', 'kernel', 'dist', 'cli.js');
  // 하위 명령 중 --help를 모르고 실제로 실행하는 것이 있다(reindex 등) → 반드시 임시 홈에서, 켜진 서버에 닿지 않게
  const home = mkdtempSync(join(tmpdir(), 'hx-cli-'));
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    HARNESS_X_HOME: join(home, '.harness-x'),
    HARNESS_X_TOKEN: '',
  };
  const run = (cmd, args, o = {}) => runRaw(cmd, args, { env, cwd: home, ...o });
  try {
    return cliCommandsIn(cli, run);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}
function cliCommandsIn(cli, run) {
  const r = run(process.execPath, ['--no-warnings', cli, '--help'], { timeout: 180_000 });
  const help = r.stdout;
  const commands = [...help.matchAll(/^\s{2}harness-x ([a-z-]+(?: [a-z-]+)?)/gm)].map((m) => m[1].trim());
  const options = [...help.matchAll(/^\s{2}(-[-a-zA-Z, ]+?)(?:\s<[^>]+>)?\s{2,}/gm)].map((m) => m[1].trim());
  // 하위 명령 재귀: 첫 단어마다 `<cmd> --help`
  const sub = {};
  for (const c of new Set(commands.map((c) => c.split(' ')[0]))) {
    if (c === 'serve') continue; // serve --help = 전체 도움말
    const s = run(process.execPath, ['--no-warnings', cli, c, '--help'], { timeout: 60_000 });
    sub[c] = { exit: s.status, firstLine: (s.stdout || s.stderr).split('\n').find((l) => l.trim()) ?? '' };
  }
  return { commands, options, sub, helpExit: r.status };
}

// ── 모듈: 설정 키·화면 동작·훅 ─────────────────────────────
async function kernel() {
  return import(pathToFileURL(join(root, 'packages', 'kernel', 'dist', 'index.js')).href);
}

export async function settingsKeys() {
  const k = await kernel();
  // 플러그인 설정(withPluginSettings)은 실제 로드 결과에 따라 달라지므로 코어 레지스트리 기준
  const reg = k.settingsRegistry;
  const defs =
    typeof reg?.list === 'function'
      ? reg.list()
      : typeof reg?.all === 'function'
        ? reg.all()
        : [...k.CORE_SETTINGS];
  return defs
    .map((d) => ({
      key: d.key,
      group: d.group,
      scope: d.scope ?? 'global',
      storage: d.storage ?? 'settings',
      ...(d.browserKey ? { browserKey: d.browserKey } : {}),
      ...(d.secretAccount ? { secretAccount: d.secretAccount } : {}),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export async function actions() {
  const m = await import(pathToFileURL(join(root, 'apps', 'web', 'src', 'actions', 'registry.ts')).href);
  return Object.entries(m.ACTIONS)
    .map(([id, s]) => ({ id, effect: s.effect }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function hooks(files = srcFiles()) {
  const k = await kernel();
  const registrations = [];
  for (const f of files) {
    const t = readFileSync(f, 'utf8');
    for (const m of t.matchAll(/\.on(Blocking|Notify)\(\s*['`]([a-z.]+)['`]/g))
      registrations.push({
        hook: m[2],
        kind: m[1].toLowerCase(),
        file: rel(f),
        line: t.slice(0, m.index).split('\n').length,
      });
  }
  // 엔진 네이티브 훅 브리지: 엔진 설정 파일의 훅 명령 + 하네스가 주입하는 훅 템플릿
  const native = [];
  for (const f of ['.claude/settings.json', '.claude/settings.local.json', '.codex/hooks.json']) {
    try {
      const j = JSON.parse(readFileSync(join(root, f), 'utf8'));
      for (const [ev, arr] of Object.entries(j.hooks ?? {}))
        for (const h of arr)
          for (const x of h.hooks ?? [h]) native.push({ source: f, event: ev, command: x.command });
    } catch {
      /* 없음 */
    }
  }
  for (const f of files) {
    const t = readFileSync(f, 'utf8');
    for (const m of t.matchAll(
      /['"`](PreToolUse|PostToolUse|Stop|SessionStart|UserPromptSubmit|SubagentStop|PreCompact|Notification)['"`]\s*:/g,
    ))
      native.push({ source: rel(f), event: m[1], line: t.slice(0, m.index).split('\n').length });
  }
  registrations.sort((a, b) => (a.hook + a.file).localeCompare(b.hook + b.file));
  return { hookNames: [...k.HOOK_NAMES], registrations, native };
}

// ── 서버: 플러그인·에이전트·스킬 ───────────────────────────
async function withServer(fn) {
  const home = mkdtempSync(join(tmpdir(), 'hx-snap-'));
  const token = 'audit-snapshot-token-0123456789abcdef0123';
  const port = 38950 + Math.floor(Math.random() * 40);
  const p = spawn(
    process.execPath,
    [
      '--no-warnings',
      join(root, 'packages', 'kernel', 'dist', 'cli.js'),
      'serve',
      '--port',
      String(port),
      '--no-watch',
      '--workspace',
      root,
      '--token-file',
      join(home, 'token'),
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        HARNESS_X_HOME: join(home, '.harness-x'),
        HARNESS_X_TOKEN: token,
      },
      stdio: 'ignore',
    },
  );
  const get = async (path) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  try {
    const t0 = Date.now();
    for (;;) {
      if (Date.now() - t0 > 240_000) throw new Error('서버가 240초 안에 안 켜짐');
      try {
        if ((await get('/api/health')).status === 200) break;
      } catch {
        /* 대기 */
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    return await fn(get);
  } finally {
    p.kill();
    await new Promise((r) => setTimeout(r, 500));
    rmSync(home, { recursive: true, force: true });
  }
}

const files = srcFiles();
const done = [];
const save = (name, v) => {
  writeJson(join(outDir, `${name}.json`), v);
  done.push(`${name}:${Array.isArray(v) ? v.length : Object.keys(v).length}`);
};
if (want('api-routes')) save('api-routes', apiRoutes(files));
if (want('mcp-tools')) save('mcp-tools', mcpTools(files));
if (want('settings-keys')) save('settings-keys', await settingsKeys());
if (want('actions')) save('actions', await actions());
if (want('hooks')) save('hooks', await hooks(files));
if (want('cli')) save('cli', cliCommands());
if (want('plugins') || want('agents-skills')) {
  await withServer(async (get) => {
    if (want('plugins')) {
      const r = await get('/api/plugins');
      save('plugins', {
        plugins: (r.body?.plugins ?? [])
          .map((p) => ({
            id: p.id,
            version: p.version,
            slots: p.slots,
            active: p.state === 'active',
            state: p.state,
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
        rejected: (r.body?.rejected ?? []).map((x) => ({ id: x.id, reason: x.reason })),
      });
    }
    if (want('agents-skills')) {
      const a = await get('/api/agents');
      const skills = listFiles(root, (p) => p.endsWith('SKILL.md'), {
        skipDirs: ['node_modules', 'dist', '.git', 'target', '.harness-x-dev', '.claude'],
      }).map(rel);
      save('agents-skills', {
        agents: (a.body?.agents ?? [])
          .map((x) => ({ name: x.name, source: x.source ?? x.scope }))
          .sort((x, y) => String(x.name).localeCompare(String(y.name))),
        skills,
      });
    }
  });
}
console.log(done.join(' '));
