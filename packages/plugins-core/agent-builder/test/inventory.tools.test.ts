import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HARNESS_TOOLS } from '@harness-x/mcp-host';
import {
  collectMcpServers,
  collectTools,
  normalizePricing,
  readToolRegistry,
} from '../src/inventory/tools.js';
import { inventoryEnv } from './inventory-helpers.js';

describe('P4-A.5 도구·MCP 서버 수집', () => {
  it('registry.json 설치 도구(무료/유료) + tool 슬롯 플러그인 + MCP 서버 목록 일치', async () => {
    const env = inventoryEnv();
    try {
      const file = join(env.home, 'tools', 'registry.json');
      mkdirSync(join(env.home, 'tools'), { recursive: true });
      writeFileSync(
        file,
        JSON.stringify({
          version: 1,
          tools: [
            {
              id: 'playwright',
              name: 'Playwright',
              kind: 'cli',
              version: '1.50.0',
              pricing: 'free',
              purpose: '브라우저 화면 자동화·스크린샷',
              capabilities: ['screenshot', 'browser'],
              installedAt: '2026-11-11T00:00:00Z',
            },
            {
              id: 'figma-mcp',
              name: 'Figma',
              kind: 'mcp',
              pricing: { kind: 'paid' },
              purpose: '디자인 읽기',
            },
            { id: 'odd', kind: 'cli' },
            { name: 'id 없음 → 건너뜀' },
          ],
        }),
      );
      const registry = readToolRegistry(file);
      expect(registry.map((t) => t.id)).toEqual(['playwright', 'figma-mcp', 'odd']);
      const loader = env.loader();
      await loader.loadAll();
      const tools = collectTools(registry, loader.plugins.values());
      expect(tools.map((t) => [t.id, t.source, t.pricing])).toEqual([
        ['playwright', 'registry', 'free'],
        ['figma-mcp', 'registry', 'paid'],
        ['odd', 'registry', 'unknown'],
        ['screenshot', 'plugin', 'unknown'],
      ]);
      expect(tools[0]).toMatchObject({
        name: 'Playwright',
        version: '1.50.0',
        capabilities: ['screenshot', 'browser'],
      });
      expect(tools[3]).toMatchObject({
        purpose: '스크린샷 찍기 도구',
        permissions: { fs: ['workspace:write'], net: [], shell: true },
      });

      const servers = collectMcpServers(loader.plugins.values());
      expect(servers).toHaveLength(1);
      expect(servers[0]).toMatchObject({ id: 'harness', pluginId: 'mcp-host', health: 'ready' });
      expect(servers[0]!.tools.map((t) => t.name)).toEqual([...HARNESS_TOOLS]);
      expect(servers[0]!.tools.every((t) => t.description.length > 0)).toBe(true);
      expect(servers[0]!.permissions).toEqual({
        fs: ['workspace:read', 'workspace:write'],
        net: ['127.0.0.1'],
        shell: false,
      });
    } finally {
      env.cleanup();
    }
  });

  it('registry.json 없음·깨짐·배열 형식도 견딘다', () => {
    const env = inventoryEnv();
    try {
      expect(readToolRegistry(join(env.dir, 'none.json'))).toEqual([]);
      const f = join(env.dir, 'r.json');
      writeFileSync(f, '{ broken');
      expect(readToolRegistry(f)).toEqual([]);
      writeFileSync(f, JSON.stringify([{ id: 'a' }]));
      expect(readToolRegistry(f).map((t) => t.id)).toEqual(['a']);
      writeFileSync(f, JSON.stringify({ something: 1 }));
      expect(readToolRegistry(f)).toEqual([]);
    } finally {
      env.cleanup();
    }
  });

  it('요금 표시: 모르면 unknown', () => {
    expect(normalizePricing('free')).toBe('free');
    expect(normalizePricing({ type: 'paid', monthly: 10 })).toBe('paid');
    expect(normalizePricing('freemium')).toBe('unknown');
    expect(normalizePricing(undefined)).toBe('unknown');
  });
});
