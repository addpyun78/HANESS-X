import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  defineSetting,
  SettingsRegistry,
  SettingValueError,
  type SettingMeta,
} from '../src/settings/registry.js';
import {
  RESTART_NOTICE,
  SettingsStore,
  type ProjectSettingsIO,
  type SettingsChange,
} from '../src/settings/store.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hx-settings-store-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const meta = (over: Partial<SettingMeta> = {}): SettingMeta => ({
  group: 'general',
  title: '시험',
  description: '시험 설정이에요.',
  advanced: false,
  restartRequired: false,
  scope: 'global',
  ...over,
});

const reg = () =>
  new SettingsRegistry([
    defineSetting(
      'judge.samples',
      z.number().int().min(1).max(3).default(3),
      meta({ group: 'judge', restartRequired: true }),
    ),
    defineSetting('judge.semantic', z.enum(['on', 'off']).default('on'), meta({ group: 'judge' })),
    defineSetting(
      'mode.default',
      z.enum(['plan', 'normal', 'auto']).default('normal'),
      meta({ group: 'mode', scope: 'both' }),
    ),
    defineSetting('project.only', z.string().default(''), meta({ group: 'project', scope: 'project' })),
    defineSetting(
      'tools.key',
      z.string().min(1),
      meta({ group: 'tools', storage: 'keychain', secretAccount: 'k', widget: 'secret' }),
    ),
  ]);

function memProjects(): ProjectSettingsIO & { data: Record<string, Record<string, unknown>> } {
  const data: Record<string, Record<string, unknown>> = {};
  return {
    data,
    read: (id) => structuredClone(data[id] ?? {}),
    write: (id, v) => void (data[id] = structuredClone(v)),
  };
}

describe('T-101 0A.7 저장 즉시 적용 + 잘못된 값 거부', () => {
  it('저장 → 파일 기록 + 구독자에게 바로 알림, restartRequired면 안내', () => {
    const file = join(dir, 'settings.json');
    const s = new SettingsStore({ file, registry: reg() });
    const seen: SettingsChange[][] = [];
    s.subscribe((c) => seen.push(c));
    const r = s.set('judge.samples', 2);
    expect(r).toMatchObject({
      ok: true,
      restartRequired: true,
      notice: RESTART_NOTICE,
      state: { effective: 2, source: 'global' },
    });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ judge: { samples: 2 } });
    expect(seen).toEqual([[{ key: 'judge.samples', scope: 'global', value: 2 }]]);
    const r2 = s.set('judge.semantic', 'off');
    expect(r2.notice).toBeUndefined();
    expect(s.effective()).toMatchObject({ 'judge.samples': 2, 'judge.semantic': 'off' });
  });

  it('잘못된 값 저장 거부: 쉬운 말 오류, 파일은 그대로', () => {
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({ judge: { samples: 1 }, other: 'keep' }));
    const s = new SettingsStore({ file, registry: reg() });
    const cases: [string, unknown, string][] = [
      ['judge.samples', 9, '3 이하로 넣어 주세요.'],
      ['judge.samples', 0, '1 이상으로 넣어 주세요.'],
      ['judge.samples', 'abc', '숫자를 넣어 주세요.'],
      ['judge.semantic', 'maybe', '보기에 있는 값 중에서 골라 주세요.'],
      ['nope.key', 1, '알 수 없는 설정이에요.'],
      ['tools.key', 'x', '키는 키 입력 칸에서 저장해 주세요.'],
      ['project.only', 'x', '이 설정은 프로젝트마다 따로 정해요.'],
    ];
    for (const [k, v, msg] of cases) {
      let err: unknown;
      try {
        s.set(k, v);
      } catch (e) {
        err = e;
      }
      expect(err, k).toBeInstanceOf(SettingValueError);
      expect((err as Error).message, k).toBe(msg);
    }
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ judge: { samples: 1 }, other: 'keep' });
  });

  it('파일에 이미 잘못된 값이 있으면 기본값을 쓰고 이유를 알려 준다', () => {
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({ judge: { samples: 99 } }));
    const st = new SettingsStore({ file, registry: reg() }).snapshot()['judge.samples']!;
    expect(st).toMatchObject({
      effective: 3,
      source: 'default',
      global: 99,
      invalid: '3 이하로 넣어 주세요.',
    });
  });

  it('project 범위: 프로젝트 값이 전체 값보다 우선, global 전용 키는 프로젝트에 저장 거부', () => {
    const projects = memProjects();
    const s = new SettingsStore({ file: join(dir, 'settings.json'), registry: reg(), project: projects });
    s.set('mode.default', 'plan');
    expect(s.snapshot('p1')['mode.default']).toMatchObject({ effective: 'plan', source: 'global' });
    s.set('mode.default', 'auto', { scope: 'project', projectId: 'p1' });
    expect(projects.data.p1).toEqual({ mode: { default: 'auto' } });
    expect(s.snapshot('p1')['mode.default']).toMatchObject({
      effective: 'auto',
      source: 'project',
      global: 'plan',
    });
    expect(s.snapshot('p2')['mode.default']!.effective).toBe('plan');
    expect(() => s.set('judge.samples', 2, { scope: 'project', projectId: 'p1' })).toThrow(
      '이 설정은 전체에만 적용돼요.',
    );
    expect(() => s.set('mode.default', 'auto', { scope: 'project' })).toThrow('프로젝트를 먼저 골라 주세요.');
    s.set('project.only', 'x', { scope: 'project', projectId: 'p1' });
    expect(s.snapshot('p1')['project.only']!.effective).toBe('x');
  });

  it('키 입력기: 키체인에만 저장, 상태는 가린 값', () => {
    const kc = new Map<string, string>();
    const secrets = {
      get: (a: string) => kc.get(a) ?? null,
      set: (a: string, v: string) => void kc.set(a, v),
      delete: (a: string) => kc.delete(a),
    };
    const file = join(dir, 'settings.json');
    const s = new SettingsStore({ file, registry: reg(), secrets });
    expect(s.setSecret('tools.key', ' sk-1234567890abcd ')).toEqual({ masked: '••••abcd' });
    expect(kc.get('k')).toBe('sk-1234567890abcd');
    expect(s.snapshot()['tools.key']).toMatchObject({ masked: '••••abcd', effective: null });
    expect(() => s.setSecret('tools.key', '  ')).toThrow('키를 넣어 주세요.');
    expect(s.deleteSecret('tools.key')).toBe(true);
    expect(s.snapshot()['tools.key']!.masked).toBeNull();
    expect(() => readFileSync(file)).toThrow(); // 설정 파일에는 아무것도 쓰지 않았다
  });
});

