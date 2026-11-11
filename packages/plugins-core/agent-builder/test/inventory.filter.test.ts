import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeEnginesCache } from '@harness-x/engine-scanner';
import { buildInventory } from '../src/inventory/build.js';
import { findLeaks, sanitizeText } from '../src/inventory/filter.js';
import { AgentRegistry } from '../src/registry.js';
import { inventoryEnv, skillMd, writePlugin } from './inventory-helpers.js';

const OPENAI = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789';
const GITHUB = 'ghp_' + 'a'.repeat(36);
const AWS = 'AKIAABCDEFGHIJKLMNOP';

describe('P4-A.9 비밀·코드 제외 필터', () => {
  it('인벤토리 JSON에 키 패턴·코드 블록 0건', async () => {
    const env = inventoryEnv();
    try {
      writePlugin(
        env.pluginRoot,
        {
          id: 'leaky',
          description: `토큰 ${OPENAI} 를 쓰는 도구\n\`\`\`js\nconst key = "${GITHUB}";\n\`\`\``,
          provides: { skill: ['leaky-skill'], tool: ['leaky-tool'] },
        },
        {
          'SKILL.md': skillMd(
            'leaky-skill',
            `password=hunter2 AWS ${AWS} 사용`,
            `\`\`\`\n${OPENAI}\n\`\`\`\n`,
          ),
        },
      );
      mkdirSync(join(env.home, 'tools'), { recursive: true });
      writeFileSync(
        join(env.home, 'tools', 'registry.json'),
        JSON.stringify({
          tools: [{ id: 'x', purpose: `Bearer ${'b'.repeat(30)} 로 호출`, pricing: 'free' }],
        }),
      );
      writeEnginesCache(
        {
          version: 1,
          scannedAt: '2026-11-11T00:00:00.000Z',
          platform: 'linux',
          engines: [{ name: 'codex', location: 'linux', path: '/bin/codex', version: '1.0.0', status: 'ok' }],
        },
        join(env.home, 'engines.json'),
      );
      const loader = env.loader();
      await loader.loadAll();
      const registry = new AgentRegistry({ plugins: () => loader.plugins.values(), home: env.home });
      const inv = await buildInventory({
        plugins: () => loader.plugins.values(),
        agents: () => registry.list(),
        home: env.home,
      });
      const json = JSON.stringify(inv);
      expect(findLeaks(json)).toEqual([]);
      expect(json).not.toContain('hunter2');
      expect(json).not.toContain('BODY-MARKER');
      expect(json).not.toMatch(/\\n/); // 여러 줄 본문 없음
      // 설명의 일반 문장은 남는다
      expect(inv.plugins.find((p) => p.id === 'leaky')!.description).toContain('를 쓰는 도구');
      expect(inv.tools.find((t) => t.id === 'x')!.purpose).toContain('[REDACTED:bearer]');
    } finally {
      env.cleanup();
    }
  });

  it('sanitizeText: 마스킹·코드 펜스·들여쓴 코드·길이 제한', () => {
    expect(sanitizeText(`키 ${OPENAI}`)).toBe('키 [REDACTED:sk]');
    expect(sanitizeText('앞 ```\nrm -rf /\n``` 뒤')).toBe('앞 뒤');
    expect(sanitizeText('설명\n    const x = 1;\n끝')).toBe('설명 끝');
    expect(sanitizeText('api_key: abc123 끝')).toBe('api_key=[REDACTED] 끝');
    expect(sanitizeText('가'.repeat(400))).toHaveLength(300);
    expect(findLeaks(`x ${GITHUB}`)).toEqual(['secret:github']);
    expect(findLeaks('```')).toEqual(['code-fence']);
  });
});
