import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hashPluginDir } from '../src/loader.js';
import { setup } from './plugin-fixtures.js';

describe('plugins.lock', () => {
  let env: ReturnType<typeof setup>;
  afterEach(() => env.cleanup());

  it('생성·대조, 파일 변조 시 로드 거부, trust 후 로드', async () => {
    env = setup();
    const dir = env.copyHello();
    expect(await env.mk().loadAll()).toEqual(['hello']);
    const lock = JSON.parse(readFileSync(env.lockFile, 'utf8'));
    expect(lock.plugins).toEqual([{ id: 'hello', version: '0.1.0', sha256: hashPluginDir(dir) }]);

    // 같은 내용이면 다시 로드됨
    expect(await env.mk().loadAll()).toEqual(['hello']);

    // 변조
    appendFileSync(join(dir, 'index.js'), '\n// tampered\n');
    const loader = env.mk();
    expect(await loader.loadAll()).toEqual([]);
    expect(loader.rejections[0]?.reason).toMatch(/plugins.lock 불일치/);

    // 사용자 승인(trust) 후에는 로드
    const l2 = env.mk();
    l2.register(dir, 'workspace', { acceptChanges: true });
    l2.trust('hello');
    expect(await env.mk().loadAll()).toEqual(['hello']);
  });
});
