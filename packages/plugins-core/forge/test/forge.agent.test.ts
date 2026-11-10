import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentRegistry } from '@harness-x/agent-builder';
import { AgentSummarySchema } from '@harness-x/protocol';
import { forgePlugin } from '../src/index.js';

describe('51.1 /forge 에이전트 등록', () => {
  it('플러그인 파이프라인 forge → / 목록에 /forge (6노드: interview → spec → scaffold → check → test → install)', () => {
    const home = mkdtempSync(join(tmpdir(), 'hx-forge-agent-'));
    try {
      const registry = new AgentRegistry({ plugins: () => [forgePlugin()], home });
      const list = registry.summaries();
      expect(registry.issues).toEqual([]);
      const forge = list.find((a) => a.command === '/forge');
      expect(forge).toBeDefined();
      expect(AgentSummarySchema.parse(forge)).toMatchObject({
        name: 'forge',
        displayName: 'Forge',
        icon: '🔨',
        source: 'plugin',
        pluginId: 'forge',
        nodeCount: 6,
      });
      const a = registry.get('/forge')!;
      expect(a.pipeline.nodes.map((n) => `${n.id}:${n.type}`)).toEqual([
        'interview:role',
        'spec:role',
        'scaffold:role',
        'check:gate',
        'test:gate',
        'install:role',
      ]);
      // check/test 실패는 scaffold로 되돌린다 (최대 3회)
      expect(a.pipeline.edges.filter((e) => e.onFail).map((e) => `${e.from}>${e.to}`)).toEqual([
        'check>scaffold',
        'test>scaffold',
      ]);
      expect(
        a.pipeline.nodes
          .filter((n) => n.type === 'gate')
          .map((n) => (n as { maxRetries: number }).maxRetries),
      ).toEqual([3, 3]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
