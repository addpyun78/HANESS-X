import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PluginManifestSchema } from '../src/manifest.js';

const file = fileURLToPath(new URL('../../../examples/plugins/hello/harness-plugin.json', import.meta.url));

describe('examples/plugins/hello', () => {
  it('매니페스트가 스키마를 통과한다', () => {
    const r = PluginManifestSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });
});
