import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectSchema, ProjectsFileSchema } from '../src/projects/schema.js';
import {
  PROJECT_MARKER_GITIGNORE,
  ProjectError,
  ProjectStore,
  readProjectMarker,
} from '../src/projects/project-store.js';
import { WorkspaceStore } from '../src/workspaces.js';
import { tempDir } from './helpers.js';

const temps: { cleanup(): void }[] = [];
afterEach(() => temps.splice(0).forEach((t) => t.cleanup()));

function env() {
  const t = tempDir('hx-proj-');
  temps.push(t);
  const home = join(t.dir, 'home');
  const dir = (name: string) => {
    const d = join(t.dir, name);
    mkdirSync(d, { recursive: true });
    return d;
  };
  return { root: t.dir, home, dir, store: () => new ProjectStore({ home }) };
}

describe('0B.2 Project 스키마', () => {
  const ok = {
    id: '6f1c2a51-6e8a-4c1d-9a7e-4f6b0e7d2c11',
    name: 'imjang-note',
    rootPath: '/mnt/c/work/imjang-note',
    gitRoot: '/mnt/c/work/imjang-note',
    branch: 'main',
    createdAt: '2026-11-12T00:00:00.000Z',
    lastOpenedAt: '2026-11-12T00:00:00.000Z',
    pinned: false,
    order: 0,
    missing: false,
  };
  it('필수 칸이 모두 있으면 통과, 선택 칸(gitRoot·branch)은 없어도 통과', () => {
    expect(ProjectSchema.parse(ok)).toEqual(ok);
    const { gitRoot: _g, branch: _b, ...min } = ok;
    expect(ProjectSchema.safeParse(min).success).toBe(true);
  });
  it('id는 UUID, 순서는 0 이상 정수, 시각은 ISO, pinned·missing은 참/거짓', () => {
    expect(ProjectSchema.safeParse({ ...ok, id: 'abc' }).success).toBe(false);
    expect(ProjectSchema.safeParse({ ...ok, order: -1 }).success).toBe(false);
    expect(ProjectSchema.safeParse({ ...ok, order: 1.5 }).success).toBe(false);
    expect(ProjectSchema.safeParse({ ...ok, createdAt: '어제' }).success).toBe(false);
    expect(ProjectSchema.safeParse({ ...ok, pinned: 'yes' }).success).toBe(false);
    const { missing: _m, ...noMissing } = ok;
    expect(ProjectSchema.safeParse(noMissing).success).toBe(false);
    expect(ProjectSchema.safeParse({ ...ok, name: '' }).success).toBe(false);
  });
  it('projects.json 파일 모양', () => {
    expect(ProjectsFileSchema.safeParse({ version: 1, projects: [ok] }).success).toBe(true);
    expect(ProjectsFileSchema.safeParse({ version: 2, projects: [] }).success).toBe(false);
  });
});

describe('0B.3 저장: projects.json + 폴더 안 표식', () => {
  it('등록하면 projects.json과 .harness-x/project.json(같은 id)이 생기고, 다시 읽어도 같다', () => {
    const e = env();
    const d = e.dir('app');
    const s = e.store();
    const { project } = s.add(d);
    expect(ProjectSchema.parse(project)).toBeTruthy();
    const file = JSON.parse(readFileSync(join(e.home, 'projects.json'), 'utf8')) as {
      projects: { id: string }[];
      current: string;
    };
    expect(file.projects.map((p) => p.id)).toEqual([project.id]);
    expect(file.current).toBe(project.id);
    expect(readProjectMarker(d)?.id).toBe(project.id);
    // 표식은 Git에 올려도 되는 파일: 무시 목록은 첨부 폴더만
    expect(readFileSync(join(d, '.harness-x', '.gitignore'), 'utf8')).toBe(PROJECT_MARKER_GITIGNORE);
    expect(PROJECT_MARKER_GITIGNORE.trim()).toBe('attachments/');
    const again = e.store();
    expect(again.get(project.id)).toEqual(project);
    expect(again.current()?.id).toBe(project.id);
  });
});

