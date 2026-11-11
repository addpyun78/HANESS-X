import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { listLockEntries, removeLockEntries } from '../src/loader.js';
import { RETIRED_PLUGIN_LABEL, retiredName } from '../../../tests/helpers/retired-names.js';
import { setup } from './plugin-fixtures.js';

/**
 * T-100 P1-J.2 — plugins.lock에서 삭제된 판정기 플러그인 항목 제거.
 * 플러그인 id는 조사 파일(A.3)에서 읽는다(코드에 이름을 남기지 않는다, J.8).
 */
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const retiredId = retiredName(RETIRED_PLUGIN_LABEL);

describe('J.2 plugins.lock에서 삭제된 판정기 플러그인 제거', () => {
  let env: ReturnType<typeof setup>;
  afterEach(() => env.cleanup());

  it('예전 lock에 남은 항목을 지우면 플러그인 목록에 없다', async () => {
    expect(retiredId).toMatch(/^verifier-[a-z0-9-]+$/);
    env = setup();
    env.copyHello();
    expect(await env.mk().loadAll()).toEqual(['hello']);
    // T-026 시절 lock: 삭제된 판정기 플러그인 항목이 남아 있다
    const lock = JSON.parse(readFileSync(env.lockFile, 'utf8')) as { plugins: unknown[] };
    lock.plugins.push({ id: retiredId, version: '0.1.0', sha256: 'a'.repeat(64) });
    writeFileSync(env.lockFile, JSON.stringify(lock));
    // 로더는 모르는 항목을 그대로 보존한다(다른 작업 폴더 플러그인일 수 있으므로) → 명시적 정리가 필요
    await env.mk().loadAll();
    expect(listLockEntries(env.lockFile).map((e) => e.id)).toContain(retiredId);

    expect(removeLockEntries(env.lockFile, [retiredId, 'not-there'])).toEqual([retiredId]);
    const ids = listLockEntries(env.lockFile).map((e) => e.id);
    expect(ids).toEqual(['hello']);
    expect(ids.some((id) => id === retiredId)).toBe(false);
    // 다시 실행해도 그대로, 다음 로드도 정상
    expect(removeLockEntries(env.lockFile, [retiredId])).toEqual([]);
    expect(await env.mk().loadAll()).toEqual(['hello']);
    // 저장소에도 그 플러그인 폴더가 없다
    expect(existsSync(`${REPO}packages/plugins/${retiredId}`)).toBe(false);
  });

  it('lock 파일이 없으면 아무것도 하지 않는다', () => {
    env = setup();
    expect(removeLockEntries(env.lockFile, ['x'])).toEqual([]);
    expect(existsSync(env.lockFile)).toBe(false);
    expect(listLockEntries(env.lockFile)).toEqual([]);
  });
});
