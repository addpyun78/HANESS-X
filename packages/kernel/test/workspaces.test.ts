import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HarnessEvent } from '@harness-x/protocol';
import { runAgentLoop, type ModelClient, type ModelTurn } from '../src/agent-loop.js';
import { HookBus } from '../src/hooks.js';
import {
  checkWriteBoundary,
  detectProject,
  isHomeRoot,
  isSystemDir,
  MAX_RECENT,
  sortRecent,
  validateWorkspacePath,
  workspaceBoundaryHook,
  WorkspaceRejectedError,
  WorkspaceStore,
  type WorkspaceChange,
  type WorkspaceEntry,
} from '../src/workspaces.js';
import { tempDir } from './helpers.js';

let t: ReturnType<typeof tempDir>;
beforeEach(() => (t = tempDir('hx-ws-')));
afterEach(() => {
  try {
    chmodSync(join(t.dir, 'locked'), 0o755);
  } catch {
    /* 없음 */
  }
  t.cleanup();
});

const mk = (...p: string[]) => {
  const d = join(t.dir, ...p);
  mkdirSync(d, { recursive: true });
  return d;
};

describe('35.1 선택 경로 검증 — 거부 5종', () => {
  it('없음 / 파일 / 읽기 권한 없음 / 시스템 폴더 / 홈 루트', () => {
    const home = mk('home', 'me');
    const opts = { home };
    // 1) 존재하지 않음
    expect(validateWorkspacePath(join(t.dir, 'nope'), opts)).toMatchObject({ ok: false, code: 'not_found' });
    // 2) 폴더가 아님
    writeFileSync(join(t.dir, 'file.txt'), 'x');
    expect(validateWorkspacePath(join(t.dir, 'file.txt'), opts)).toMatchObject({
      ok: false,
      code: 'not_directory',
    });
    // 3) 읽기 권한 없음 (root 계정이면 권한 검사가 무의미하므로 건너뜀)
    const locked = mk('locked');
    chmodSync(locked, 0o000);
    if (process.getuid?.() !== 0)
      expect(validateWorkspacePath(locked, opts)).toMatchObject({ ok: false, code: 'not_readable' });
    // 4) 시스템 폴더: C:\Windows (WSL에서는 /mnt/c/Windows로 변환), /etc
    expect(validateWorkspacePath('C:\\Windows', opts)).toMatchObject({ ok: false, code: 'system_dir' });
    expect(validateWorkspacePath('C:\\Windows\\System32', opts)).toMatchObject({
      ok: false,
      code: 'system_dir',
    });
    expect(validateWorkspacePath('/etc', opts)).toMatchObject({ ok: false, code: 'system_dir' });
    // 5) 홈 루트 (하위 폴더는 허용)
    expect(validateWorkspacePath(home, opts)).toMatchObject({ ok: false, code: 'home_root' });
    expect(validateWorkspacePath(home + '/', opts)).toMatchObject({ ok: false, code: 'home_root' });
    const proj = mk('home', 'me', 'proj');
    expect(validateWorkspacePath(proj, opts)).toEqual({ ok: true, path: realpathSync(proj) });
    // 빈 값·상대 경로
    expect(validateWorkspacePath('', opts)).toMatchObject({ ok: false, code: 'invalid' });
    expect(validateWorkspacePath('rel/dir', opts)).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('시스템 폴더·홈 판정 표', () => {
    for (const p of [
      'C:\\Windows',
      'c:/windows/system32',
      'C:\\',
      'D:',
      'C:\\Program Files\\Git',
      'C:\\Users',
      '/mnt/c',
      '/mnt/c/Windows',
      '/mnt/c/Program Files (x86)/x',
      '/',
      '/usr/bin',
      '/home',
    ])
      expect(isSystemDir(p), p).toBe(true);
    for (const p of [
      'C:\\agentCli\\harness-x',
      '/mnt/c/work/app',
      '/home/me/proj',
      '/tmp/x',
      'C:\\Windowsill',
    ])
      expect(isSystemDir(p), p).toBe(false);
    expect(isHomeRoot('C:\\Users\\me', '/home/me')).toBe(true);
    expect(isHomeRoot('/mnt/c/Users/me', '/home/me')).toBe(true);
    expect(isHomeRoot('/mnt/c/Users/me/proj', '/home/me')).toBe(false);
    expect(isHomeRoot('/home/me', '/home/me')).toBe(true);
  });
});

describe('35.2 워크스페이스 등록 → workspaces.json', () => {
  it('이름=폴더명, 경로, 최근 사용 시각이 파일에 기록되고 HARNESS_X_HOME을 따른다', () => {
    const prev = process.env.HARNESS_X_HOME;
    process.env.HARNESS_X_HOME = join(t.dir, 'hxhome');
    try {
      let now = new Date('2026-11-10T00:00:00Z');
      const store = new WorkspaceStore({ now: () => now });
      expect(store.file).toBe(join(t.dir, 'hxhome', 'workspaces.json'));
      const a = mk('work', 'app');
      const info = store.open(a);
      expect(info).toMatchObject({
        name: 'app',
        path: realpathSync(a),
        lastUsedAt: '2026-11-10T00:00:00.000Z',
      });
      const file = JSON.parse(readFileSync(store.file, 'utf8'));
      expect(file).toEqual({
        version: 1,
        current: realpathSync(a),
        workspaces: [{ name: 'app', path: realpathSync(a), lastUsedAt: '2026-11-10T00:00:00.000Z' }],
      });
      // 다시 열면 시각만 갱신, 중복 없음
      now = new Date('2026-11-10T01:00:00Z');
      store.open(a + '/');
      const again = JSON.parse(readFileSync(store.file, 'utf8'));
      expect(again.workspaces).toHaveLength(1);
      expect(again.workspaces[0].lastUsedAt).toBe('2026-11-10T01:00:00.000Z');
      // 다시 읽어도 같다
      expect(new WorkspaceStore().current()?.path).toBe(realpathSync(a));
      // 거부되면 파일은 그대로
      expect(() => store.open('/etc')).toThrow(WorkspaceRejectedError);
      expect(JSON.parse(readFileSync(store.file, 'utf8'))).toEqual(again);
    } finally {
      if (prev === undefined) delete process.env.HARNESS_X_HOME;
      else process.env.HARNESS_X_HOME = prev;
    }
  });
});

describe('35.3 Git·AGENTS.md/CLAUDE.md 감지', () => {
  it('테스트 저장소에서 브랜치와 지침 파일 표시', () => {
    const repo = mk('repo');
    execFileSync('git', ['init', '-q', '-b', 'feature/login', repo]);
    writeFileSync(join(repo, 'AGENTS.md'), '# agents');
    expect(detectProject(repo)).toEqual({
      git: true,
      branch: 'feature/login',
      hasAgentsMd: true,
      hasClaudeMd: false,
    });
    // 하위 폴더도 상위 .git을 찾는다
    const sub = mk('repo', 'packages', 'a');
    writeFileSync(join(sub, 'CLAUDE.md'), '# claude');
    expect(detectProject(sub)).toMatchObject({ git: true, branch: 'feature/login', hasClaudeMd: true });
    // worktree: .git 파일 → gitdir
    const wt = mk('wt');
    const gd = mk('repo-gitdir', 'worktrees', 'wt');
    writeFileSync(join(gd, 'HEAD'), 'ref: refs/heads/wt-branch\n');
    writeFileSync(join(wt, '.git'), `gitdir: ${gd}\n`);
    expect(detectProject(wt)).toMatchObject({ git: true, branch: 'wt-branch' });
    // detached HEAD
    writeFileSync(join(gd, 'HEAD'), '0123456789abcdef0123456789abcdef01234567\n');
    expect(detectProject(wt).branch).toBe('0123456');
    // git 아님
    expect(detectProject(mk('plain'))).toEqual({ git: false, hasAgentsMd: false, hasClaudeMd: false });

    const store = new WorkspaceStore({ file: join(t.dir, 'ws.json') });
    expect(store.open(repo)).toMatchObject({
      name: 'repo',
      git: true,
      branch: 'feature/login',
      hasAgentsMd: true,
    });
  });
});

describe('35.4 새 세션 cwd', () => {
  it('열린 워크스페이스가 다음 세션의 cwd가 된다 (tool.before ctx.cwd 일치)', async () => {
    const store = new WorkspaceStore({ file: join(t.dir, 'ws.json') });
    expect(store.sessionCwd('/fallback')).toBe('/fallback');
    const a = mk('a');
    const b = mk('b');
    store.open(a);
    store.open(b);
    expect(store.sessionCwd()).toBe(realpathSync(b));

    const hooks = new HookBus();
    const seen: unknown[] = [];
    hooks.onBlocking('tool.before', (ctx) => void seen.push(ctx.cwd));
    const turns: ModelTurn[] = [
      { text: '', toolCalls: [{ id: 'c1', name: 'list_dir', arguments: { path: '.' } }] },
      { text: 'ok', toolCalls: [] },
    ];
    let i = 0;
    const client: ModelClient = { complete: async () => turns[i++]! };
    const events: HarnessEvent[] = [];
    for await (const e of runAgentLoop({
      client,
      sessionId: 's',
      cwd: store.sessionCwd(),
      prompt: 'ls',
      hooks,
    }))
      events.push(e);
    expect(seen).toEqual([realpathSync(b)]);
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', reason: 'completed' });
  });
});

describe('35.5 최근 프로젝트 (최대 10, 고정 핀)', () => {
  const e = (name: string, h: number, pinned = false): WorkspaceEntry => ({
    name,
    path: `/p/${name}`,
    lastUsedAt: new Date(Date.UTC(2026, 10, 10, h)).toISOString(),
    ...(pinned ? { pinned: true } : {}),
  });

  it('정렬: 핀 먼저(최근순) → 나머지 최근순, 최대 10, 핀은 잘리지 않음', () => {
    const list = [e('a', 1), e('b', 5), e('c', 3, true), e('d', 4), e('e', 2, true)];
    expect(sortRecent(list).map((x) => x.name)).toEqual(['c', 'e', 'b', 'd', 'a']);
    const many = Array.from({ length: 15 }, (_, k) => e(`w${k}`, k));
    many.push(e('old-pin', 0, true));
    const s = sortRecent(many);
    expect(s).toHaveLength(MAX_RECENT);
    expect(s[0]!.name).toBe('old-pin');
    expect(s.slice(1).map((x) => x.name)).toEqual([
      'w14',
      'w13',
      'w12',
      'w11',
      'w10',
      'w9',
      'w8',
      'w7',
      'w6',
    ]);
  });

  it('store: 11번째를 열면 가장 오래된 비고정이 빠지고, 핀은 유지', () => {
    let h = 0;
    const store = new WorkspaceStore({
      file: join(t.dir, 'ws.json'),
      now: () => new Date(Date.UTC(2026, 0, 1, h++)),
    });
    const dirs = Array.from({ length: 11 }, (_, k) => mk(`p${k}`));
    store.open(dirs[0]!);
    store.pin(realpathSync(dirs[0]!), true);
    store.open(dirs[1]!);
    for (const d of dirs.slice(2)) store.open(d);
    const names = store.recent().map((w) => w.name);
    expect(names).toHaveLength(10);
    expect(names[0]).toBe('p0'); // 핀 (가장 오래됐어도 유지)
    expect(names).not.toContain('p1'); // 가장 오래된 비고정
    expect(names.slice(1)).toEqual(['p10', 'p9', 'p8', 'p7', 'p6', 'p5', 'p4', 'p3', 'p2']);
    store.pin(realpathSync(dirs[0]!), false);
    expect(store.recent()[0]!.name).toBe('p10');
  });
});

describe('35.7 권한 경계: 선택 폴더 = 워크스페이스 루트', () => {
  it('루트 밖 쓰기 → ask, 루트 안 → allow, 폴더를 바꾸면 경계도 바뀜 (workspace.changed)', async () => {
    const store = new WorkspaceStore({ file: join(t.dir, 'ws.json') });
    const a = realpathSync(mk('a'));
    const b = realpathSync(mk('b'));
    const changes: WorkspaceChange[] = [];
    store.onChange((c) => changes.push(c));
    store.open(a);
    expect(store.workspaceRoot()).toBe(a);
    expect(changes).toEqual([expect.objectContaining({ type: 'workspace.changed', root: a })]);

    expect(checkWriteBoundary(a, 'src/x.ts')).toBe('allow');
    expect(checkWriteBoundary(a, join(a, 'new', 'deep.txt'))).toBe('allow');
    expect(checkWriteBoundary(a, '../b/x.ts')).toBe('ask');
    expect(checkWriteBoundary(a, '/etc/hosts')).toBe('ask');
    expect(checkWriteBoundary(undefined, 'x')).toBe('ask');

    // 최소 tool.before 검사 (permission-gate 대역)
    const hooks = new HookBus();
    hooks.onBlocking('tool.before', workspaceBoundaryHook(store), { id: 'ws-boundary' });
    const run = (tool: string, input: unknown) =>
      hooks.runBlocking('tool.before', { sessionId: 's', cwd: store.sessionCwd(), tool, input });

    const out = await run('write_file', { path: join(b, 'x.ts'), content: '' });
    expect(out.decision).toBe('block');
    expect(out.reason).toMatch(/^ask: /);
    expect((await run('Write', { file_path: join(a, 'x.ts') })).decision).toBe('allow');
    expect((await run('read_file', { path: '/etc/hosts' })).decision).toBe('allow'); // 읽기는 대상 아님

    // 폴더 변경 → b 안은 allow, a 안은 ask
    store.open(b);
    expect(changes.at(-1)).toMatchObject({ root: b, previous: a });
    expect((await run('write_file', { path: join(b, 'x.ts') })).decision).toBe('allow');
    const back = await run('write_file', { path: join(a, 'x.ts') });
    expect(back.decision).toBe('block');
    expect(back.reason).toContain(`ask: 워크스페이스 루트(${b})`);
  });
});
