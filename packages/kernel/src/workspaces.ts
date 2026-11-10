import { EventEmitter } from 'node:events';
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { BlockingHandler, HookResult } from './hooks.js';
import { harnessHome } from './loader.js';
import { winToWslFallback } from './native/folder-picker.js';

/**
 * 워크스페이스 등록과 최근 프로젝트 (T-035)
 *
 * 선택한 폴더는 세 가지로 쓰인다: 새 세션의 cwd, permission-gate의 쓰기 허용 경계(워크스페이스 루트),
 * manifest 정식 경로의 기준 루트. 폴더를 바꾸면 'changed'(= workspace.changed) 이벤트로 함께 바뀐다.
 * 저장: ~/.harness-x/workspaces.json (HARNESS_X_HOME 존중)
 */

export const WORKSPACE_CHANGED = 'workspace.changed';
export const MAX_RECENT = 10;

// ── 35.1 경로 검증 ────────────────────────────────────────────────

export type WorkspaceRejectCode =
  'invalid' | 'not_found' | 'not_directory' | 'not_readable' | 'system_dir' | 'home_root';

export class WorkspaceRejectedError extends Error {
  constructor(
    readonly code: WorkspaceRejectCode,
    message: string,
  ) {
    super(message);
  }
}

export type ValidateResult =
  { ok: true; path: string } | { ok: false; code: WorkspaceRejectCode; message: string };

export interface ValidateOptions {
  /** 홈 폴더 (기본 os.homedir()) */
  home?: string;
  platform?: NodeJS.Platform;
}

const WIN_RE = /^[A-Za-z]:([\\/]|$)/;

/** Windows 형식 경로를 비교용 키로: 소문자, \ 구분자, 끝 \ 제거 (드라이브 루트는 c:\) */
function winKey(p: string): string {
  let k = p.replace(/\//g, '\\').toLowerCase();
  if (/^[a-z]:$/.test(k)) k += '\\';
  if (k.length > 3) k = k.replace(/\\+$/, '');
  return k;
}

/** /mnt/c/... → c:\... (WSL 드라이브 마운트), 아니면 undefined */
function wslMountToWin(p: string): string | undefined {
  const m = /^\/mnt\/([a-z])(\/.*)?$/i.exec(p);
  if (!m) return undefined;
  return winKey(`${m[1]}:\\${(m[2] ?? '').replace(/^\//, '')}`);
}

const WIN_SUBTREE = [
  'windows',
  'program files',
  'program files (x86)',
  '$recycle.bin',
  'system volume information',
];
const WIN_EXACT = ['', 'programdata', 'users'];
const POSIX_SUBTREE = [
  '/etc',
  '/proc',
  '/sys',
  '/dev',
  '/boot',
  '/bin',
  '/sbin',
  '/lib',
  '/lib32',
  '/lib64',
  '/usr',
];
const POSIX_EXACT = ['/', '/home', '/mnt', '/var', '/opt', '/tmp', '/root', '/srv', '/run', '/media'];

/** 시스템 폴더인가 (C:\Windows·Program Files·드라이브 루트, /etc·/usr·/ 등). WSL 마운트(/mnt/c/Windows)도 같은 규칙 */
export function isSystemDir(p: string): boolean {
  const win = WIN_RE.test(p) ? winKey(p) : wslMountToWin(p.replace(/\/+$/, '') || '/');
  if (win) {
    const rest = win.slice(3); // "c:\" 뒤
    if (WIN_EXACT.includes(rest)) return true;
    return WIN_SUBTREE.some((d) => rest === d || rest.startsWith(d + '\\'));
  }
  const n = p.replace(/\/+$/, '') || '/';
  if (POSIX_EXACT.includes(n)) return true;
  return POSIX_SUBTREE.some((d) => n === d || n.startsWith(d + '/'));
}

/** 홈 폴더 자체인가 (하위 폴더는 허용). Windows 홈(C:\Users\x, /mnt/c/Users/x)도 */
export function isHomeRoot(p: string, home = homedir()): boolean {
  const norm = (x: string) => x.replace(/[\\/]+$/, '');
  if (norm(p) === norm(home)) return true;
  if (WIN_RE.test(home) && WIN_RE.test(p) && winKey(p) === winKey(home)) return true;
  const win = WIN_RE.test(p) ? winKey(p) : wslMountToWin(norm(p));
  return !!win && /^[a-z]:\\users\\[^\\]+$/.test(win) && !/\\(public|default)$/.test(win);
}

/** 35.1 존재·폴더·읽기 권한·시스템 폴더·홈 루트 검사. 통과하면 실제 경로(realpath) */
export function validateWorkspacePath(input: string, opts: ValidateOptions = {}): ValidateResult {
  const platform = opts.platform ?? process.platform;
  const home = opts.home ?? homedir();
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) return { ok: false, code: 'invalid', message: '경로가 비었습니다' };
  // WSL·리눅스에서 Windows 경로가 오면 /mnt/<드라이브>/... 로
  const p = platform !== 'win32' && WIN_RE.test(raw) ? winToWslFallback(raw) : raw;
  if (!isAbsolute(p) && !WIN_RE.test(p))
    return { ok: false, code: 'invalid', message: `절대 경로가 아닙니다: ${raw}` };

  const policy = (x: string): ValidateResult | undefined => {
    if (isSystemDir(x))
      return { ok: false, code: 'system_dir', message: `시스템 폴더는 프로젝트로 열 수 없습니다: ${x}` };
    if (isHomeRoot(x, home))
      return {
        ok: false,
        code: 'home_root',
        message: `홈 폴더 전체는 프로젝트로 열 수 없습니다. 하위 폴더를 고르세요: ${x}`,
      };
    return undefined;
  };
  const abs = resolve(p);
  const early = policy(abs);
  if (early) return early;

  if (!existsSync(abs)) return { ok: false, code: 'not_found', message: `폴더가 없습니다: ${abs}` };
  let st;
  try {
    st = statSync(abs);
  } catch (err) {
    return { ok: false, code: 'not_readable', message: `읽을 수 없습니다: ${abs} (${String(err)})` };
  }
  if (!st.isDirectory()) return { ok: false, code: 'not_directory', message: `폴더가 아닙니다: ${abs}` };
  try {
    accessSync(abs, constants.R_OK | constants.X_OK);
    readdirSync(abs);
  } catch {
    return { ok: false, code: 'not_readable', message: `읽기 권한이 없습니다: ${abs}` };
  }
  const real = realpathSync(abs);
  return policy(real) ?? { ok: true, path: real };
}

