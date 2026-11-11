import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { Dispatcher } from '../src/dispatch.js';
import { EventLog, type LogRecord } from '../src/event-log.js';
import { resolveSessionDefaults } from '../src/projects/defaults.js';
import { ProjectStore } from '../src/projects/project-store.js';
import { SessionRecordSchema } from '../src/projects/schema.js';
import { SessionError, SessionRegistry, titleFromMessage } from '../src/projects/session-registry.js';
import { reindexCli } from '../src/projects/cli-commands.js';
import { tempDir } from './helpers.js';

const temps: { cleanup(): void }[] = [];
afterEach(() => temps.splice(0).forEach((t) => t.cleanup()));

function env(global: () => Record<string, string> = () => ({ engine: 'claude-code' })) {
  const t = tempDir('hx-sess-');
  temps.push(t);
  const home = join(t.dir, 'home');
  const dir = (name: string) => {
    const d = join(t.dir, name);
    mkdirSync(d, { recursive: true });
    return d;
  };
  const events: LogRecord[] = [];
  const projects = new ProjectStore({ home });
  const reg = (o: { log?: boolean } = {}) =>
    new SessionRegistry({
      home,
      projects,
      defaults: global,
      ...(o.log === false ? {} : { log: { append: (r: LogRecord) => events.push(r) } }),
    });
  return { root: t.dir, home, dir, projects, reg, events };
}

describe('0B.11 초안 세션 기본값', () => {
  it('createSession(draft) → 스키마에 맞는 초안: cwd=프로젝트 루트, 엔진=현재 기본 엔진, 권한=기본 권한', () => {
    const e = env();
    const p = e.projects.add(e.dir('app')).project;
    const s = e.reg().createSession({ origin: 'ui', draft: true, projectId: p.id });
    expect(SessionRecordSchema.parse(s)).toBeTruthy();
    expect(s).toMatchObject({
      draft: true,
      projectId: p.id,
      cwd: p.rootPath,
      engine: 'claude-code',
      permission: 'workspace-write',
      messageCount: 0,
      status: 'idle',
    });
    expect(s.mode).toBeUndefined(); // 3번(모드) 전에는 기본 모드가 없다
  });
  it('프로젝트를 안 주면 지금 고른 프로젝트, 아무 프로젝트도 없으면 no_project', () => {
    const e = env();
    expect(() => e.reg().createSession({ origin: 'ui', draft: true })).toThrow(SessionError);
    const p = e.projects.add(e.dir('cur')).project;
    expect(e.reg().createSession({ origin: 'ui', draft: true }).projectId).toBe(p.id);
  });
});

describe('0B.40 프로젝트 기본값', () => {
  it('적용 순서: 프로젝트 기본값 → 전체 기본값 (비운 칸은 전체 설정)', () => {
    const e = env(() => ({ engine: 'claude-code', mode: 'normal', permission: 'read-only' }));
    const withD = e.projects.add(e.dir('with')).project;
    const without = e.projects.add(e.dir('without')).project;
    e.projects.setDefaults(withD.id, { engine: 'codex', model: 'gpt-5', agent: '/review', mode: '' });
    const r = e.reg();
    const a = r.createSession({ origin: 'ui', draft: true, projectId: withD.id });
    const b = r.createSession({ origin: 'ui', draft: true, projectId: without.id });
    expect(a).toMatchObject({
      engine: 'codex',
      model: 'gpt-5',
      agent: '/review',
      mode: 'normal',
      permission: 'read-only',
    });
    expect(b).toMatchObject({ engine: 'claude-code', mode: 'normal', permission: 'read-only' });
    expect(b.model).toBeUndefined();
    expect(b.agent).toBeUndefined();
    expect(e.projects.get(withD.id)?.defaults).toEqual({ engine: 'codex', model: 'gpt-5', agent: '/review' });
    expect(resolveSessionDefaults(e.projects.get(withD.id), { engine: 'x' }).from).toMatchObject({
      engine: 'project',
    });
    // 전부 비우면 defaults 자체를 지운다
    e.projects.setDefaults(withD.id, {});
    expect(e.projects.get(withD.id)?.defaults).toBeUndefined();
  });
});

