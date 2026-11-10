import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { TrustStore, hashPluginDir, harnessHome, type TrustLevel } from '@harness-x/kernel';
import { PluginManifestSchema, type Permissions, type PluginManifest } from '@harness-x/protocol';
import type { PermissionSuggestion } from './check.js';
import { copyPlugin } from './sandbox.js';

/**
 * T-052 52.4 설치 카드 / 52.5 설치
 * - 카드: 설치될 파일 목록과 diff(이미 설치된 버전 대비), 권한 요약, 네트워크·셸 권한이면 빨간 경고(danger),
 *   권한 최소화 제안, 설치 뒤 신뢰 등급
 * - 설치: <HARNESS_X_HOME 또는 ~/.harness-x>/plugins/forge/<id>/ 에 파일을 복사하고 Git 저장소로 커밋한다
 *   (다시 설치하면 새 커밋). 등급은 서명되지 않았으므로 '미서명·격리'(unsigned-isolated → worker_threads 격리 실행).
 *   plugins.lock을 새 파일 해시로 갱신한다(사용자가 설치 카드에서 승인한 변경).
 */

export const TRUST_LABELS: Record<TrustLevel, string> = {
  core: '코어',
  trusted: '신뢰',
  'unsigned-isolated': '미서명·격리',
};

export const forgePluginsRoot = (home: string = harnessHome()) => join(home, 'plugins', 'forge');
export const forgeInstallDir = (id: string, home: string = harnessHome()) => join(forgePluginsRoot(home), id);

export interface InstallFileChange {
  path: string;
  change: 'create' | 'modify' | 'delete';
  /** 줄 단위 diff (+/-). 빌드 산출물(dist/)과 큰 파일은 생략 */
  diff?: string;
}

export interface InstallWarning {
  kind: 'net' | 'shell' | 'fs';
  /** danger = 빨간 경고 */
  level: 'danger' | 'warning';
  message: string;
}

export interface InstallCard {
  id: string;
  version: string;
  displayName: string;
  target: string;
  /** 이미 설치돼 있으면 true (다시 설치 = 새 커밋) */
  update: boolean;
  files: InstallFileChange[];
  permissions: Permissions;
  permissionSummary: string[];
  warnings: InstallWarning[];
  suggestions: PermissionSuggestion[];
  trust: TrustLevel;
  trustLabel: string;
}

export interface InstallResult {
  id: string;
  version: string;
  dir: string;
  commit: string;
  files: string[];
  trust: TrustLevel;
  trustLabel: string;
}

const SKIP = new Set(['node_modules', '.git']);

export function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const visit = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      if (SKIP.has(name)) continue;
      const full = join(d, name);
      if (statSync(full).isDirectory()) visit(full);
      else out.push(relative(dir, full).split(sep).join('/'));
    }
  };
  visit(dir);
  return out;
}

const MAX_DIFF_LINES = 400;
const CONTEXT = 3;

/** 줄 단위 diff (LCS). 같은 줄은 ' ', 지운 줄 '-', 넣은 줄 '+' */
export function lineDiff(before: string, after: string): string {
  const a = before === '' ? [] : before.replace(/\n$/, '').split('\n');
  const b = after === '' ? [] : after.replace(/\n$/, '').split('\n');
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES)
    return `(큰 파일: ${a.length}줄 → ${b.length}줄)`;
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push(` ${a[i]}`);
      i++;
      j++;
    } else if (i < a.length && (j >= b.length || lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) out.push(`-${a[i++]}`);
    else out.push(`+${b[j++]}`);
  }
  // 바뀐 줄 앞뒤 CONTEXT줄만 남기고 나머지는 '…'로 접는다
  const near = out.map((_, k) =>
    out.slice(Math.max(0, k - CONTEXT), k + CONTEXT + 1).some((l) => !l.startsWith(' ')),
  );
  const kept: string[] = [];
  out.forEach((l, k) => {
    if (near[k]) kept.push(l);
    else if (kept[kept.length - 1] !== '…') kept.push('…');
  });
  return kept.join('\n');
}

const isGenerated = (p: string) => p.startsWith('dist/');

export function permissionLines(p: Permissions): string[] {
  const lines: string[] = [];
  for (const f of p.fs) lines.push(f === 'workspace:write' ? '워크스페이스 쓰기' : '워크스페이스 읽기');
  if (p.net.length) lines.push(`네트워크: ${p.net.join(', ')}`);
  if (p.shell) lines.push('셸 명령 실행');
  return lines.length ? lines : ['권한 없음'];
}