// ── 35.3 Git·지침 파일 감지 ───────────────────────────────────────

export interface ProjectInfo {
  /** git 저장소 안인가 */
  git: boolean;
  /** 현재 브랜치 (detached면 커밋 앞 7자리) */
  branch?: string;
  hasAgentsMd: boolean;
  hasClaudeMd: boolean;
}

function readHead(gitPath: string): string | undefined {
  try {
    let dir = gitPath;
    if (statSync(gitPath).isFile()) {
      // worktree·submodule: ".git" 파일에 "gitdir: <경로>"
      const m = /^gitdir:\s*(.+)\s*$/m.exec(readFileSync(gitPath, 'utf8'));
      if (!m) return undefined;
      dir = resolve(dirname(gitPath), m[1]!.trim());
    }
    return readFileSync(join(dir, 'HEAD'), 'utf8').trim();
  } catch {
    return undefined;
  }
}

/** git 명령 없이 .git/HEAD를 읽어 브랜치를 찾는다 (상위 폴더까지 탐색) */
export function detectProject(dir: string): ProjectInfo {
  const info: ProjectInfo = {
    git: false,
    hasAgentsMd: existsSync(join(dir, 'AGENTS.md')),
    hasClaudeMd: existsSync(join(dir, 'CLAUDE.md')),
  };
  for (let d = dir; ; d = dirname(d)) {
    const g = join(d, '.git');
    if (existsSync(g)) {
      const head = readHead(g);
      info.git = true;
      if (head) {
        const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
        info.branch = ref ? ref[1] : head.slice(0, 7);
      }
      break;
    }
    if (dirname(d) === d) break;
  }
  return info;
}

// ── 35.2 등록 / 35.5 최근 목록 ─────────────────────────────────────

