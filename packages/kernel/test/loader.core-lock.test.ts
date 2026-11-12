// T-102 E.C1-005.1 재현: 저장소 기본 부품(출처 core)은 코드를 고쳐 다시 빌드하면 지문이 바뀐다.
// core는 커널과 같이 설치되는 자기 코드라 지문이 달라도 거부하지 않고 lock을 새 지문으로 갱신해야 한다.
// 밖에서 들여온 플러그인(workspace·user)의 변조 검사는 그대로여야 한다.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hashPluginDir, PluginLoader } from '../src/loader.js';
import { makePlugin, setup } from './plugin-fixtures.js';

describe('기본 부품(core) 지문 갱신 (T-102 C1-005)', () => {
  let env: ReturnType<typeof setup>;
  afterEach(() => env.cleanup());

  it('core 플러그인: 파일이 바뀌어도 로드되고 lock이 새 지문으로 바뀜, 기록에 남김', async () => {
    env = setup();
    const coreRoot = join(env.dir, 'repo', 'packages', 'plugins-core');
    mkdirSync(coreRoot, { recursive: true });
    const dir = makePlugin(coreRoot, {
      id: 'core-x',
      version: '0.1.0',
      apiVersion: 1,
      main: 'index.js',
      provides: { tool: ['core-x'] },
    });
    const mk = () =>
      new PluginLoader({
        hooks: env.hooks,
        log: env.log,
        roots: [{ dir: coreRoot, origin: 'core' }],
        lockFile: env.lockFile,
        logger: (l) => env.lines.push(l),
        importModule: (f: string) => import(`${f}?n=${Math.random()}`),
      });
    expect(await mk().loadAll()).toEqual(['core-x']);
    appendFileSync(join(dir, 'index.js'), '\n// 코드 고침(다시 빌드)\n');
    const l2 = mk();
    expect(await l2.loadAll()).toEqual(['core-x']);
    expect(l2.rejections).toEqual([]);
    const lock = JSON.parse(readFileSync(env.lockFile, 'utf8'));
    expect(lock.plugins.find((p: { id: string }) => p.id === 'core-x').sha256).toBe(hashPluginDir(dir));
    expect(env.lines.join('\n')).toMatch(/core-x.*(새로 고침|업데이트)/);
  });

  it('workspace 플러그인: 변조되면 여전히 거부', async () => {
    env = setup();
    const dir = env.copyHello();
    expect(await env.mk().loadAll()).toEqual(['hello']);
    appendFileSync(join(dir, 'index.js'), '\n// tampered\n');
    const loader = env.mk();
    expect(await loader.loadAll()).toEqual([]);
    expect(loader.rejections[0]?.reason).toMatch(/plugins.lock 불일치/);
  });
});
