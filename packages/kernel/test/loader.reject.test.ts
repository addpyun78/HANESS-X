import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setup } from './plugin-fixtures.js';

describe('매니페스트 검증 실패', () => {
  let env: ReturnType<typeof setup>;
  afterEach(() => env.cleanup());

  it('깨진 매니페스트 거부 로그', async () => {
    env = setup();
    const bad = join(env.userRoot, 'broken');
    mkdirSync(bad);
    writeFileSync(join(bad, 'harness-plugin.json'), '{ "id": "Broken", "version": "x" ');
    const bad2 = join(env.userRoot, 'invalid');
    mkdirSync(bad2);
    writeFileSync(
      join(bad2, 'harness-plugin.json'),
      JSON.stringify({ id: 'Invalid', version: '1', apiVersion: 1, provides: {} }),
    );
    const loader = env.mk();
    await loader.loadAll();
    expect(loader.rejections.map((r) => r.dir).sort()).toEqual([bad, bad2].sort());
    expect(loader.rejections.find((r) => r.dir === bad)?.reason).toMatch(/매니페스트 읽기 실패/);
    expect(loader.rejections.find((r) => r.dir === bad2)?.reason).toMatch(/검증 실패.*id/);
    const logged = env.log.query({ sessionId: 'kernel', type: 'plugin_rejected' });
    expect(logged).toHaveLength(2);
    expect(env.lines.some((l) => l.startsWith('plugin rejected'))).toBe(true);
  });
});
