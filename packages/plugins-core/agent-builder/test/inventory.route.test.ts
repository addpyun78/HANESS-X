import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeEnginesCache } from '@harness-x/engine-scanner';
import { EventLog, startApiServer } from '@harness-x/kernel';
import { inventorySummary } from '../src/inventory/build.js';
import { InventoryResponseSchema, INVENTORY_ROUTE, registerInventoryRoute } from '../src/inventory/route.js';
import { InventoryService } from '../src/inventory/service.js';
import { AgentRegistry } from '../src/registry.js';
import { inventoryEnv } from './inventory-helpers.js';

describe('P4-A.12 GET /api/builder/inventory', () => {
  it('응답 스키마 + 화면용 요약', async () => {
    const env = inventoryEnv();
    const log = new EventLog({ root: join(env.dir, 'api-logs') });
    writeEnginesCache(
      {
        version: 1,
        scannedAt: '2026-11-11T00:00:00.000Z',
        platform: 'linux',
        engines: [
          { name: 'claude', location: 'linux', path: '/bin/claude', version: '2.0.0', status: 'ok' },
          { name: 'codex', location: 'linux', path: '/bin/codex', version: '1.0.0', status: 'ok' },
          { name: 'gemini', location: 'linux', path: '/bin/gemini', version: '0.1.0', status: 'outdated' },
        ],
      },
      join(env.home, 'engines.json'),
    );
    const loader = env.loader();
    await loader.loadAll();
    const registry = new AgentRegistry({ plugins: () => loader.plugins.values(), home: env.home });
    const svc = new InventoryService({
      plugins: () => loader.plugins.values(),
      agents: () => registry.list(),
      home: env.home,
      workspace: env.dir,
    });
    const server = await startApiServer({
      loader,
      log,
      port: 0,
      tokenFile: join(env.home, 'run', 'token'),
      routes: (app) => registerInventoryRoute(app, svc),
    });
    try {
      expect((await fetch(server.url + INVENTORY_ROUTE)).status).toBe(401);
      const res = await fetch(server.url + INVENTORY_ROUTE, {
        headers: { authorization: `Bearer ${server.token}` },
      });
      expect(res.status).toBe(200);
      const body = InventoryResponseSchema.parse(await res.json());
      expect(body.inventory.skills).toHaveLength(3);
      expect(body.inventory.engines.map((e) => e.id)).toEqual(['claude-code', 'codex', 'gemini']);
      expect(body.inventory.agents.map((a) => a.name)).toEqual(registry.summaries().map((a) => a.name));
      expect(body.summary).toBe('스킬 3개, 엔진 2개 사용 가능');
    } finally {
      await server.close();
      log.close();
      svc.dispose();
      env.cleanup();
    }
  });

  it('요약 문구: 같은 엔진이 두 위치에 있어도 1개, 준비 안 된 것은 빼고 센다', async () => {
    const svc = new InventoryService({
      plugins: () => [],
      engines: () => ({
        version: 1,
        scannedAt: '2026-11-11T00:00:00.000Z',
        platform: 'linux',
        engines: [
          { name: 'claude', location: 'windows', path: 'a', version: '1', status: 'ok' },
          { name: 'claude', location: 'wsl:Ubuntu', path: 'b', version: '1', status: 'ok' },
        ],
        localLlms: [],
      }),
    });
    expect(inventorySummary(await svc.get())).toBe('스킬 0개, 엔진 1개 사용 가능');
  });
});