export function permissionWarnings(p: Permissions): InstallWarning[] {
  const w: InstallWarning[] = [];
  if (p.net.length)
    w.push({
      kind: 'net',
      level: 'danger',
      message: `네트워크 권한(${p.net.join(', ')}): 이 플러그인은 외부로 데이터를 보낼 수 있습니다`,
    });
  if (p.shell)
    w.push({
      kind: 'shell',
      level: 'danger',
      message: '셸 권한: 이 플러그인은 워크스페이스에서 명령을 실행할 수 있습니다',
    });
  if (p.fs.includes('workspace:write'))
    w.push({ kind: 'fs', level: 'warning', message: '워크스페이스 파일을 쓸 수 있습니다' });
  return w;
}

function readManifest(dir: string): PluginManifest {
  return PluginManifestSchema.parse(JSON.parse(readFileSync(join(dir, 'harness-plugin.json'), 'utf8')));
}

function trustAfterInstall(home: string, id: string, sha256: string): TrustLevel {
  return new TrustStore(join(home, 'trust.json')).levelOf({ id, sha256, origin: 'user' });
}

/** 52.4 설치 카드 */
export function buildInstallCard(
  srcDir: string,
  opts: { home?: string; suggestions?: PermissionSuggestion[] } = {},
): InstallCard {
  const home = opts.home ?? harnessHome();
  const m = readManifest(srcDir);
  const target = forgeInstallDir(m.id, home);
  const next = listFiles(srcDir);
  const prev = new Set(listFiles(target));
  const files: InstallFileChange[] = [];
  for (const rel of next) {
    const after = readFileSync(join(srcDir, rel), 'utf8');
    if (prev.has(rel)) {
      const before = readFileSync(join(target, rel), 'utf8');
      if (before === after) continue;
      files.push({
        path: rel,
        change: 'modify',
        ...(isGenerated(rel) ? {} : { diff: lineDiff(before, after) }),
      });
    } else
      files.push({ path: rel, change: 'create', ...(isGenerated(rel) ? {} : { diff: lineDiff('', after) }) });
  }
  for (const rel of prev) if (!next.includes(rel)) files.push({ path: rel, change: 'delete' });
  // 설치 뒤 등급: 서명이 없으니 승격 기록이 같은 해시를 가리키지 않는 한 미서명·격리
  const trust = trustAfterInstall(home, m.id, hashPluginDir(srcDir));
  return {
    id: m.id,
    version: m.version,
    displayName: m.displayName ?? m.id,
    target,
    update: prev.size > 0,
    files,
    permissions: m.permissions,
    permissionSummary: permissionLines(m.permissions),
    warnings: permissionWarnings(m.permissions),
    suggestions: opts.suggestions ?? [],
    trust,
    trustLabel: TRUST_LABELS[trust],
  };
}

function git(cwd: string, args: string[]): string {
  return execFileSync(
    'git',
    [
      '-c',
      'user.name=Forge',
      '-c',
      'user.email=forge@harness-x.local',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    },
  ).trim();
}

function updateLock(home: string, entry: { id: string; version: string; sha256: string }) {
  const file = join(home, 'plugins.lock');
  let plugins: { id: string; version: string; sha256: string }[] = [];
  try {
    plugins = (JSON.parse(readFileSync(file, 'utf8')) as { plugins?: typeof plugins }).plugins ?? [];
  } catch {
    /* 없음 */
  }
  plugins = [...plugins.filter((p) => p.id !== entry.id), entry].sort((a, b) => a.id.localeCompare(b.id));
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ lockfileVersion: 1, plugins }, null, 2) + '\n');
  renameSync(tmp, file);
}

/** 52.5 설치: plugins/forge/<id>/ 에 Git 저장소로 */
export function installPlugin(srcDir: string, opts: { home?: string; message?: string } = {}): InstallResult {
  const home = opts.home ?? harnessHome();
  const m = readManifest(srcDir);
  const dir = forgeInstallDir(m.id, home);
  // .git만 남기고 비운 뒤 새 파일을 복사 (지워진 파일도 반영)
  if (existsSync(dir))
    for (const name of readdirSync(dir))
      if (name !== '.git') rmSync(join(dir, name), { recursive: true, force: true });
  copyPlugin(srcDir, dir);
  if (!existsSync(join(dir, '.git'))) git(dir, ['init', '-q']);
  git(dir, ['add', '-A']);
  if (git(dir, ['status', '--porcelain']))
    git(dir, ['commit', '-q', '-m', opts.message ?? `forge: install ${m.id}@${m.version}`]);
  const commit = git(dir, ['rev-parse', 'HEAD']);
  const sha256 = hashPluginDir(dir);
  updateLock(home, { id: m.id, version: m.version, sha256 });
  const trust = trustAfterInstall(home, m.id, sha256);
  return {
    id: m.id,
    version: m.version,
    dir,
    commit,
    files: listFiles(dir),
    trust,
    trustLabel: TRUST_LABELS[trust],
  };
}