export interface WorkspaceEntry {
  /** 폴더 이름 */
  name: string;
  path: string;
  /** ISO 시각 */
  lastUsedAt: string;
  pinned?: boolean;
}

export interface WorkspaceInfo extends WorkspaceEntry, ProjectInfo {}

interface WorkspacesFile {
  version: 1;
  current?: string;
  workspaces: WorkspaceEntry[];
}

/** 35.5 고정 핀 먼저, 그다음 최근 사용 순. 최대 max개 (핀은 잘리지 않는다) */
export function sortRecent(entries: WorkspaceEntry[], max = MAX_RECENT): WorkspaceEntry[] {
  const byTime = (a: WorkspaceEntry, b: WorkspaceEntry) =>
    b.lastUsedAt.localeCompare(a.lastUsedAt) || a.name.localeCompare(b.name);
  const pinned = entries.filter((e) => e.pinned).sort(byTime);
  const rest = entries.filter((e) => !e.pinned).sort(byTime);
  return [...pinned, ...rest].slice(0, Math.max(max, pinned.length));
}

export interface WorkspaceStoreOptions {
  /** 기본 <HARNESS_X_HOME>/workspaces.json */
  file?: string;
  max?: number;
  now?: () => Date;
  validate?: ValidateOptions;
}

export interface WorkspaceChange {
  type: typeof WORKSPACE_CHANGED;
  /** 새 워크스페이스 루트 (permission-gate 쓰기 경계, 새 세션 cwd) */
  root: string;
  previous?: string;
  workspace: WorkspaceInfo;
}

export class WorkspaceStore extends EventEmitter {
  readonly file: string;
  private readonly max: number;
  private readonly now: () => Date;
  private readonly validateOpts: ValidateOptions;
  private data: WorkspacesFile;

  constructor(opts: WorkspaceStoreOptions = {}) {
    super();
    this.file = opts.file ?? join(harnessHome(), 'workspaces.json');
    this.max = opts.max ?? MAX_RECENT;
    this.now = opts.now ?? (() => new Date());
    this.validateOpts = opts.validate ?? {};
    this.data = this.load();
  }

  private load(): WorkspacesFile {
    try {
      const v = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<WorkspacesFile>;
      const list = Array.isArray(v.workspaces)
        ? v.workspaces.filter(
            (w): w is WorkspaceEntry =>
              !!w &&
              typeof w.path === 'string' &&
              typeof w.name === 'string' &&
              typeof w.lastUsedAt === 'string',
          )
        : [];
      return {
        version: 1,
        ...(typeof v.current === 'string' ? { current: v.current } : {}),
        workspaces: list,
      };
    } catch {
      return { version: 1, workspaces: [] };
    }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2) + '\n');
    renameSync(tmp, this.file);
  }

  private info(e: WorkspaceEntry): WorkspaceInfo {
    return { ...e, ...detectProject(e.path) };
  }

  /** 검증 → 등록(이름=폴더명, 경로, 최근 사용 시각) → 현재 워크스페이스로. 실패면 WorkspaceRejectedError */
  open(path: string): WorkspaceInfo {
    const v = validateWorkspacePath(path, this.validateOpts);
    if (!v.ok) throw new WorkspaceRejectedError(v.code, v.message);
    const previous = this.data.current;
    const old = this.data.workspaces.find((w) => w.path === v.path);
    const entry: WorkspaceEntry = {
      name: basename(v.path) || v.path,
      path: v.path,
      lastUsedAt: this.now().toISOString(),
      ...(old?.pinned ? { pinned: true } : {}),
    };
    this.data.workspaces = sortRecent(
      [entry, ...this.data.workspaces.filter((w) => w.path !== v.path)],
      this.max,
    );
    this.data.current = v.path;
    this.save();
    const workspace = this.info(entry);
    if (previous !== v.path) {
      const change: WorkspaceChange = {
        type: WORKSPACE_CHANGED,
        root: v.path,
        workspace,
        ...(previous ? { previous } : {}),
      };
      this.emit('changed', change);
    }
    return workspace;
  }

  /** 'changed' 구독 (해제 함수 반환) */
  onChange(fn: (c: WorkspaceChange) => void): () => void {
    this.on('changed', fn);
    return () => this.off('changed', fn);
  }

  current(): WorkspaceInfo | undefined {
    const e = this.data.workspaces.find((w) => w.path === this.data.current);
    return e ? this.info(e) : undefined;
  }

  /** 35.7 permission-gate가 쓰는 워크스페이스 루트 */
  workspaceRoot(): string | undefined {
    return this.data.current;
  }

  /** 35.4 새 세션의 작업 폴더 (워크스페이스가 없으면 fallback) */
  sessionCwd(fallback: string = process.cwd()): string {
    return this.data.current ?? fallback;
  }

  recent(): WorkspaceInfo[] {
    return sortRecent(this.data.workspaces, this.max).map((e) => this.info(e));
  }

  /** 고정 핀 켜기/끄기 */
  pin(path: string, pinned: boolean): WorkspaceInfo[] {
    const e = this.data.workspaces.find((w) => w.path === path);
    if (!e) throw new WorkspaceRejectedError('not_found', `등록되지 않은 워크스페이스: ${path}`);
    if (pinned) e.pinned = true;
    else delete e.pinned;
    this.data.workspaces = sortRecent(this.data.workspaces, this.max);
    this.save();
    return this.recent();
  }
}

