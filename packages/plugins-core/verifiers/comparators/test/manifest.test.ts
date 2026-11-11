import { readFileSync } from 'node:fs';
import { PluginManifestSchema } from '@harness-x/protocol';
import { describe, expect, it } from 'vitest';
import { BUILTIN_COMPARATOR_KINDS } from '../src/builtins.js';
import { createComparatorRegistry } from '../src/registry.js';

describe('기본 비교기 8종과 플러그인 매니페스트', () => {
  it('harness-plugin.json provides.comparator = 기본 비교기 kind 8종', () => {
    const m = PluginManifestSchema.parse(
      JSON.parse(readFileSync(new URL('../harness-plugin.json', import.meta.url), 'utf8')),
    );
    expect(BUILTIN_COMPARATOR_KINDS).toEqual([
      'exact',
      'path',
      'text',
      'json',
      'number',
      'version',
      'regex',
      'exitCode',
    ]);
    expect(m.provides.comparator).toEqual(BUILTIN_COMPARATOR_KINDS);
    expect(createComparatorRegistry().kinds()).toEqual(BUILTIN_COMPARATOR_KINDS);
  });
});
