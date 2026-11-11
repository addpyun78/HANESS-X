import { describe, expect, it } from 'vitest';
import { settingFields } from '../src/settings/json-schema.js';
import { pluginConfigsFrom, pluginSettingDefs, withPluginSettings } from '../src/settings/plugins.js';
import { settingsRegistry } from '../src/settings/registry.js';

const SAMPLE_PLUGIN = {
  id: 'sample-notes',
  displayName: '샘플 메모',
  configSchema: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', default: true, title: '메모 켜기', description: '작업마다 메모를 남겨요.' },
      style: { type: 'string', enum: ['short', 'long'], default: 'short', title: '메모 길이' },
      maxItems: { type: 'integer', minimum: 1, maximum: 20, default: 5 },
      folder: { type: 'string', default: '', 'x-widget': 'folder', 'x-advanced': true },
    },
  },
};

describe('T-101 0A.9 플러그인 configSchema 자동 포함', () => {
  it('속성 하나 = plugins.<id>.<속성>, 그룹 "플러그인", 플러그인 이름·위젯·고급 표시', () => {
    const defs = pluginSettingDefs(SAMPLE_PLUGIN);
    expect(defs.map((d) => d.key)).toEqual([
      'plugins.sample-notes.enabled',
      'plugins.sample-notes.style',
      'plugins.sample-notes.maxItems',
      'plugins.sample-notes.folder',
    ]);
    expect(defs[0]).toMatchObject({
      group: 'plugins',
      path: ['plugins', 'sample-notes', 'enabled'],
      title: '메모 켜기',
      plugin: { id: 'sample-notes', title: '샘플 메모' },
      restartRequired: true,
      scope: 'global',
    });
    expect(defs[2]!.description).toBe('샘플 메모 플러그인의 "maxItems" 설정이에요.');
    expect(defs[3]).toMatchObject({ widget: 'folder', advanced: true });
  });

  it('레지스트리에 합치면 기본값·검사·화면 필드가 그대로 동작, 기본 레지스트리는 안 바뀜', () => {
    const r = withPluginSettings([SAMPLE_PLUGIN, { id: 'no-config' }]);
    expect(settingsRegistry.has('plugins.sample-notes.enabled')).toBe(false);
    expect(r.defaultOf('plugins.sample-notes.maxItems')).toBe(5);
    expect(r.check('plugins.sample-notes.maxItems', 30)).toEqual({
      ok: false,
      message: '20 이하로 넣어 주세요.',
    });
    expect(r.check('plugins.sample-notes.style', 'long')).toEqual({ ok: true, value: 'long' });
    const f = settingFields(r).filter((x) => x.plugin);
    expect(f.map((x) => [x.key.split('.').pop(), x.widget])).toEqual([
      ['enabled', 'boolean'],
      ['style', 'enum'],
      ['maxItems', 'number'],
      ['folder', 'folder'],
    ]);
  });

  it('settings.json의 plugins.* → 플러그인 로더 config', () => {
    expect(pluginConfigsFrom({ plugins: { 'sample-notes': { maxItems: 3 }, bad: 1 }, judge: {} })).toEqual({
      'sample-notes': { maxItems: 3 },
    });
    expect(pluginConfigsFrom({})).toEqual({});
  });
});