describe('T-101 0A.8 되돌리기 3단계: 항목 · 섹션 · 전체', () => {
  const seed = (file: string) =>
    writeFileSync(
      file,
      JSON.stringify({
        judge: { samples: 1, semantic: 'off' },
        mode: { default: 'auto' },
        legacy: { keep: true },
      }),
    );

  it('항목 하나', () => {
    const file = join(dir, 'settings.json');
    seed(file);
    const s = new SettingsStore({ file, registry: reg() });
    expect(s.reset({ key: 'judge.samples' })).toEqual(['judge.samples']);
    expect(s.effective()).toMatchObject({
      'judge.samples': 3,
      'judge.semantic': 'off',
      'mode.default': 'auto',
    });
  });

  it('섹션(그룹)', () => {
    const file = join(dir, 'settings.json');
    seed(file);
    const s = new SettingsStore({ file, registry: reg() });
    expect(s.reset({ group: 'judge' }).sort()).toEqual(['judge.samples', 'judge.semantic']);
    expect(s.effective()).toMatchObject({
      'judge.samples': 3,
      'judge.semantic': 'on',
      'mode.default': 'auto',
    });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      mode: { default: 'auto' },
      legacy: { keep: true },
    });
  });

  it('전체 (등록되지 않은 값은 건드리지 않음) + 프로젝트 범위 되돌리기', () => {
    const file = join(dir, 'settings.json');
    seed(file);
    const projects = memProjects();
    projects.data.p1 = { mode: { default: 'plan' } };
    const s = new SettingsStore({ file, registry: reg(), project: projects });
    const seen: SettingsChange[][] = [];
    s.subscribe((c) => seen.push(c));
    expect(s.reset({ all: true }).sort()).toEqual(['judge.samples', 'judge.semantic', 'mode.default']);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ legacy: { keep: true } });
    expect(seen[0]).toHaveLength(3);
    expect(s.snapshot('p1')['mode.default']!.effective).toBe('plan');
    expect(s.reset({ all: true }, { scope: 'project', projectId: 'p1' })).toEqual(['mode.default']);
    expect(projects.data.p1).toEqual({});
    expect(s.effective('p1')).toMatchObject({
      'judge.samples': 3,
      'judge.semantic': 'on',
      'mode.default': 'normal',
    });
  });
});
