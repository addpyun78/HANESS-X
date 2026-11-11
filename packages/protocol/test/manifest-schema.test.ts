import { describe, expect, it } from 'vitest';
import { PluginManifestSchema, providedSlots } from '../src/manifest.js';

const samples = {
  minimalCommand: { id: 'hello', version: '0.1.0', apiVersion: 1, provides: { command: ['/hello'] } },
  engine: {
    id: 'engine.claude-code',
    version: '1.0.0-beta.1',
    apiVersion: 1,
    displayName: 'Claude Code',
    main: 'dist/index.js',
    provides: { engine: ['claude-code'] },
    requires: { 'mcp-host': '^1.0.0' },
    permissions: { shell: true, fs: ['workspace:read', 'workspace:write'] },
    configSchema: { type: 'object', properties: { model: { type: 'string' } } },
  },
  verifier: {
    id: 'verifier-remote',
    version: '0.3.2',
    apiVersion: 1,
    provides: { verifier: ['l4'] },
    permissions: { net: ['api.example.com', '*.judge.example'] },
  },
};

describe('harness-plugin.json 스키마', () => {
  it.each(Object.entries(samples))('샘플 %s 통과', (_n, s) => {
    const r = PluginManifestSchema.safeParse(s);
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });
  it('기본값 채움', () => {
    const m = PluginManifestSchema.parse(samples.minimalCommand);
    expect(m.permissions).toEqual({ fs: [], net: [], shell: false });
    expect(m.requires).toEqual({});
    expect(m.main).toBe('index.js');
    expect(providedSlots(m)).toEqual(['command']);
  });
  it.each([
    ['id 대문자', { ...samples.minimalCommand, id: 'Hello' }],
    ['semver 아님', { ...samples.minimalCommand, version: 'v1' }],
    ['provides 비어 있음', { ...samples.minimalCommand, provides: {} }],
    ['모르는 필드', { ...samples.minimalCommand, extra: 1 }],
    ['명령에 / 없음', { ...samples.minimalCommand, provides: { command: ['hello'] } }],
  ])('거부: %s', (_n, s) => {
    expect(PluginManifestSchema.safeParse(s).success).toBe(false);
  });
});
