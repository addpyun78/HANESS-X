import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parsePluginManifest, providedSlots } from '@harness-x/protocol';
import type { PluginContext } from '@harness-x/kernel';
import { activate, activeScanner, deactivate, readEnginesCache } from '@harness-x/engine-scanner';
import { tempDir } from './helpers.js';

const PKG = fileURLToPath(new URL('..', import.meta.url));

describe('engine-scanner 하네스 플러그인', () => {
  const prevHome = process.env.HARNESS_X_HOME;
  afterEach(() => {
    deactivate();
    if (prevHome === undefined) delete process.env.HARNESS_X_HOME;
    else process.env.HARNESS_X_HOME = prevHome;
  });

  it('harness-plugin.json 이 유효하고 tool 슬롯을 제공한다', () => {
    const m = parsePluginManifest(JSON.parse(readFileSync(join(PKG, 'harness-plugin.json'), 'utf8')));
    expect(m.id).toBe('engine-scanner');
    expect(m.main).toBe('dist/index.js');
    expect(providedSlots(m)).toEqual(['tool']);
  });

  it('activate: 백그라운드 스캔으로 engines.json 기록, deactivate: 주기 중단', async () => {
    const t = tempDir();
    try {
      process.env.HARNESS_X_HOME = t.dir;
      const logs: string[] = [];
      const ctx = {
        manifest: parsePluginManifest(JSON.parse(readFileSync(join(PKG, 'harness-plugin.json'), 'utf8'))),
        dir: PKG,
        config: {},
        log: (m: string) => logs.push(m),
        hooks: { onBlocking: () => () => {}, onNotify: () => () => {} },
      } as unknown as PluginContext;
      activate(ctx);
      expect(activeScanner()?.running).toBe(true);
      await vi.waitFor(() => expect(logs.some((l) => l.startsWith('engines:'))).toBe(true), {
        timeout: 20_000,
      });
      expect(readEnginesCache(join(t.dir, 'engines.json'))).not.toBeNull();
      const s = activeScanner();
      deactivate();
      expect(s?.running).toBe(false);
    } finally {
      t.cleanup();
    }
  });
});