// ── 35.7 권한 경계 ────────────────────────────────────────────────

export type BoundaryDecision = 'allow' | 'ask';

/** 아직 없는 파일이면 존재하는 가장 가까운 상위 폴더의 realpath 기준으로 */
function realish(p: string): string {
  let cur = p;
  const tail: string[] = [];
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) return p;
    tail.unshift(basename(cur));
    cur = parent;
  }
  return join(realpathSync(cur), ...tail);
}

/** 쓰기 대상이 워크스페이스 루트 안이면 allow, 밖이면 ask (루트가 없으면 ask) */
export function checkWriteBoundary(root: string | undefined, target: string, cwd = root): BoundaryDecision {
  if (!root) return 'ask';
  const base = cwd ?? root;
  const abs = realish(
    resolve(base, WIN_RE.test(target) && process.platform !== 'win32' ? winToWslFallback(target) : target),
  );
  const r = realish(resolve(root));
  const rel = relative(r, abs);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)) ? 'allow' : 'ask';
}

const WRITE_TOOL_RE =
  /^(write_file|write|edit|multiedit|multi_edit|notebookedit|create_file|delete_file|apply_patch|str_replace\w*)$/i;
const PATH_KEYS = ['path', 'file_path', 'filePath', 'notebook_path', 'target'] as const;

/** tool.before 입력에서 쓰기 대상 경로 찾기 (쓰기 도구가 아니면 undefined) */
export function writeTargets(tool: unknown, input: unknown): string[] | undefined {
  if (typeof tool !== 'string' || !WRITE_TOOL_RE.test(tool)) return undefined;
  const o = (input ?? {}) as Record<string, unknown>;
  return PATH_KEYS.map((k) => o[k]).filter((v): v is string => typeof v === 'string' && v.length > 0);
}

/**
 * 최소 tool.before 경계 훅: 워크스페이스 루트 밖 쓰기 → ask.
 * 커널 훅 결정에는 아직 ask가 없으므로 decision 'block' + reason "ask: ..." 로 돌려준다
 * (permission-gate가 이를 승인 요청으로 바꾼다). 루트는 store가 바뀌면 즉시 따라간다.
 */
export function workspaceBoundaryHook(store: Pick<WorkspaceStore, 'workspaceRoot'>): BlockingHandler {
  return (ctx): HookResult | void => {
    const targets = writeTargets(ctx.tool, ctx.input);
    if (!targets?.length) return;
    const root = store.workspaceRoot();
    const cwd = typeof ctx.cwd === 'string' ? ctx.cwd : root;
    const outside = targets.filter((t) => checkWriteBoundary(root, t, cwd) === 'ask');
    if (!outside.length) return { decision: 'allow' };
    return {
      decision: 'block',
      reason: `ask: 워크스페이스 루트(${root ?? '없음'}) 밖 쓰기 — ${outside.join(', ')}`,
    };
  };
}
