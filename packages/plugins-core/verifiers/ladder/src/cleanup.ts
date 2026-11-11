import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  migrateVerifierConfig,
  SYSTEM_SESSION_ID,
  type MigrateVerifierResult,
  type SettingsEventSink,
} from './settings.js';

/**
 * 삭제된 외부 판정 서비스의 흔적 정리 (T-100 P1-J.6, J.2 연결)
 *  - 키체인: 그 서비스 이름으로 저장됐을 수 있는 계정을 지운다 (`verifier:<이름>`, `engine:<이름>`, `<이름>`)
 *  - plugins.lock: `verifier-<이름>` 항목을 지운다
 *  - 실제로 키를 지웠으면 패널 안내를 한 번만 남긴다: "더 이상 쓰지 않는 판정 서비스 키를 지웠어요"
 * 서비스 이름은 코드에 적지 않는다 — 사용자 설정에 남은 예전 값(migrateVerifierConfig의 retired)에서 온다.
 */

export const RETIRED_JUDGE_KEY_NOTICE = '더 이상 쓰지 않는 판정 서비스 키를 지웠어요';
export const RETIRED_JUDGE_KEY_NOTICE_ID = 'retired-judge-key-removed';

/** kernel SecretStore와 호환 (delete만 쓴다) */
export interface SecretDeleter {
  delete(account: string): boolean;
}

export function retiredSecretAccounts(name: string): string[] {
  return [`verifier:${name}`, `engine:${name}`, name];
}

export interface NoticeEvent {
  type: 'notice';
  noticeId: string;
  level: 'info';
  message: string;
}

export interface PurgeSecretsOptions {
  /** 삭제된 서비스 이름들 */
  retired: readonly string[];
  secrets: SecretDeleter;
  /** 한 번 보여준 안내 id를 기록하는 파일 (예: ~/.harness-x/notices.json) */
  noticeFile: string;
  log?: SettingsEventSink;
  sessionId?: string;
  now?: () => Date;
  idGen?: () => string;
}

export interface PurgeSecretsResult {
  /** 지운 키체인 계정 */
  deleted: string[];
  /** 이번에 남긴 안내 (이미 보여줬거나 지운 키가 없으면 없음) */
  notice?: NoticeEvent;
}

function readShown(file: string): string[] {
  try {
    const v = JSON.parse(readFileSync(file, 'utf8')) as { shown?: unknown };
    return Array.isArray(v.shown) ? v.shown.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeShown(file: string, shown: string[]): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ shown }, null, 2) + '\n');
  renameSync(tmp, file);
}

/** J.6 키체인의 삭제된 판정 서비스 키 삭제 + 패널 안내 1회 */
export function purgeRetiredVerifierSecrets(opts: PurgeSecretsOptions): PurgeSecretsResult {
  const deleted = [...new Set(opts.retired.flatMap(retiredSecretAccounts))].filter((a) =>
    opts.secrets.delete(a),
  );
  if (deleted.length === 0) return { deleted };
  const shown = existsSync(opts.noticeFile) ? readShown(opts.noticeFile) : [];
  if (shown.includes(RETIRED_JUDGE_KEY_NOTICE_ID)) return { deleted };
  const notice: NoticeEvent = {
    type: 'notice',
    noticeId: RETIRED_JUDGE_KEY_NOTICE_ID,
    level: 'info',
    message: RETIRED_JUDGE_KEY_NOTICE,
  };
  opts.log?.append({
    id: (opts.idGen ?? randomUUID)(),
    ts: (opts.now ?? (() => new Date()))().toISOString(),
    sessionId: opts.sessionId ?? SYSTEM_SESSION_ID,
    ...notice,
  });
  writeShown(opts.noticeFile, [...shown, RETIRED_JUDGE_KEY_NOTICE_ID]);
  return { deleted, notice };
}

export interface LegacyVerifierCleanupOptions extends Omit<PurgeSecretsOptions, 'retired'> {
  config: Record<string, unknown>;
  /** plugins.lock 항목 제거 (kernel removeLockEntries를 묶어 넘긴다) */
  removeLockEntries?: (ids: string[]) => string[];
}

export interface LegacyVerifierCleanupResult extends PurgeSecretsResult {
  migration: MigrateVerifierResult;
  /** plugins.lock에서 지운 id */
  lockRemoved: string[];
}

/** 시작 시 1회: 설정 마이그레이션(J.5) → 키체인 정리·안내(J.6) → plugins.lock 정리(J.2) */
export function cleanupLegacyVerifier(opts: LegacyVerifierCleanupOptions): LegacyVerifierCleanupResult {
  const { config, removeLockEntries, ...rest } = opts;
  const migration = migrateVerifierConfig(config, rest);
  const purge = purgeRetiredVerifierSecrets({ ...rest, retired: migration.retired });
  const lockRemoved =
    removeLockEntries && migration.retired.length
      ? removeLockEntries(migration.retired.map((n) => `verifier-${n}`))
      : [];
  return { ...purge, migration, lockRemoved };
}