describe('0B.4 workspaces.json → projects.json', () => {
  it('기존 워크스페이스 수 = 프로젝트 수, 원본은 workspaces.json.bak, 고정·현재 유지', () => {
    const e = env();
    const a = e.dir('a');
    const b = e.dir('b');
    const c = e.dir('c');
    const ws = new WorkspaceStore({ file: join(e.home, 'workspaces.json') });
    ws.open(a);
    ws.open(b);
    ws.open(c);
    ws.pin(a, true);
    const before = JSON.parse(readFileSync(join(e.home, 'workspaces.json'), 'utf8')) as {
      workspaces: unknown[];
    };
    const s = e.store();
    expect(s.migrated).toBe(3);
    expect(s.list()).toHaveLength(before.workspaces.length);
    expect(existsSync(join(e.home, 'workspaces.json.bak'))).toBe(true);
    expect(readFileSync(join(e.home, 'workspaces.json.bak'), 'utf8')).toBe(
      readFileSync(join(e.home, 'workspaces.json'), 'utf8'),
    );
    expect(s.findByPath(a)?.pinned).toBe(true);
    expect(s.current()?.rootPath).toBe(c);
    // 두 번째 기동에서는 다시 옮기지 않는다
    expect(e.store().migrated).toBeUndefined();
    expect(e.store().list()).toHaveLength(3);
  });
});

describe('0B.6 루트 추천', () => {
  it('Git 저장소 안쪽 폴더를 고르면 맨 위 폴더를 권한다', () => {
    const e = env();
    const repo = e.dir('repo');
    mkdirSync(join(repo, '.git'));
    writeFileSync(join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    const sub = e.dir('repo/src/feature');
    const s = e.store();
    const r = s.suggestRoot(sub);
    expect(r).toMatchObject({ suggest: true, gitRoot: repo, path: sub });
    expect(r.message).toBe(`저장소 맨 위 폴더(${repo})로 할까요?`);
    expect(s.suggestRoot(repo).suggest).toBe(false);
    expect(s.suggestRoot(e.dir('plain')).suggest).toBe(false);
    const { project } = s.add(repo);
    expect(project).toMatchObject({ gitRoot: repo, branch: 'main' });
  });
});

describe('0B.7 중복 등록', () => {
  it('같은 폴더(끝 / · 대소문자 다른 /mnt/c 표기 포함)를 두 번 등록하면 기존 프로젝트를 연다', () => {
    const e = env();
    const d = e.dir('dup');
    const s = e.store();
    const first = s.add(d);
    expect(first.existed).toBe(false);
    const second = s.add(d + '/');
    expect(second).toMatchObject({ existed: true, project: { id: first.project.id } });
    expect(s.list()).toHaveLength(1);
  });
});

describe('0B.8 폴더 이름 변경 → missing → 표식으로 다시 연결', () => {
  it('경로가 없으면 missing, 새 폴더 표식 id가 같으면 기록 그대로 연결, 다른 프로젝트 폴더는 거부', () => {
    const e = env();
    const d = e.dir('before');
    const other = e.dir('other');
    const s = e.store();
    const { project } = s.add(d);
    const o = s.add(other).project;
    renameSync(d, join(e.root, 'after'));
    const missing = s.list().find((p) => p.id === project.id)!;
    expect(missing.missing).toBe(true);
    expect(() => s.relink(project.id, other)).toThrow(ProjectError);
    const fixed = s.relink(project.id, join(e.root, 'after'));
    expect(fixed).toMatchObject({ id: project.id, missing: false, rootPath: join(e.root, 'after') });
    expect(fixed.createdAt).toBe(project.createdAt);
    expect(s.get(o.id)?.rootPath).toBe(other);
    // 표식이 없는 폴더는 확인(force) 후에만
    const bare = e.dir('bare');
    expect(() => s.relink(project.id, bare)).toThrow(/표시가 없어요/);
    expect(s.relink(project.id, bare, { force: true }).rootPath).toBe(bare);
  });
  it('옮긴 폴더를 [폴더 열기]로 골라도 표식 id로 같은 프로젝트를 다시 연결한다', () => {
    const e = env();
    const d = e.dir('moved-from');
    const s = e.store();
    const { project } = s.add(d);
    renameSync(d, join(e.root, 'moved-to'));
    const r = s.add(join(e.root, 'moved-to'));
    expect(r).toMatchObject({ existed: true, project: { id: project.id, missing: false } });
    expect(s.list()).toHaveLength(1);
  });
});

describe('0B.38 이름 바꾸기', () => {
  it('이름 3개 변경 → 재시작 → 옛 이름 0건, id·rootPath 그대로', () => {
    const e = env();
    const s = e.store();
    const ps = ['x1', 'x2', 'x3'].map((n) => s.add(e.dir(n)).project);
    ps.forEach((p, i) => s.rename(p.id, `새 이름 ${i}`));
    const again = e.store();
    const raw = readFileSync(join(e.home, 'projects.json'), 'utf8');
    for (const [i, p] of ps.entries()) {
      expect(again.get(p.id)).toMatchObject({ id: p.id, rootPath: p.rootPath, name: `새 이름 ${i}` });
      expect(raw).not.toContain(`"name": "${p.name}"`);
    }
  });
});
