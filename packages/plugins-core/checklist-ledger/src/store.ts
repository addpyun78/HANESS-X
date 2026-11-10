import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, withFileLock, writeFileAtomic, type LockOptions } from './fs-util.js';
import { CHECKLIST_SCHEMA_VERSION, ChecklistSchema, type Checklist } from './schema.js';

/**
 * checklist.json 저장소 (20.3)
 * - 쓰기: 임시 파일 → fsync → rename (원자적)
 * - 낙관적 잠금: 쓰기마다 version + 1. expectedVersion이 현재 버전과 다르면 VersionConflictError
 * - read-compare-write 구간은 O_EXCL 잠금 파일로 프로세스 간에도 직렬화
 */

export const CHECKLIST_FILE = 'checklist.json';

export class VersionConflictError extends Error {
  readonly code = 'VERSION_CONFLICT';
  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`체크리스트 버전 충돌: 예상 v${expected}, 현재 v${actual} — 다시 읽고 재시도하세요`);
    this.name = 'VersionConflictError';
  }
}

export interface ChecklistStoreOptions {
  /** checklist.json이 놓일 폴더 (예: <workspace>/.harness-x/sessions/<id>) */
  dir: string;
  fileName?: string;
  lock?: LockOptions;
  now?: () => Date;
}

/** 저장소에 넘기는 다음 상태 (version·updatedAt·schemaVersion은 저장소가 채운다) */
export type ChecklistDraft = Omit<Checklist, 'version' | 'updatedAt' | 'schemaVersion'>;

export interface WriteOptions {
  /**
   * 호출자가 마지막으로 읽은 버전. 파일이 없을 때는 0.
   * 생략하면 잠금 안에서 읽은 현재 버전을 기준으로 한다(경쟁 쓰기 감지는 잠금 구간만).
   */
  expectedVersion?: number;
}

export class ChecklistStore {
  readonly dir: string;
  readonly file: string;
  private readonly lockFile: string;
  private readonly lockOpts: LockOptions;
  private readonly now: () => Date;

  constructor(opts: ChecklistStoreOptions) {
    this.dir = opts.dir;
    this.file = join(opts.dir, opts.fileName ?? CHECKLIST_FILE);
    this.lockFile = `${this.file}.lock`;
    this.lockOpts = opts.lock ?? {};
    this.now = opts.now ?? (() => new Date());
  }

  exists(): boolean {
    return existsSync(this.file);
  }

  /** 현재 체크리스트 (없으면 null). 스키마 위반 파일은 예외 */
  read(): Checklist | null {
    if (!existsSync(this.file)) return null;
    return ChecklistSchema.parse(readJson(this.file));
  }

  /** 현재 버전 (파일 없으면 0) */
  version(): number {
    return this.read()?.version ?? 0;
  }

  /** 개정본 보관 파일 경로: checklist.v{revision}.json */
  archiveFile(revision: number): string {
    const base = this.file.replace(/\.json$/, '');
    return `${base}.v${revision}.json`;
  }

  /**
   * 현재 상태를 읽어 fn으로 다음 상태를 만들고 저장한다 (compare-and-swap).
   * fn 안에서 던진 예외는 그대로 전파되고 파일은 바뀌지 않는다.
   */
  update(fn: (current: Checklist | null) => ChecklistDraft, opts: WriteOptions = {}): Checklist {
    return withFileLock(
      this.lockFile,
      () => {
        const cur = this.read();
        const actual = cur?.version ?? 0;
        if (opts.expectedVersion !== undefined && opts.expectedVersion !== actual)
          throw new VersionConflictError(opts.expectedVersion, actual);
        const draft = fn(cur);
        if (cur && draft.revision !== cur.revision) {
          // 개정: 이전 개정본을 덮어쓰기 전에 보관 (20.5)
          if (draft.revision !== cur.revision + 1)
            throw new Error(`개정 번호는 1씩 증가해야 합니다 (v${cur.revision} → v${draft.revision})`);
          const archive = this.archiveFile(cur.revision);
          if (!existsSync(archive)) copyFileSync(this.file, archive);
        }
        const next = ChecklistSchema.parse({
          schemaVersion: CHECKLIST_SCHEMA_VERSION,
          revision: draft.revision,
          version: actual + 1,
          updatedAt: this.now().toISOString(),
          items: draft.items,
        });
        writeFileAtomic(this.file, JSON.stringify(next, null, 2) + '\n');
        return next;
      },
      this.lockOpts,
    );
  }

  /** 보관된 개정본 읽기 */
  readArchive(revision: number): Checklist | null {
    const f = this.archiveFile(revision);
    if (!existsSync(f)) return null;
    return ChecklistSchema.parse(readJson(f));
  }
}