describe('0B.12 초안 규칙', () => {
  it('경로 1: 첫 메시지 → 저장·등록(session_registered 이벤트), 제목 = 앞 30자', () => {
    const e = env();
    const p = e.projects.add(e.dir('a')).project;
    const r = e.reg();
    const d = r.createSession({ origin: 'ui', draft: true, projectId: p.id });
    expect(r.list()).toHaveLength(0);
    expect(e.events).toHaveLength(0);
    const msg = '로그인 화면의 비밀번호 칸이 가려지지 않는 문제를 고쳐 주세요 그리고 테스트도';
    const s = r.commitDraft(d.id, msg);
    expect(s).toMatchObject({ draft: false, messageCount: 1, title: titleFromMessage(msg) });
    expect([...s.title].length).toBe(31); // 30자 + …
    expect(r.list().map((x) => x.id)).toEqual([d.id]);
    expect(e.events.map((x) => x.type)).toEqual(['session_registered']);
    expect(readdirSync(join(e.home, 'sessions'))).toContain(d.id);
  });
  it('경로 2: 아무것도 안 보내고 떠나면 초안은 지워진다 (빈 세션이 쌓이지 않음)', () => {
    const e = env();
    const p = e.projects.add(e.dir('b')).project;
    const r = e.reg();
    for (let i = 0; i < 5; i++) {
      const d = r.createSession({ origin: 'ui', draft: true, projectId: p.id });
      expect(r.leave(d.id)).toBe(true);
      expect(r.get(d.id)).toBeUndefined();
    }
    expect(r.list({ drafts: true })).toHaveLength(0);
    expect(e.events).toHaveLength(0);
    expect(e.reg().list()).toHaveLength(0);
  });
});

describe('0B.13 첫 메시지 뒤 프로젝트 고정', () => {
  it('초안이면 프로젝트 변경(cwd도), 대화가 있으면 "그 폴더에서 새 세션을 열게요" + 새 초안', () => {
    const e = env();
    const a = e.projects.add(e.dir('pa')).project;
    const b = e.projects.add(e.dir('pb')).project;
    const r = e.reg();
    const d = r.createSession({ origin: 'ui', draft: true, projectId: a.id });
    const moved = r.changeProject(d.id, b.id);
    expect(moved).toMatchObject({ replaced: false, session: { id: d.id, projectId: b.id, cwd: b.rootPath } });
    r.commitDraft(d.id, '안녕');
    const again = r.changeProject(d.id, a.id);
    expect(again.replaced).toBe(true);
    expect(again.message).toBe('그 폴더에서 새 세션을 열게요');
    expect(again.session).toMatchObject({ draft: true, projectId: a.id });
    expect(again.session.id).not.toBe(d.id);
    expect(r.get(d.id)?.projectId).toBe(b.id); // 원래 세션은 그대로
  });
});

describe('0B.19 세션 제목', () => {
  it('첫 메시지 앞 30자 → AI 제안(쉬운 말 통과 시 적용) → 사용자가 바꾸면 고정', () => {
    const e = env();
    const p = e.projects.add(e.dir('t')).project;
    const r = e.reg();
    const d = r.createSession({ origin: 'ui', draft: true, projectId: p.id });
    r.commitDraft(d.id, '짧은 요청');
    expect(r.get(d.id)?.title).toBe('짧은 요청');
    expect(r.suggestTitle(d.id, '`rm -rf` {json}').applied).toBe(false);
    expect(r.suggestTitle(d.id, '로그인 화면 고치기')).toMatchObject({
      applied: true,
      session: { title: '로그인 화면 고치기' },
    });
    r.rename(d.id, '내가 정한 제목');
    expect(r.suggestTitle(d.id, '다른 제안').applied).toBe(false);
    expect(e.reg().get(d.id)).toMatchObject({ title: '내가 정한 제목', titleLocked: true });
  });
  it('쉬운 말 검사기를 주입할 수 있다', () => {
    const e = env();
    const p = e.projects.add(e.dir('t2')).project;
    const r = new SessionRegistry({
      home: e.home,
      projects: e.projects,
      titleCheck: (t) => t.endsWith('기'),
    });
    const s = r.createSession({ origin: 'ui', projectId: p.id, firstMessage: '첫 말' });
    expect(r.suggestTitle(s.id, '고치는 중').applied).toBe(false);
    expect(r.suggestTitle(s.id, '고치기').applied).toBe(true);
  });
});

