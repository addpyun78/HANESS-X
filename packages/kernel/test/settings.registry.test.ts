import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import {
  defineSetting,
  deletePath,
  getPath,
  readSetting,
  setPath,
  SETTING_GROUP_IDS,
  SETTING_GROUPS,
  SettingRegistrationError,
  settingsRegistry,
  SettingsRegistry,
  SettingValueError,
  type SettingDef,
  type SettingGroupId,
  type SettingMeta,
  type SettingScope,
} from '../src/settings/registry.js';

const meta = (over: Partial<SettingMeta> = {}): SettingMeta => ({
  group: 'general',
  title: '시험 설정',
  description: '시험에 쓰는 설정이에요.',
  advanced: false,
  restartRequired: false,
  scope: 'global',
  ...over,
});

describe('T-101 0A.2 설정 레지스트리', () => {
  it('메타 타입: group·title·description·advanced·restartRequired·scope 필수, widget 선택', () => {
    expectTypeOf<SettingMeta['group']>().toEqualTypeOf<SettingGroupId>();
    expectTypeOf<SettingScope>().toEqualTypeOf<'global' | 'project' | 'both'>();
    expectTypeOf<SettingMeta>().toHaveProperty('title').toEqualTypeOf<string>();
    expectTypeOf<SettingMeta>().toHaveProperty('advanced').toEqualTypeOf<boolean>();
    expectTypeOf<SettingMeta>().toHaveProperty('restartRequired').toEqualTypeOf<boolean>();
    // @ts-expect-error scope 빠짐
    const bad: SettingMeta = {
      group: 'general',
      title: 'a',
      description: 'b',
      advanced: false,
      restartRequired: false,
    };
    void bad;
    // @ts-expect-error 없는 그룹
    defineSetting('x.y', z.string().default(''), meta({ group: 'nope' }));
    const d = defineSetting('a.b', z.number().default(1), meta());
    expectTypeOf(d).toEqualTypeOf<SettingDef<z.ZodDefault<z.ZodNumber>>>();
    expectTypeOf(d.schema).toEqualTypeOf<z.ZodDefault<z.ZodNumber>>();
  });

  it('그룹 13개를 미리 만들어 둔다', () => {
    expect(SETTING_GROUPS.map((g) => g.title)).toEqual([
      '일반',
      'AI·엔진',
      '모드·권한',
      '체크리스트',
      '판정',
      '승인·알림',
      '도구·설치',
      '첨부',
      '음성',
      '프로젝트',
      '데이터·보안',
      '플러그인',
      '정보',
    ]);
    expect(new Set(SETTING_GROUP_IDS).size).toBe(13);
  });

  it('등록·조회·기본값·검사', () => {
    const r = new SettingsRegistry([
      defineSetting('a.n', z.number().int().min(1).max(3).default(2), meta()),
      defineSetting('a.s', z.string().default('x'), meta({ scope: 'both' })),
    ]);
    expect(r.keys()).toEqual(['a.n', 'a.s']);
    expect(r.get('a.n')?.path).toEqual(['a', 'n']);
    expect(r.defaultOf('a.n')).toBe(2);
    expect(r.check('a.n', 3)).toEqual({ ok: true, value: 3 });
    expect(r.check('a.n', 9)).toEqual({ ok: false, message: '3 이하로 넣어 주세요.' });
    expect(r.check('a.n', 'x')).toEqual({ ok: false, message: '숫자를 넣어 주세요.' });
    expect(r.check('zz', 1)).toEqual({ ok: false, message: '알 수 없는 설정이에요.' });
    expect(() => r.parse('a.n', 0)).toThrow(SettingValueError);
  });

  it('중복·겹치는 경로·형식 오류는 등록 거부', () => {
    const r = new SettingsRegistry([defineSetting('a.b', z.string().default(''), meta())]);
    expect(() => r.register(defineSetting('a.b', z.string().default(''), meta()))).toThrow(
      SettingRegistrationError,
    );
    expect(() => r.register(defineSetting('a.b.c', z.string().default(''), meta()))).toThrow(/겹침/);
    expect(() => r.register(defineSetting('a', z.string().default(''), meta()))).toThrow(/겹침/);
    expect(() => r.register(defineSetting('A b', z.string().default(''), meta()))).toThrow(/형식/);
    expect(() => r.register(defineSetting('k.k', z.string(), meta({ storage: 'keychain' })))).toThrow(
      /secretAccount/,
    );
  });

  it('경로 도우미와 readSetting (project 범위 우선 규칙은 store에서)', () => {
    const o = setPath({}, ['judge', 'local', 'model'], 'm');
    expect(getPath(o, ['judge', 'local', 'model'])).toBe('m');
    expect(deletePath(o, ['judge', 'local', 'model'])).toEqual({});
    expect(readSetting({ judge: { samples: 2 } }, 'judge.samples')).toBe(2);
    expect(readSetting({ judge: { samples: 99 } }, 'judge.samples')).toBe(3);
    expect(() => readSetting({}, 'no.such')).toThrow(SettingRegistrationError);
  });

  it('기본 레지스트리: 모든 키에 쉬운 말 제목·설명과 기본값(키체인 제외)', () => {
    for (const d of settingsRegistry.list()) {
      expect(d.title.length, d.key).toBeGreaterThan(0);
      expect(d.description, d.key).toMatch(/요\.$|니다\.$/);
      if (d.storage !== 'keychain') expect(settingsRegistry.defaultOf(d.key), d.key).not.toBeUndefined();
    }
  });
});
