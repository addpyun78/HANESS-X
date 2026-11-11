import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLog, SecretStore, listLockEntries, memoryBackend, removeLockEntries } from '@harness-x/kernel';
import { afterEach, describe, expect, it } from 'vitest';
import { RETIRED_CONFIG_LABEL, retiredName } from '../../../../../tests/helpers/retired-names.js';
import { cleanupLegacyVerifier, RETIRED_JUDGE_KEY_NOTICE, retiredSecretAccounts } from '../src/cleanup.js';

/** 삭제된 서비스 이름은 조사 파일에서 읽는다 (J.8) */
const name = retiredName(RETIRED_CONFIG_LABEL);

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function env() {
  const dir = mkdtempSync(join(tmpdir(), 'hx-ladder-cleanup-'));
  dirs.push(dir);
  const secrets = new SecretStore(memoryBackend());
  const log = new EventLog({ root: join(dir, 'logs') });
  const lockFile = join(dir, 'plugins.lock');
  writeFileSync(
    lockFile,
    JSON.stringify({
      lockfileVersion: 1,
      plugins: [
        { id: 'hello', version: '0.1.0', sha256: 'b'.repeat(64) },
        { id: `verifier-${name}`, version: '0.1.0', sha256: 'a'.repeat(64) },
      ],
    }),
  );
  return { dir, secrets, log, lockFile, noticeFile: join(dir, 'notices.json') };
}

const legacyConfig = () => ({ verifier: { l4: name, [name]: { endpoint: 'https://example.invalid/v1' } } });

describe('J.6 키체인의 삭제된 판정 서비스 키 삭제 + 패널 안내 1회', () => {
  it('키 조회 결과 없음, 안내 이벤트 1건, lock 항목도 정리', () => {
    const e = env();
    e.secrets.set(`verifier:${name}`, 'k-1');
    e.secrets.set(name, 'k-2');
    e.secrets.setApiKey('codex', 'keep-me');
    const run = () =>
      cleanupLegacyVerifier({
        config: legacyConfig(),
        secrets: e.secrets,
        noticeFile: e.noticeFile,
        log: e.log,
        sessionId: 'boot',
        removeLockEntries: (ids) => removeLockEntries(e.lockFile, ids),
      });
    const r = run();
    expect(r.deleted).toEqual([`verifier:${name}`, name]);
    for (const a of retiredSecretAccounts(name)) expect(e.secrets.get(a)).toBeNull();
    expect(e.secrets.getApiKey('codex')).toBe('keep-me');
    expect(r.notice?.message).toBe(RETIRED_JUDGE_KEY_NOTICE);
    expect(r.lockRemoved).toEqual([`verifier-${name}`]);
    expect(listLockEntries(e.lockFile).map((x) => x.id)).toEqual(['hello']);
    expect(r.migration.config).toEqual({ judge: { engine: '' } });

    // 다시 실행(키를 또 넣어도): 키는 지우지만 안내는 다시 내지 않는다
    e.secrets.set(`verifier:${name}`, 'k-3');
    const again = run();
    expect(again.deleted).toEqual([`verifier:${name}`]);
    expect(again.notice).toBeUndefined();
    const events = readFileSync(e.log.sessionFile('boot'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { type: string });
    expect(events.filter((x) => x.type === 'notice')).toHaveLength(1);
    expect(events.filter((x) => x.type === 'notice')[0]).toMatchObject({ message: RETIRED_JUDGE_KEY_NOTICE });
    expect(events.filter((x) => x.type === 'config_migrated')).toHaveLength(2);
    e.log.close();
  });

  it('지울 키가 없으면 안내도 없다', () => {
    const e = env();
    const r = cleanupLegacyVerifier({ config: legacyConfig(), secrets: e.secrets, noticeFile: e.noticeFile });
    expect(r.deleted).toEqual([]);
    expect(r.notice).toBeUndefined();
    e.log.close();
  });
});
