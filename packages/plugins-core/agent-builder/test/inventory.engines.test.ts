import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeEnginesCache, type EnginesCacheInput } from '@harness-x/engine-scanner';
import { collectEngines, collectEnginesFromFile } from '../src/inventory/engines.js';

const CACHE: EnginesCacheInput = {
  version: 1,
  scannedAt: '2026-11-11T00:00:00.000Z',
  platform: 'linux',
  engines: [
    { name: 'claude', location: 'wsl:Ubuntu', path: '/usr/bin/claude', version: '2.1.0', status: 'ok' },
    { name: 'claude', location: 'windows', path: 'C:\\bin\\claude.exe', version: '2.0.1', status: 'ok' },
    { name: 'codex', location: 'wsl:Ubuntu', path: '/usr/bin/codex', version: '0.9.0', status: 'outdated' },
    {
      name: 'agy',
      location: 'windows',
      path: 'C:\\bin\\agy.exe',
      version: null,
      status: 'unknown',
      error: 'timeout',
    },
  ],
  localLlms: [],
};

describe('P4-A.4 엔진 수집 (engine-scanner 결과)', () => {
  it('engines.json과 일치: 설치·버전·위치(Windows/WSL)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hx-inv-eng-'));
    try {
      const file = join(dir, 'engines.json');
      const cache = writeEnginesCache(CACHE, file);
      const engines = collectEnginesFromFile(file);
      expect(engines).toHaveLength(cache.engines.length);
      expect(engines.map((e) => [e.binary, e.location, e.version])).toEqual(
        cache.engines.map((e) => [e.name, e.location, e.version]),
      );
      expect(engines.map((e) => e.id)).toEqual(['claude-code', 'claude-code', 'codex', 'antigravity']);
      expect(engines.map((e) => e.host)).toEqual(['wsl', 'windows', 'wsl', 'windows']);
      expect(engines.every((e) => e.installed)).toBe(true);
      // 사실 정보가 없으면 unknown
      expect(engines[0]).toMatchObject({ login: 'unknown', mode: 'unknown', quota: { level: 'unknown' } });
      expect(collectEnginesFromFile(join(dir, 'missing.json'))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('로그인 상태·구독/API 모드·쿼터 여유 반영', () => {
    const cache = writeEnginesCacheInMemory();
    const engines = collectEngines(cache, {
      login: { 'claude-code': 'loggedIn', codex: 'loggedOut' },
      mode: { 'claude-code': 'subscription', codex: 'apiKey' },
      quota: { 'claude-code': { level: 'warning', ratio: 0.85 } },
    });
    expect(engines[0]).toMatchObject({
      login: 'loggedIn',
      mode: 'subscription',
      quota: { level: 'warning', ratio: 0.85 },
      health: 'ready',
    });
    expect(engines[2]).toMatchObject({ login: 'loggedOut', mode: 'apiKey', health: 'needs-login' });
  });
});

function writeEnginesCacheInMemory() {
  const dir = mkdtempSync(join(tmpdir(), 'hx-inv-eng-'));
  try {
    return writeEnginesCache(CACHE, join(dir, 'engines.json'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
