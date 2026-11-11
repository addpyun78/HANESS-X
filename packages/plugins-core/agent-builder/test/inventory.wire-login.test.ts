import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeEnginesCache } from '@harness-x/engine-scanner';
import { registerBuilderInventory } from '../src/inventory/wire.js';
import { inventoryEnv } from './inventory-helpers.js';

/** 커널 serve가 넘기는 로그인 상태(engineFacts)가 인벤토리 건강 상태에 반영된다 — 로그아웃 엔진은 needs-login */
describe('registerBuilderInventory engineFacts (로그인 상태 연결)', () => {
  it('codex 로그아웃 → needs-login, 나머지 ready', async () => {
    const env = inventoryEnv();
    writeEnginesCache(
      {
        version: 1,
        scannedAt: '2026-11-11T00:00:00.000Z',
        platform: 'linux',
        engines: [
          { name: 'claude', location: 'linux', path: '/bin/claude', version: '2.0.0', status: 'ok' },
          { name: 'codex', location: 'linux', path: '/bin/codex', version: '1.0.0', status: 'ok' },
        ],
      },
      join(env.home, 'engines.json'),
    );
    const routes: string[] = [];
    const svc = registerBuilderInventory(
      { get: (path: string) => routes.push(path) },
      {
        plugins: () => [],
        home: env.home,
        engineFacts: async () => ({ login: { 'claude-code': 'loggedIn', codex: 'loggedOut' } }),
      },
    );
    try {
      const inv = await svc.get();
      const health = Object.fromEntries(inv.engines.map((e) => [e.id, e.health]));
      expect(health).toEqual({ 'claude-code': 'ready', codex: 'needs-login' });
      expect(routes).toContain('/api/builder/inventory');
    } finally {
      svc.dispose();
    }
  });
});
