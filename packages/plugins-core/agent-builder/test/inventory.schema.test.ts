import { describe, expect, it } from 'vitest';
import { InventorySchema, emptyWorkspaceContext, type Inventory } from '../src/inventory/schema.js';

const base = (): Inventory => ({
  snapshotId: 'snap-1',
  createdAt: '2026-11-11T00:00:00.000Z',
  plugins: [
    {
      id: 'hello',
      version: '0.1.0',
      slots: ['command'],
      commands: ['/hello'],
      permissions: { fs: [], net: [], shell: false },
      enabled: true,
      health: 'ready',
    },
  ],
  skills: [
    { id: 'kotlin-style', name: 'kotlin-style', description: 'Kotlin', tags: ['kotlin'], health: 'ready' },
  ],
  engines: [
    {
      id: 'claude-code',
      binary: 'claude',
      installed: true,
      version: '2.1.0',
      location: 'wsl:Ubuntu',
      host: 'wsl',
      login: 'loggedIn',
      mode: 'subscription',
      quota: { level: 'ok', ratio: 0.1 },
      health: 'ready',
    },
  ],
  tools: [
    {
      id: 'pw',
      name: 'Playwright',
      kind: 'cli',
      pricing: 'free',
      purpose: '브라우저 자동화',
      capabilities: ['screenshot'],
      source: 'registry',
      health: 'ready',
    },
  ],
  mcpServers: [{ id: 'harness', name: 'Harness', description: '', tools: [], health: 'ready' }],
  agents: [
    {
      name: 'design-qa',
      command: '/design-qa',
      displayName: '디자인 QA',
      source: 'plugin',
      defaultEngine: 'claude-code',
      nodes: [{ id: 'plan', type: 'role', engine: 'claude-code', skills: [], tools: [] }],
      health: 'ready',
    },
  ],
  pipelines: [{ id: 'p/x', name: 'x', pluginId: 'p', nodes: [], health: 'ready' }],
  comparators: [{ kind: 'text', description: '' }],
  workspace: emptyWorkspaceContext('ws'),
});

describe('P4-A.1 Inventory 스키마', () => {
  it('필수 필드 11개를 모두 가진 스냅샷 통과', () => {
    const inv = InventorySchema.parse(base());
    expect(Object.keys(inv).sort()).toEqual(
      [
        'snapshotId',
        'createdAt',
        'plugins',
        'skills',
        'engines',
        'tools',
        'mcpServers',
        'agents',
        'pipelines',
        'comparators',
        'workspace',
      ].sort(),
    );
  });

  it('빈 목록도 허용', () => {
    const inv = { ...base(), plugins: [], skills: [], engines: [], tools: [], agents: [], pipelines: [] };
    expect(InventorySchema.safeParse(inv).success).toBe(true);
  });

  it('필드 누락·모르는 필드·잘못된 상태값은 거부', () => {
    const { workspace: _w, ...missing } = base();
    expect(InventorySchema.safeParse(missing).success).toBe(false);
    expect(InventorySchema.safeParse({ ...base(), extra: 1 }).success).toBe(false);
    const bad = base();
    (bad.skills[0] as { health: string }).health = 'broken';
    expect(InventorySchema.safeParse(bad).success).toBe(false);
    const badTool = base();
    (badTool.tools[0] as { pricing: string }).pricing = 'cheap';
    expect(InventorySchema.safeParse(badTool).success).toBe(false);
    expect(InventorySchema.safeParse({ ...base(), createdAt: 'yesterday' }).success).toBe(false);
  });

  it('자산 객체에 본문·비밀용 필드를 끼울 수 없다 (strict)', () => {
    const bad = base();
    (bad.skills[0] as Record<string, unknown>).body = '# 본문';
    expect(InventorySchema.safeParse(bad).success).toBe(false);
  });
});
