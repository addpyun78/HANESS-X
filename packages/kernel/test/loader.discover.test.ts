import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultPluginRoots } from '../src/loader.js';
import { setup } from './plugin-fixtures.js';

describe('플러그인 탐색', () => {
  let env: ReturnType<typeof setup>;
  afterEach(() => env.cleanup());

  it('hello 플러그인 발견 (워크스페이스·사용자 루트)', () => {
    env = setup();
    env.copyHello(env.wsRoot);
    const found = env.mk().discover();
    expect(found).toEqual([{ dir: join(env.wsRoot, 'hello'), origin: 'workspace' }]);
  });

  it('기본 루트 4종 (Forge 설치 폴더 포함)', () => {
    env = setup();
    const roots = defaultPluginRoots({ workspace: '/w', repoRoot: '/r', home: '/h' });
    expect(roots.map((r) => r.dir)).toEqual([
      join('/w', '.harness-x', 'plugins'),
      join('/h', 'plugins'),
      join('/h', 'plugins', 'forge'),
      join('/r', 'packages', 'plugins-core'),
    ]);
  });
});
