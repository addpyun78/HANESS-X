import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * 62.3 신뢰 등급
 * - core: 저장소의 코어 플러그인 (메인 스레드)
 * - trusted: 사용자가 승격한 플러그인 (메인 스레드). 승격은 그 시점의 파일 해시에 묶인다
 * - unsigned-isolated: 그 밖의 모든 플러그인 (worker_threads 격리)
 * 승격 기록: ~/.harness-x/trust.json
 */

export const TRUST_LEVELS = ['core', 'trusted', 'unsigned-isolated'] as const;
export type TrustLevel = (typeof TRUST_LEVELS)[number];

export interface TrustEntry {
  id: string;
  sha256: string;
  promotedAt: string;
}

export class TrustStore {
  private readonly entries = new Map<string, TrustEntry>();

  constructor(readonly file?: string) {
    if (!file) return;
    try {
      const data = JSON.parse(readFileSync(file, 'utf8')) as { trusted?: TrustEntry[] };
      for (const e of data.trusted ?? []) this.entries.set(e.id, e);
    } catch {
      /* 없거나 깨진 파일 = 빈 목록 */
    }
  }

  /** 등급 판정: 코어 출처 → core, 같은 해시로 승격됨 → trusted, 나머지 → unsigned-isolated */
  levelOf(p: { id: string; sha256: string; origin: string }): TrustLevel {
    if (p.origin === 'core') return 'core';
    const e = this.entries.get(p.id);
    if (e && e.sha256 === p.sha256) return 'trusted';
    return 'unsigned-isolated';
  }

  promote(id: string, sha256: string): TrustEntry {
    const e = { id, sha256, promotedAt: new Date().toISOString() };
    this.entries.set(id, e);
    this.save();
    return e;
  }

  demote(id: string): void {
    this.entries.delete(id);
    this.save();
  }

  list(): TrustEntry[] {
    return [...this.entries.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  private save(): void {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, trusted: this.list() }, null, 2) + '\n');
    renameSync(tmp, this.file);
  }
}
