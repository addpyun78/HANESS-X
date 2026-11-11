import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { harnessHome } from '../loader.js';
import { isWithinKey, normalizePath } from '../path-normalize.js';
import { detectProject, validateWorkspacePath, type ValidateOptions } from '../workspaces.js';
import {
  ProjectMarkerSchema,
  ProjectSchema,
  ProjectsFileSchema,
  type Project,
  type ProjectDefaults,
  type ProjectMarker,
  type ProjectsFile,
} from './schema.js';

/**
 * T-101 0-2 프로젝트 저장소
 * - 0B.3 `<home>/projects.json` + 프로젝트 폴더 안 표식 `.harness-x/project.json`(같은 id).
 *   표식은 Git에 올려도 되는 파일이고, 첨부 폴더만 `.harness-x/.gitignore`로 뺀다.
 * - 0B.4 처음 열 때 `workspaces.json`을 프로젝트로 옮긴다(원본은 `workspaces.json.bak`으로 남긴다).
 * - 0B.7 같은 폴더(경로 비교기 기준)를 두 번 등록하면 기존 프로젝트를 연다.
 * - 0B.8 폴더가 없으면 missing, 새 폴더를 고르면 표식 id로 같은 프로젝트인지 확인하고 다시 연결.
 * - 0B.38 이름 바꾸기는 name만. id·rootPath·세션 연결은 그대로.
 */

export const PROJECT_MARKER_DIR = '.harness-x';
export const PROJECT_MARKER_FILE = 'project.json';
/** 표식 폴더에서 Git에 올리지 않는 것 (첨부 폴더만) */
export const PROJECT_MARKER_GITIGNORE = 'attachments/\n';

export type ProjectErrorCode =
  'invalid' | 'not_found' | 'marker_mismatch' | 'no_marker' | 'not_scratch' | 'not_empty' | 'rejected';

