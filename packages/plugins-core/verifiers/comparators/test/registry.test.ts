import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PluginManifestSchema } from '@harness-x/protocol';
import { describe, expect, it } from 'vitest';
import { createComparatorRegistry } from '../src/registry.js';
import { CompareResultSchema } from '../src/types.js';
import { ctx } from './helpers.js';

const PLUGIN_DIR = fileURLToPath(new URL('../fixtures/sample-plugin/', import.meta.url));

describe('B.4 비교기 레지스트리 + 플러그인 provides.comparator', () => {
  it('manifest가 provides.comparator를 허용하고, 샘플 플러그인 비교기 1개를 등록한다', async () => {
    const manifest = PluginManifestSchema.parse(
      JSON.parse(readFileSync(`${PLUGIN_DIR}harness-plugin.json`, 'utf8')),
    );
    expect(manifest.provides.comparator).toEqual(['case-insensitive']);
    const mod: unknown = await import(pathToFileURL(`${PLUGIN_DIR}index.js`).href);
    const reg = createComparatorRegistry({ builtins: false });
    expect(reg.registerPlugin(manifest, mod)).toEqual(['case-insensitive']);
    expect(reg.kinds()).toEqual(['case-insensitive']);
    expect(reg.sourceOf('case-insensitive')).toBe('sample-comparator');
    const r = reg.require('case-insensitive').equals(' Done ', 'DONE', ctx());
    expect(CompareResultSchema.parse(r).verdict).toBe('equal');
  });

  it('같은 kind 중복 등록·선언 불일치·모르는 kind는 거부', async () => {
    const reg = createComparatorRegistry({ builtins: false });
    const c = {
      kind: 'x',
      normalize: String,
      equals: () => ({ verdict: 'equal', level: 'normalize', confidence: 1, reason: 'r' }) as const,
    };
    reg.register(c);
    expect(() => reg.register(c)).toThrow(/이미/);
    expect(() => reg.register({ ...c, kind: '9bad' })).toThrow(RangeError);
    expect(() => reg.require('nope')).toThrow(/등록되지 않은/);
    const m = { id: 'p', provides: { comparator: ['y'] } };
    expect(() => reg.registerPlugin(m, { comparators: [{ ...c, kind: 'z' }] })).toThrow(/내보내지 않음/);
    expect(() =>
      reg.registerPlugin(m, {
        comparators: [
          { ...c, kind: 'y' },
          { ...c, kind: 'z' },
        ],
      }),
    ).toThrow(/선언하지 않은/);
    expect(() => reg.registerPlugin({ id: 'q', provides: { tool: ['t'] } }, {})).toThrow(
      /provides.comparator/,
    );
    expect(
      PluginManifestSchema.safeParse({
        id: 'p',
        version: '1.0.0',
        apiVersion: 1,
        provides: { comparator: [] },
      }).success,
    ).toBe(false);
  });
});
