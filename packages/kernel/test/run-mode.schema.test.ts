import { DEFAULT_RUN_MODE, RUN_MODES, RunModeSchema, toRunMode } from '@harness-x/protocol';
import { describe, expect, it } from 'vitest';
import { resolveSessionDefaults } from '../src/projects/defaults.js';
import { SessionRecordSchema } from '../src/projects/schema.js';
import { readSetting, settingsRegistry } from '../src/settings/registry.js';

// T-101 3A.2 RunMode = plan | normal | auto, 세션 속성 + 설정 기본값 mode.default (scope both)

const session = {
  id: 's1',
  projectId: null,
  title: '',
  titleLocked: false,
  status: 'idle',
  cwd: '/w',
  origin: 'ui',
  draft: false,
  messageCount: 0,
  archived: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lastActivityAt: '2026-01-01T00:00:00.000Z',
};

describe('3A.2 RunMode 스키마', () => {
  it('모드는 세 가지, 기본은 일반', () => {
    expect(RUN_MODES).toEqual(['plan', 'normal', 'auto']);
    expect(DEFAULT_RUN_MODE).toBe('normal');
    expect(RunModeSchema.safeParse('auto').success).toBe(true);
    expect(RunModeSchema.safeParse('yolo').success).toBe(false);
    expect(toRunMode('plan')).toBe('plan');
    expect(toRunMode(3)).toBeUndefined();
  });

  it('설정 레지스트리에 mode.default = normal, 범위 both로 등록', () => {
    const d = settingsRegistry.get('mode.default');
    expect(d).toBeDefined();
    expect(d!.scope).toBe('both');
    expect(d!.group).toBe('mode');
    expect(settingsRegistry.defaultOf('mode.default')).toBe('normal');
    expect(readSetting({}, 'mode.default')).toBe('normal');
    expect(readSetting({ mode: { default: 'auto' } }, 'mode.default')).toBe('auto');
    expect(readSetting({ mode: { default: 'bad' } }, 'mode.default')).toBe('normal');
    expect(Object.keys(d!.options ?? {})).toEqual(['plan', 'normal', 'auto']);
  });

  it('세션 속성 mode: 알려진 값만 남고 옛 값은 버린다', () => {
    expect(SessionRecordSchema.parse({ ...session, mode: 'plan' }).mode).toBe('plan');
    expect(SessionRecordSchema.parse({ ...session, mode: 'weird' }).mode).toBeUndefined();
    expect(SessionRecordSchema.parse(session).mode).toBeUndefined();
  });

  it('0B.40 프로젝트 기본 모드 > 전체 기본 모드, 잘못된 프로젝트 값은 전체 값으로', () => {
    expect(resolveSessionDefaults({ defaults: { mode: 'plan' } }, { mode: 'auto' })).toMatchObject({
      mode: 'plan',
      from: { mode: 'project' },
    });
    expect(resolveSessionDefaults({ defaults: {} }, { mode: 'auto' })).toMatchObject({
      mode: 'auto',
      from: { mode: 'global' },
    });
    expect(resolveSessionDefaults({ defaults: { mode: 'x' } }, { mode: 'normal' }).mode).toBe('normal');
    expect(resolveSessionDefaults(undefined, {}).mode).toBeUndefined();
  });
});
