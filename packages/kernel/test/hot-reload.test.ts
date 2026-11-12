// @features F-008
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HotReloader, type FileChange } from '../src/hot-reload.js';
import { setup } from './plugin-fixtures.js';

function waitFor<T>(em: HotReloader, ev: string, ms = 3000): Promise<T> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`'${ev}' 이벤트가 ${ms}ms 안에 오지 않음`)), ms);
    em.once(ev, (v: T) => {
      clearTimeout(t);
      res(v);
    });
  });
}

describe('핫리로드', () => {
  let env: ReturnType<typeof setup>;
  let hr: HotReloader | undefined;
  afterEach(async () => {
    await hr?.stop();
    hr = undefined;
    env.cleanup();
  });

  async function boot() {
    env = setup();
    const dir = env.copyHello();
    const loader = env.mk();
    await loader.loadAll();
    hr = new HotReloader(loader, { roots: [{ dir: env.wsRoot, origin: 'workspace' }], debounceMs: 300 });
    await hr.start();
    return { dir, loader, hr };
  }

  it('7.1 파일 저장 이벤트 수신', async () => {
    const { dir, hr } = await boot();
    const got = waitFor<FileChange>(hr, 'fileChange');
    writeFileSync(join(dir, 'notes.txt'), 'x');
    const ch = await got;
    expect(ch.pluginDir).toBe(dir);
    expect(ch.file).toBe(join(dir, 'notes.txt'));
  });

  it('7.2 hello 버전 문자열 변경이 3초 안에 반영', async () => {
    const { dir, loader, hr } = await boot();
    expect(env.lines).toContain('[hello] activate hello@0.1.0 (hello-v1)');
    const start = Date.now();
    const done = waitFor<{ id: string }>(hr, 'reloaded', 3000);
    const file = join(dir, 'index.js');
    writeFileSync(file, readFileSync(file, 'utf8').replace("'hello-v1'", "'hello-v2'"));
    await done;
    expect(Date.now() - start).toBeLessThan(3000);
    expect(env.lines).toContain('[hello] activate hello@0.1.0 (hello-v2)');
    const mod = loader.plugins.get('hello')?.module as { VERSION?: string };
    expect(mod.VERSION).toBe('hello-v2');
    expect(loader.plugins.get('hello')?.state).toBe('active');
    expect(env.hooks.list('session.start')).toHaveLength(1); // 이전 훅은 해제, 새 훅 1개
  });

  it('7.3 깨진 수정 후에도 이전 버전 동작', async () => {
    const { dir, loader, hr } = await boot();
    const failed = waitFor<{ id: string; error: string }>(hr, 'failed', 3000);
    writeFileSync(join(dir, 'index.js'), 'export function activate( { syntax error');
    const f = await failed;
    expect(f.error).toMatch(/모듈 로드 실패/);
    const p = loader.plugins.get('hello')!;
    expect(p.state).toBe('active');
    expect((p.module as { VERSION?: string }).VERSION).toBe('hello-v1');
    await env.hooks.emit('session.start', { sessionId: 'after-broken' });
    expect(env.lines).toContain('[hello] hello, session after-broken');

    // activate에서 던지는 경우도 이전 버전 복구
    const failed2 = waitFor<{ error: string }>(hr, 'failed', 3000);
    writeFileSync(
      join(dir, 'index.js'),
      "export const VERSION='v3'; export function activate(){ throw new Error('boom') }",
    );
    expect((await failed2).error).toMatch(/activate 실패: boom/);
    expect((loader.plugins.get('hello')!.module as { VERSION?: string }).VERSION).toBe('hello-v1');
    expect(env.hooks.list('session.start')).toHaveLength(1);
  });
});
