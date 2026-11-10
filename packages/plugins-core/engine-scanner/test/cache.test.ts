import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  defaultEnginesCacheFile,
  EnginesCacheSchema,
  readEnginesCache,
  scanPathEngines,
  writeEnginesCache,
} from '@harness-x/engine-scanner';
import { mockExec, ok, tempDir } from './helpers.js';

describe('10.5 ~/.harness-x/engines.json 캐시', () => {
  let t: ReturnType<typeof tempDir>;
  const prevHome = process.env.HARNESS_X_HOME;
  beforeEach(() => {
    t = tempDir();
    process.env.HARNESS_X_HOME = join(t.dir, '.harness-x');
  });
  afterEach(() => {
    if (prevHome === undefined) delete process.env.HARNESS_X_HOME;
    else process.env.HARNESS_X_HOME = prevHome;
    t.cleanup();
  });

  it('스캔 결과를 기본 경로에 기록하고 스키마를 통과한다', async () => {
    const { exec } = mockExec({
      'which -a claude': ok('/home/u/.local/bin/claude\n'),
      'which -a codex': ok('/home/u/.local/bin/codex\n'),
      '/home/u/.local/bin/claude --version': ok('2.1.3 (Claude Code)\n'),
      '/home/u/.local/bin/codex --version': ok('codex-cli 0.20.0\n'),
    });
    const engines = await scanPathEngines({ platform: 'linux', exec });
    expect(engines).toHaveLength(2);
    const file = defaultEnginesCacheFile();
    expect(file).toBe(join(t.dir, '.harness-x', 'engines.json'));
    writeEnginesCache({ version: 1, scannedAt: new Date().toISOString(), platform: 'linux', engines });

    expect(existsSync(file)).toBe(true);
    const json = JSON.parse(readFileSync(file, 'utf8'));
    const parsed = EnginesCacheSchema.parse(json);
    expect(parsed.engines.find((e) => e.name === 'claude')).toMatchObject({
      location: 'linux',
      path: '/home/u/.local/bin/claude',
      version: '2.1.3',
      status: 'ok',
    });
    expect(parsed.engines.find((e) => e.name === 'codex')).toMatchObject({
      version: '0.20.0',
      status: 'outdated',
      minVersion: '0.40.0',
    });
    expect(parsed.localLlms).toEqual([]);
    expect(readEnginesCache()).toEqual(parsed);
  });

  it('스키마에 맞지 않으면 기록 거부, 깨진 캐시는 null', () => {
    const file = join(t.dir, 'engines.json');
    expect(() =>
      writeEnginesCache(
        {
          version: 1,
          scannedAt: new Date().toISOString(),
          platform: 'linux',
          engines: [{ name: 'x', location: 'mars', path: '/x', version: null, status: 'unknown' }],
        },
        file,
      ),
    ).toThrow();
    expect(existsSync(file)).toBe(false);
    writeFileSync(file, '{not json');
    expect(readEnginesCache(file)).toBeNull();
  });
});
