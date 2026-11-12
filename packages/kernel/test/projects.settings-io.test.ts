import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { projectSettingsIO } from '../src/projects/project-settings-io.js';
import { ProjectStore } from '../src/projects/project-store.js';
import { defineSetting, SettingsRegistry, SettingValueError } from '../src/settings/registry.js';
import { SettingsStore } from '../src/settings/store.js';

/**
 * T-101 6B.14 전제: 0-1 ProjectSettingsIO를 0-2 프로젝트 표식(<프로젝트>/.harness-x/project.json의 settings)으로 구현
 */

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hx-proj-settings-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const reg = new SettingsRegistry([
  defineSetting('mode.default', z.enum(['plan', 'normal', 'auto']).default('normal'), {
    group: 'mode',
    title: '기본 모드',
    description: '새 작업을 시작할 때의 모드예요.',
    advanced: false,
    restartRequired: false,
    scope: 'both',
  }),
  defineSetting('tools.budget', z.enum(['free-only', 'free-first', 'any']).default('free-first'), {
    group: 'tools',
    title: '도구 비용 기준',
    description: '무료 도구를 얼마나 앞세울지 정해요.',
    advanced: false,
    restartRequired: false,
    scope: 'global',
  }),
]);

function setup() {
  const home = join(dir, 'home');
  const root = join(dir, 'proj');
  mkdirSync(root, { recursive: true });
  const projects = new ProjectStore({ home });
  const { project } = projects.add(root);
  const io = projectSettingsIO(projects);
  const store = new SettingsStore({ file: join(home, 'settings.json'), registry: reg, project: io });
  return { home, root, projects, project, io, store };
}

describe('6B.14 프로젝트 범위 설정 저장', () => {
  it('프로젝트 값은 표식 파일 settings 칸에 저장되고 전체 값보다 먼저 쓰인다', () => {
    const { root, project, store } = setup();
    store.set('mode.default', 'auto');
    store.set('mode.default', 'plan', { scope: 'project', projectId: project.id });
    const marker = JSON.parse(readFileSync(join(root, '.harness-x', 'project.json'), 'utf8'));
    expect(marker).toMatchObject({ id: project.id, settings: { mode: { default: 'plan' } } });
    expect(store.snapshot(project.id)['mode.default']).toMatchObject({
      effective: 'plan',
      source: 'project',
      global: 'auto',
      project: 'plan',
    });
    // 다른 프로젝트(또는 프로젝트 없음)는 전체 값
    expect(store.snapshot()['mode.default']).toMatchObject({ effective: 'auto', source: 'global' });
    // 전체 범위 키는 프로젝트에 저장할 수 없음
    expect(() => store.set('tools.budget', 'any', { scope: 'project', projectId: project.id })).toThrow(
      '이 설정은 전체에만 적용돼요.',
    );
    // 되돌리기 → settings 칸이 사라지고 표식은 그대로
    store.reset({ key: 'mode.default' }, { scope: 'project', projectId: project.id });
    const after = JSON.parse(readFileSync(join(root, '.harness-x', 'project.json'), 'utf8'));
    expect(after.settings).toBeUndefined();
    expect(after.id).toBe(project.id);
  });

  it('이름을 바꾸거나 폴더를 옮겨 다시 연결해도 값이 따라간다', () => {
    const { root, projects, project, store } = setup();
    store.set('mode.default', 'plan', { scope: 'project', projectId: project.id });
    projects.rename(project.id, '새 이름');
    expect(store.snapshot(project.id)['mode.default']!.effective).toBe('plan');
    const moved = join(dir, 'moved');
    renameSync(root, moved);
    projects.relink(project.id, moved);
    expect(store.snapshot(project.id)['mode.default']!.effective).toBe('plan');
  });

  it('폴더를 찾을 수 없으면 쉬운 말로 거부, 없는 프로젝트는 빈 값', () => {
    const { root, projects, project, io } = setup();
    rmSync(root, { recursive: true, force: true });
    projects.list(); // missing 갱신
    expect(() => io.write(project.id, { mode: { default: 'plan' } })).toThrow(SettingValueError);
    expect(() => io.write(project.id, { mode: { default: 'plan' } })).toThrow(/다시 연결/);
    expect(io.read('no-such-id')).toEqual({});
  });
});

describe('6B.10 임시 작업 공간 위치 (project.scratchDir)', () => {
  it('설정이 비면 <home>/scratch, 정하면 그 폴더 아래에 만든다 (매번 다시 읽음)', () => {
    const home = join(dir, 'home2');
    let where = '';
    const projects = new ProjectStore({ home, scratchRoot: () => where });
    expect(projects.createScratch().rootPath.startsWith(join(home, 'scratch'))).toBe(true);
    where = join(dir, 'my-scratch');
    expect(projects.createScratch().rootPath.startsWith(where)).toBe(true);
  });
});