export class ProjectError extends Error {
  constructor(
    readonly code: ProjectErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** 경로 비교 키 (T-100 경로 비교기: 대소문자·`C:\`⇄`/mnt/c`·realpath) */
export function projectPathKey(p: string): string {
  return normalizePath(p, { realpath: true });
}

/** 위로 올라가며 `.git`을 찾는다 (작업 트리의 `.git` 파일도) */
export function findGitRoot(dir: string): string | undefined {
  for (let d = dir; ; d = dirname(d)) {
    if (existsSync(join(d, '.git'))) return d;
    if (dirname(d) === d) return undefined;
  }
}

export interface RootSuggestion {
  /** 고른 폴더 (검증 뒤 실제 경로) */
  path: string;
  gitRoot?: string;
  /** Git 저장소 안쪽 폴더를 골랐다 → 맨 위 폴더를 권한다 */
  suggest: boolean;
  message?: string;
}

export function readProjectMarker(root: string): ProjectMarker | undefined {
  try {
    const raw = JSON.parse(
      readFileSync(join(root, PROJECT_MARKER_DIR, PROJECT_MARKER_FILE), 'utf8'),
    ) as unknown;
    const r = ProjectMarkerSchema.safeParse(raw);
    return r.success ? r.data : undefined;
  } catch {
    return undefined;
  }
}

export function writeProjectMarker(root: string, m: ProjectMarker): void {
  const dir = join(root, PROJECT_MARKER_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, PROJECT_MARKER_FILE), JSON.stringify(m, null, 2) + '\n');
  const ignore = join(dir, '.gitignore');
  if (!existsSync(ignore)) writeFileSync(ignore, PROJECT_MARKER_GITIGNORE);
}

export interface ProjectStoreOptions {
  /** 하네스 홈 (기본 harnessHome()) — projects.json·workspaces.json·scratch/가 여기 */
  home?: string;
  now?: () => Date;
  idGen?: () => string;
  validate?: ValidateOptions;
}

export interface AddResult {
  project: Project;
  /** 0B.7 이미 있던 프로젝트를 열었다 */
  existed: boolean;
}

export interface ProjectChange {
  type: 'added' | 'updated' | 'removed' | 'current';
  project?: Project;
  id: string;
}

export class ProjectStore extends EventEmitter {
  readonly home: string;
  readonly file: string;
  private readonly now: () => Date;
  private readonly idGen: () => string;
  private readonly validateOpts: ValidateOptions;
  private data: ProjectsFile;
  /** 0B.4 이번 기동에서 옮긴 워크스페이스 수 (없으면 undefined) */
  readonly migrated?: number;

  constructor(opts: ProjectStoreOptions = {}) {
    super();
    this.home = opts.home ?? harnessHome();
    this.file = join(this.home, 'projects.json');
    this.now = opts.now ?? (() => new Date());
    this.idGen = opts.idGen ?? randomUUID;
    this.validateOpts = opts.validate ?? {};
    if (!existsSync(this.file) && existsSync(join(this.home, 'workspaces.json'))) {
      this.data = { version: 1, projects: [] };
      this.migrated = this.migrateFromWorkspaces();
    } else this.data = this.load();
  }

  private load(): ProjectsFile {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<ProjectsFile>;
      const projects = (Array.isArray(raw.projects) ? raw.projects : []).flatMap((p) => {
        const r = ProjectSchema.safeParse(p);
        return r.success ? [r.data] : [];
      });
      const v = ProjectsFileSchema.safeParse({ ...raw, version: 1, projects });
      return v.success ? v.data : { version: 1, projects };
    } catch {
      return { version: 1, projects: [] };
    }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2) + '\n');
    renameSync(tmp, this.file);
  }

  private change(c: ProjectChange) {
    this.emit('changed', c);
  }

  onChange(fn: (c: ProjectChange) => void): () => void {
    this.on('changed', fn);
    return () => this.off('changed', fn);
  }

  // ── 0B.4 마이그레이션 ─────────────────────────────────────
  /** workspaces.json의 워크스페이스 하나 = 프로젝트 하나. 원본은 workspaces.json.bak으로 복사해 둔다 */
  private migrateFromWorkspaces(): number {
    const src = join(this.home, 'workspaces.json');
    let list: { name?: unknown; path?: unknown; lastUsedAt?: unknown; pinned?: unknown }[] = [];
    let current: string | undefined;
    try {
      const raw = JSON.parse(readFileSync(src, 'utf8')) as { workspaces?: unknown; current?: unknown };
      if (Array.isArray(raw.workspaces)) list = raw.workspaces as typeof list;
      if (typeof raw.current === 'string') current = raw.current;
    } catch {
      list = [];
    }
    copyFileSync(src, `${src}.bak`);
    const seen = new Set<string>();
    for (const w of list) {
      if (typeof w?.path !== 'string' || !w.path) continue;
      const key = projectPathKey(w.path);
      if (seen.has(key)) continue;
      seen.add(key);
      const at = typeof w.lastUsedAt === 'string' ? w.lastUsedAt : this.now().toISOString();
      const p = this.makeProject(w.path, {
        name: typeof w.name === 'string' && w.name ? w.name : basename(w.path) || w.path,
        at,
        pinned: w.pinned === true,
      });
      this.data.projects.push(p);
      if (current && projectPathKey(current) === key) this.data.current = p.id;
    }
    this.save();
    return this.data.projects.length;
  }

  private makeProject(
    rootPath: string,
    o: { name?: string; at?: string; pinned?: boolean; id?: string; scratch?: boolean },
  ): Project {
    const exists = existsSync(rootPath);
    const marker = exists ? readProjectMarker(rootPath) : undefined;
    const at = o.at ?? this.now().toISOString();
    const gitRoot = exists ? findGitRoot(rootPath) : undefined;
    const branch = exists ? detectProject(rootPath).branch : undefined;
    const p: Project = {
      id: o.id ?? marker?.id ?? this.idGen(),
      name: o.name ?? (basename(rootPath) || rootPath),
      rootPath,
      ...(gitRoot ? { gitRoot } : {}),
      ...(branch ? { branch } : {}),
      createdAt: marker?.createdAt ?? at,
      lastOpenedAt: at,
      pinned: o.pinned ?? false,
      order: this.nextOrder(),
      missing: !exists,
      ...(o.scratch ? { scratch: true } : {}),
    };
    if (exists) this.tryMarker(p);
    return p;
  }

  private tryMarker(p: Project) {
    try {
      writeProjectMarker(p.rootPath, { id: p.id, name: p.name, createdAt: p.createdAt });
    } catch {
      /* 읽기 전용 폴더: 표식 없이도 projects.json으로 동작 */
    }
  }

  private nextOrder(): number {
    return this.data.projects.reduce((m, p) => Math.max(m, p.order + 1), 0);
  }

  // ── 조회 ─────────────────────────────────────────────────
  /** 0B.8 경로가 사라졌으면 missing (목록을 볼 때마다 다시 확인) */
  refreshMissing(): void {
    let dirty = false;
    for (const p of this.data.projects) {
      const missing = !isDir(p.rootPath);
      if (missing !== p.missing) {
        p.missing = missing;
        dirty = true;
      }
    }
    if (dirty) this.save();
  }

  /** 고정 먼저, 그다음 저장된 순서(끌어서 바꾼 순서) */
  list(): Project[] {
    this.refreshMissing();
    return [...this.data.projects]
      .sort(
        (a, b) => Number(b.pinned) - Number(a.pinned) || a.order - b.order || a.name.localeCompare(b.name),
      )
      .map((p) => structuredClone(p));
  }

  get(id: string): Project | undefined {
    const p = this.find(id);
    return p ? structuredClone(p) : undefined;
  }

  private find(id: string): Project | undefined {
    return this.data.projects.find((p) => p.id === id);
  }

  /** 없으면 ProjectError (복사본) */
  require(id: string): Project {
    return structuredClone(this.mut(id));
  }

  private mut(id: string): Project {
    const p = this.find(id);
    if (!p) throw new ProjectError('not_found', `프로젝트를 찾을 수 없어요: ${id}`);
    return p;
  }

  /** 같은 폴더(경로 비교기 기준)의 프로젝트 */
  findByPath(path: string): Project | undefined {
    const p = this.findPathMut(path);
    return p ? structuredClone(p) : undefined;
  }

  private findPathMut(path: string): Project | undefined {
    const key = projectPathKey(path);
    return this.data.projects.find((p) => projectPathKey(p.rootPath) === key);
  }

  /** 0B.5 cwd를 품는 프로젝트 (가장 깊은 루트). 옛 세션 마이그레이션에서만 쓴다 (0B.39) */
  findContaining(path: string): Project | undefined {
    const key = projectPathKey(path);
    let best: { p: Project; len: number } | undefined;
    for (const p of this.data.projects) {
      const root = projectPathKey(p.rootPath);
      if (isWithinKey(key, root) && (!best || root.length > best.len)) best = { p, len: root.length };
    }
    return best ? structuredClone(best.p) : undefined;
  }

  /**
   * 0B.39 새 세션을 만들 때 한 번만: cwd(하위 폴더·작업 트리)가 속한 프로젝트를 정해 projectId로 저장한다.
   * 작업 트리(`.git` 파일 → gitdir → commondir)는 본 저장소 루트로 바꿔 찾는다.
   */
  findForCwd(cwd: string): Project | undefined {
    const direct = this.findContaining(cwd);
    if (direct) return direct;
    const main = mainRepoRoot(cwd);
    return main ? this.findContaining(main) : undefined;
  }

  current(): Project | undefined {
    return this.data.current ? this.get(this.data.current) : undefined;
  }

  /** 0B.31 지금 고른 프로젝트 (사이드바·상단 바·+ 메뉴가 같은 값) */
  setCurrent(id: string | undefined): Project | undefined {
    if (id === undefined) {
      delete this.data.current;
      this.save();
      this.change({ type: 'current', id: '' });
      return undefined;
    }
    const p = this.mut(id);
    p.lastOpenedAt = this.now().toISOString();
    this.data.current = id;
    this.save();
    this.change({ type: 'current', id, project: structuredClone(p) });
    return structuredClone(p);
  }

  // ── 0B.6 루트 추천 ────────────────────────────────────────
  suggestRoot(path: string): RootSuggestion {
    const v = validateWorkspacePath(path, this.validateOpts);
    if (!v.ok) throw new ProjectError('rejected', v.message);
    const gitRoot = findGitRoot(v.path);
    if (gitRoot && projectPathKey(gitRoot) !== projectPathKey(v.path))
      return {
        path: v.path,
        gitRoot,
        suggest: true,
        message: `저장소 맨 위 폴더(${gitRoot})로 할까요?`,
      };
    return { path: v.path, ...(gitRoot ? { gitRoot } : {}), suggest: false };
  }

  // ── 0B.3 / 0B.7 등록 ─────────────────────────────────────
  add(path: string, o: { name?: string; select?: boolean } = {}): AddResult {
    const v = validateWorkspacePath(path, this.validateOpts);
    if (!v.ok) throw new ProjectError('rejected', v.message);
    const select = o.select ?? true;
    const same = this.findPathMut(v.path);
    if (same) {
      same.missing = false;
      if (select) this.setCurrent(same.id);
      else this.save();
      return { project: structuredClone(same), existed: true };
    }
    // 폴더를 옮긴 뒤 새 위치로 다시 고른 경우: 표식 id가 기존 프로젝트면 그 프로젝트를 다시 연결
    const marker = readProjectMarker(v.path);
    const known = marker ? this.find(marker.id) : undefined;
    if (known) {
      const p = this.relink(known.id, v.path);
      if (select) this.setCurrent(p.id);
      return { project: p, existed: true };
    }
    const p = this.makeProject(v.path, { ...(o.name ? { name: o.name } : {}) });
    this.data.projects.push(p);
    if (select) this.data.current = p.id;
    this.save();
    this.change({ type: 'added', id: p.id, project: structuredClone(p) });
    return { project: structuredClone(p), existed: false };
  }

  // ── 0B.38 이름 바꾸기: name만 ───────────────────────────────
  rename(id: string, name: string): Project {
    const n = name.trim();
    if (!n) throw new ProjectError('invalid', '이름이 비었어요');
    const p = this.mut(id);
    p.name = n;
    if (isDir(p.rootPath) && readProjectMarker(p.rootPath)?.id === p.id) this.tryMarker(p);
    this.save();
    this.change({ type: 'updated', id, project: structuredClone(p) });
    return structuredClone(p);
  }

  setPinned(id: string, pinned: boolean): Project {
    const p = this.mut(id);
    p.pinned = pinned;
    this.save();
    this.change({ type: 'updated', id, project: structuredClone(p) });
    return structuredClone(p);
  }

  /** 0B.26 끌어서 바꾼 순서 저장 (빠진 프로젝트는 뒤에 그대로) */
  reorder(ids: string[]): Project[] {
    const rest = this.data.projects.filter((p) => !ids.includes(p.id)).sort((a, b) => a.order - b.order);
    const ordered = [...ids.map((id) => this.mut(id)), ...rest];
    ordered.forEach((p, i) => (p.order = i));
    this.save();
    this.change({ type: 'updated', id: '' });
    return this.list();
  }

  /** 0B.40 프로젝트 기본값 (빈 칸은 지운다 → 전체 설정을 따름) */
  setDefaults(id: string, d: ProjectDefaults): Project {
    const p = this.mut(id);
    const clean = Object.fromEntries(
      Object.entries(d).filter(([, v]) => typeof v === 'string' && v.trim()),
    ) as ProjectDefaults;
    if (Object.keys(clean).length) p.defaults = clean;
    else delete p.defaults;
    this.save();
    this.change({ type: 'updated', id, project: structuredClone(p) });
    return structuredClone(p);
  }

  /** 0B.28 목록에서 빼기 — 파일·표식은 지우지 않는다 */
  remove(id: string): void {
    this.mut(id);
    this.data.projects = this.data.projects.filter((p) => p.id !== id);
    if (this.data.current === id) delete this.data.current;
    this.save();
    this.change({ type: 'removed', id });
  }

  // ── 0B.8 다시 연결 ─────────────────────────────────────────
  /** 새 폴더의 표식 id가 같은 프로젝트인지 확인하고 기록 그대로 연결. 표식이 없으면 force일 때만 */
  relink(id: string, path: string, o: { force?: boolean } = {}): Project {
    const p = this.mut(id);
    const v = validateWorkspacePath(path, this.validateOpts);
    if (!v.ok) throw new ProjectError('rejected', v.message);
    const marker = readProjectMarker(v.path);
    if (marker && marker.id !== id)
      throw new ProjectError('marker_mismatch', `다른 프로젝트의 폴더예요 (${marker.name})`);
    if (!marker && !o.force)
      throw new ProjectError(
        'no_marker',
        '이 폴더에는 이 프로젝트 표시가 없어요. 그래도 이 폴더로 연결하려면 한 번 더 확인해 주세요',
      );
    const other = this.findByPath(v.path);
    if (other && other.id !== id) throw new ProjectError('invalid', `이미 다른 프로젝트예요: ${other.name}`);
    p.rootPath = v.path;
    p.missing = false;
    const gitRoot = findGitRoot(v.path);
    if (gitRoot) p.gitRoot = gitRoot;
    else delete p.gitRoot;
    const branch = detectProject(v.path).branch;
    if (branch) p.branch = branch;
    else delete p.branch;
    this.tryMarker(p);
    this.save();
    this.change({ type: 'updated', id, project: structuredClone(p) });
    return structuredClone(p);
  }

  // ── 0B.16 임시 작업 공간 ────────────────────────────────────
  scratchDir(): string {
    return join(this.home, 'scratch');
  }

  createScratch(): Project {
    const d = this.now();
    const stamp = d.toISOString().slice(0, 10).replace(/-/g, '');
    const dir = join(this.scratchDir(), `${stamp}-${this.idGen().replace(/-/g, '').slice(0, 6)}`);
    mkdirSync(dir, { recursive: true });
    const seq = (this.data.scratchSeq ?? 0) + 1;
    this.data.scratchSeq = seq;
    const p = this.makeProject(dir, { name: `임시 작업 ${seq}`, scratch: true });
    this.data.projects.push(p);
    this.data.current = p.id;
    this.save();
    this.change({ type: 'added', id: p.id, project: structuredClone(p) });
    return structuredClone(p);
  }

  /** 임시 작업 공간의 파일을 고른 폴더로 옮기고 그 폴더를 프로젝트 폴더로 (id·세션은 그대로) */
  moveScratch(id: string, dest: string): Project {
    const p = this.mut(id);
    if (!p.scratch) throw new ProjectError('not_scratch', '임시 작업 공간만 옮길 수 있어요');
    const v = validateWorkspacePath(dest, this.validateOpts);
    if (!v.ok) throw new ProjectError('rejected', v.message);
    const theirs = readProjectMarker(v.path);
    if (theirs && theirs.id !== id) throw new ProjectError('marker_mismatch', '이미 다른 프로젝트 폴더예요');
    const src = p.rootPath;
    if (isDir(src)) {
      for (const name of readdirSync(src)) {
        if (existsSync(join(v.path, name)) && name !== PROJECT_MARKER_DIR)
          throw new ProjectError('not_empty', `옮길 폴더에 같은 이름이 이미 있어요: ${name}`);
      }
      cpSync(src, v.path, { recursive: true, force: true });
      rmSync(src, { recursive: true, force: true });
    }
    p.rootPath = v.path;
    p.missing = false;
    delete p.scratch;
    if (/^임시 작업 \d+$/.test(p.name)) p.name = basename(v.path) || p.name;
    const gitRoot = findGitRoot(v.path);
    if (gitRoot) p.gitRoot = gitRoot;
    this.tryMarker(p);
    this.save();
    this.change({ type: 'updated', id, project: structuredClone(p) });
    return structuredClone(p);
  }

  /** 0B.41 AGENTS.md / CLAUDE.md 있음 표시 */
  info(id: string): { hasAgentsMd: boolean; hasClaudeMd: boolean; branch?: string; git: boolean } {
    const p = this.require(id);
    if (!isDir(p.rootPath)) return { hasAgentsMd: false, hasClaudeMd: false, git: false };
    const d = detectProject(p.rootPath);
    return {
      hasAgentsMd: d.hasAgentsMd,
      hasClaudeMd: d.hasClaudeMd,
      git: d.git,
      ...(d.branch ? { branch: d.branch } : {}),
    };
  }
}

/** 작업 트리 폴더 → 본 저장소 루트 (작업 트리가 아니면 undefined) */
export function mainRepoRoot(dir: string): string | undefined {
  const root = findGitRoot(dir);
  if (!root) return undefined;
  const g = join(root, '.git');
  try {
    if (!statSync(g).isFile()) return undefined;
    const m = /^gitdir:\s*(.+)\s*$/m.exec(readFileSync(g, 'utf8'));
    if (!m) return undefined;
    const gitdir = resolve(root, m[1]!.trim());
    const common = existsSync(join(gitdir, 'commondir'))
      ? resolve(gitdir, readFileSync(join(gitdir, 'commondir'), 'utf8').trim())
      : resolve(gitdir, '..', '..');
    return dirname(common);
  } catch {
    return undefined;
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