describe('0B.20 병렬 세션', () => {
  it('실행 중인 세션이 있어도 새 세션을 만들고 둘 다 끝까지 진행된다', async () => {
    const e = env();
    const p = e.projects.add(e.dir('par')).project;
    const r = e.reg();
    const releases: (() => void)[] = [];
    const d = new Dispatcher({
      sessions: r,
      resolve: (n) => ({
        name: n.replace(/^\//, ''),
        command: `/${n.replace(/^\//, '')}`,
        displayName: n,
        pipeline: { name: 'p', nodes: [{ id: 'a', type: 'role', role: 'x' }], edges: [] } as never,
      }),
      run: () => new Promise((res) => releases.push(() => res({ status: 'completed' }))),
    });
    const s1 = d.dispatch({ agent: '/one', prompt: '첫 번째', projectId: p.id });
    expect(r.get(s1.sessionId)?.status).toBe('running');
    const draft = r.createSession({ origin: 'ui', draft: true, projectId: p.id });
    const s2 = d.dispatch({ agent: '/two', prompt: '두 번째', projectId: p.id });
    expect(d.sessions().filter((s) => s.status === 'running')).toHaveLength(2);
    expect(draft.draft).toBe(true);
    releases.forEach((f) => f());
    await Promise.all([d.wait(s1.sessionId), d.wait(s2.sessionId)]);
    expect(r.get(s1.sessionId)?.status).toBe('done');
    expect(r.get(s2.sessionId)?.status).toBe('done');
  });
});

describe('0B.39 projectId는 만들 때 직접 저장', () => {
  it('프로젝트 안 하위 폴더·작업 트리에서 시작해도 같은 프로젝트 묶음', () => {
    const e = env();
    const repo = e.dir('main-repo');
    mkdirSync(join(repo, '.git', 'worktrees', 'wt1'), { recursive: true });
    writeFileSync(join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    writeFileSync(join(repo, '.git', 'worktrees', 'wt1', 'commondir'), '../..\n');
    writeFileSync(join(repo, '.git', 'worktrees', 'wt1', 'HEAD'), 'ref: refs/heads/wt1\n');
    const wt = e.dir('elsewhere/wt1'); // 작업 트리는 저장소 밖에 있다
    writeFileSync(join(wt, '.git'), `gitdir: ${join(repo, '.git', 'worktrees', 'wt1')}\n`);
    const p = e.projects.add(repo).project;
    const r = e.reg();
    const sub = r.createSession({ origin: 'cli', cwd: e.dir('main-repo/src/deep') });
    const tree = r.createSession({ origin: 'cli', cwd: wt });
    expect(sub.projectId).toBe(p.id);
    expect(tree.projectId).toBe(p.id);
    expect(tree.cwd).toBe(wt);
    // 저장된 값 그대로 묶는다: 프로젝트 폴더를 옮겨도(경로가 달라져도) 묶음은 그대로
    e.projects.relink(p.id, e.dir('elsewhere/other'), { force: true });
    expect(
      e
        .reg()
        .list({ projectId: p.id })
        .map((s) => s.id)
        .sort(),
    ).toEqual([sub.id, tree.id].sort());
  });
});

describe('0B.5 옛 세션에 projectId 채우기', () => {
  it('이벤트 로그에만 있던 세션 전부가 프로젝트 또는 "프로젝트 없음"에 속한다', () => {
    const e = env();
    const app = e.projects.add(e.dir('legacy-app')).project;
    const log = new EventLog({ root: join(e.home, 'logs') });
    const ev = (sessionId: string, type: string, extra: Record<string, unknown> = {}) =>
      log.append({ id: `${sessionId}-${type}`, ts: '2026-11-01T00:00:00.000Z', sessionId, type, ...extra });
    // Windows 표기·대소문자 다른 cwd도 같은 폴더 (경로 비교기)
    ev('old-1', 'session_created', { prompt: '옛 작업 하나', cwd: join(app.rootPath, 'src') });
    ev('old-2', 'session_created', { prompt: '어디서 했는지 모름' });
    ev('old-2', 'session_end', { status: 'completed' });
    ev('old-3', 'session_created', { prompt: '지워진 폴더', cwd: '/mnt/z/gone' });
    const r = e.reg({ log: false });
    expect(r.importLegacy(log)).toBe(3);
    const all = r.list();
    expect(all).toHaveLength(log.sessions().length);
    expect(all.every((s) => s.projectId === app.id || s.projectId === null)).toBe(true);
    expect(r.get('old-1')?.projectId).toBe(app.id);
    expect(r.get('old-2')).toMatchObject({ projectId: null, status: 'done', origin: 'import' });
    expect(r.get('old-3')?.projectId).toBeNull();
    expect(r.importLegacy(log)).toBe(0); // 두 번째는 없음
    log.close();
  });
});

describe('0B.9 색인 재구성', () => {
  it('색인 파일 삭제 후 재시작 → 세션 전부 복원, 수동 harness-x reindex', () => {
    const e = env();
    const p = e.projects.add(e.dir('ix')).project;
    const r = e.reg();
    const ids = [1, 2, 3].map((i) => r.createSession({ origin: 'api', projectId: p.id, title: `s${i}` }).id);
    expect(e.reg().reindexed).toBe(false);
    rmSync(join(e.home, 'sessions', 'index.json'));
    const back = e.reg();
    expect(back.reindexed).toBe(true);
    expect(
      back
        .list()
        .map((s) => s.id)
        .sort(),
    ).toEqual([...ids].sort());
    // 색인과 폴더 불일치(폴더 하나를 손으로 지움) → 다시 읽어 복구
    rmSync(join(e.home, 'sessions', ids[0]!), { recursive: true });
    const fixed = e.reg();
    expect(fixed.reindexed).toBe(true);
    expect(fixed.list()).toHaveLength(2);
    // 수동 명령
    const out: string[] = [];
    expect(reindexCli({ home: e.home, io: { out: (s) => out.push(s), err: () => {} } })).toBe(0);
    expect(out.join('')).toContain('세션 2개');
    const idx = JSON.parse(readFileSync(join(e.home, 'sessions', 'index.json'), 'utf8')) as {
      sessions: unknown[];
    };
    expect(idx.sessions).toHaveLength(2);
  });
});

describe('0B.37 세션 등록 단일화', () => {
  it('세션을 직접 만드는 코드가 createSession() 밖에 없다 (grep 0건)', () => {
    const src = fileURLToPath(new URL('../src', import.meta.url));
    const files: string[] = [];
    const walk = (d: string) => {
      for (const x of readdirSync(d, { withFileTypes: true })) {
        if (x.isDirectory()) walk(join(d, x.name));
        else if (x.name.endsWith('.ts')) files.push(join(d, x.name));
      }
    };
    walk(src);
    const bad: string[] = [];
    for (const f of files) {
      const rel = relative(src, f).replace(/\\/g, '/');
      if (rel === 'projects/session-registry.ts') continue;
      const text = readFileSync(f, 'utf8');
      // 세션 id를 직접 짓거나, 세션 레코드·session.json을 직접 만들면 안 된다
      if (
        /sessionId\s*=\s*`/.test(text) ||
        /SessionRecordSchema\.parse\(/.test(text) ||
        /session\.json/.test(text)
      )
        bad.push(rel);
    }
    expect(bad).toEqual([]);
  });
  it('/ 실행(디스패처)도 createSession()으로 등록 → session_registered 이벤트', () => {
    const e = env();
    const p = e.projects.add(e.dir('one')).project;
    const r = e.reg();
    const d = new Dispatcher({
      sessions: r,
      resolve: () => ({
        name: 'x',
        command: '/x',
        displayName: 'X',
        icon: '🧪',
        pipeline: { name: 'p', nodes: [], edges: [] } as never,
      }),
      run: async () => ({ status: 'completed' }),
    });
    const s = d.dispatch({ agent: '/x', prompt: '해 줘', origin: 'cli' });
    expect(r.get(s.sessionId)).toMatchObject({
      origin: 'cli',
      projectId: p.id,
      agent: 'x',
      agentIcon: '🧪',
      title: '해 줘',
    });
    expect(e.events.find((x) => x.type === 'session_registered')?.sessionId).toBe(s.sessionId);
  });
});
