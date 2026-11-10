import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ApprovalRequestEventSchema } from '@harness-x/protocol';
import { z } from 'zod';
import { readJson, withFileLock, writeFileAtomic } from './fs-util.js';
import { type Glossary, type GlossaryIndex } from './glossary.js';
import type { EventSink } from './ledger.js';
import { toCanonicalPath } from './naming.js';
import { ArtifactIdSchema } from './schema.js';

/**
 * 경로 원장 manifest.json (T-022)
 * 산출물 ID → { 표시 이름, 정식 경로, 종류 }. 계획이 잠기는(Lock) 시점에 한 번에 확정되고,
 * 이후 변경은 revise()로만 한다(manifest_revision 이벤트). 파일을 직접 고치면 digest 불일치로 읽기를 거부한다.
 */

/** 정식 경로: 상대 POSIX 경로, 조각마다 영문 소문자 kebab-case (+ 확장자) */
const SEGMENT_RE = /^\.?[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)*$/;
export const CanonicalPathSchema = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith('/') && p.split('/').every((s) => SEGMENT_RE.test(s)), {
    message: '정식 경로는 상대 경로이고 조각마다 영문 소문자 kebab-case여야 합니다 (예: harness/mobile)',
  });

export const ArtifactKindSchema = z.enum(['file', 'dir']);
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;

export const ManifestEntrySchema = z
  .object({
    /** 사람에게 보이는 이름 (한글 허용, 예: 하네스/모바일) */
    displayName: z.string().trim().min(1),
    /** 엔진이 받는 정식 경로 (예: harness/mobile) */
    path: CanonicalPathSchema,
    kind: ArtifactKindSchema,
    /** 동치로 인정된 다른 경로 (L5 "동치 인정" 결과) */
    aliases: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

/** 22.1 {artifactId: {displayName, path, kind}} */
export const ManifestArtifactsSchema = z.record(ArtifactIdSchema, ManifestEntrySchema);
export type ManifestArtifacts = z.infer<typeof ManifestArtifactsSchema>;

export const MANIFEST_SCHEMA_VERSION = 1;

export const ManifestSchema = z
  .object({
    schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION),
    revision: z.number().int().nonnegative(),
    locked: z.boolean(),
    lockedAt: z.iso.datetime({ offset: true }).optional(),
    /** 잠금 후 artifacts의 sha256 — 직접 수정 감지 */
    digest: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    artifacts: ManifestArtifactsSchema,
  })
  .strict()
  .superRefine((m, ctx) => {
    if (m.locked && !m.digest)
      ctx.addIssue({ code: 'custom', message: '잠긴 manifest에는 digest가 필요합니다' });
    const seen = new Map<string, string>();
    for (const [id, e] of Object.entries(m.artifacts)) {
      const prev = seen.get(e.path);
      if (prev)
        ctx.addIssue({
          code: 'custom',
          message: `${id}와 ${prev}가 같은 경로 ${e.path}`,
          path: ['artifacts', id],
        });
      seen.set(e.path, id);
    }
  });
export type Manifest = z.infer<typeof ManifestSchema>;

export function parseManifest(value: unknown): Manifest {
  return ManifestSchema.parse(value);
}

export function manifestDigest(artifacts: ManifestArtifacts): string {
  const sorted = Object.fromEntries(Object.entries(artifacts).sort(([a], [b]) => a.localeCompare(b)));
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}

// ── 오류 ──────────────────────────────────────────────────────
export class ManifestLockedError extends Error {
  readonly code = 'MANIFEST_LOCKED';
  constructor() {
    super('manifest가 잠겨 있습니다 — 변경은 revise()(개정 이벤트)로만 할 수 있습니다');
    this.name = 'ManifestLockedError';
  }
}

export class ManifestTamperedError extends Error {
  readonly code = 'MANIFEST_TAMPERED';
  constructor(readonly file: string) {
    super(`manifest가 개정 이벤트 없이 직접 수정되었습니다 (digest 불일치): ${file}`);
    this.name = 'ManifestTamperedError';
  }
}

export class ManifestRevisionConflictError extends Error {
  readonly code = 'MANIFEST_REVISION_CONFLICT';
  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`manifest 개정 충돌: 예상 r${expected}, 현재 r${actual}`);
    this.name = 'ManifestRevisionConflictError';
  }
}

export class UnknownArtifactError extends Error {
  readonly code = 'UNKNOWN_ARTIFACT';
  constructor(readonly artifactId: string) {
    super(`manifest에 없는 산출물: ${artifactId}`);
    this.name = 'UnknownArtifactError';
  }
}

// ── 저장소 ────────────────────────────────────────────────────
export const PATH_MANIFEST_FILE = 'manifest.json';

export interface ManifestDraft {
  artifactId: string;
  displayName: string;
  kind: ArtifactKind;
  /** 지정하면 이름 정책 대신 그대로 사용 (정식 경로 규칙은 검사) */
  path?: string;
}

export interface ManifestLockOptions {
  glossary: Glossary | GlossaryIndex;
  /** 사용자가 확정한 영문 이름 (미등록 단어 → 영문) */
  overrides?: Record<string, string>;
}

export type ManifestLockResult =
  | { status: 'locked'; manifest: Manifest }
  | {
      status: 'needs_approval';
      approvalId: string;
      /** glossary에 없는 단어 */
      unknownWords: string[];
      /** 단어가 나온 산출물 */
      artifacts: { artifactId: string; displayName: string; unknown: string[] }[];
    };

export type ManifestChange = { artifactId: string; from: ManifestEntry | null; to: ManifestEntry | null };

export interface ReviseOptions {
  reason: string;
  /** 마지막으로 읽은 revision (다르면 충돌) */
  expectedRevision?: number;
}

export interface ManifestStoreOptions {
  dir: string;
  fileName?: string;
  /** 이벤트 로그 (approval_request·manifest_lock·manifest_revision) */
  log?: EventSink;
  sessionId?: string;
  engineId?: string;
  now?: () => Date;
  idGen?: () => string;
}

export interface ResolvedArtifact extends ManifestEntry {
  artifactId: string;
}

export class ManifestStore {
  readonly file: string;
  private readonly lockFile: string;
  private readonly opts: ManifestStoreOptions;
  private readonly now: () => Date;
  private readonly idGen: () => string;

  constructor(opts: ManifestStoreOptions) {
    this.opts = opts;
    this.file = join(opts.dir, opts.fileName ?? PATH_MANIFEST_FILE);
    this.lockFile = `${this.file}.lock`;
    this.now = opts.now ?? (() => new Date());
    this.idGen = opts.idGen ?? randomUUID;
  }

  /** 현재 manifest (없으면 null). 잠긴 manifest가 직접 수정되었으면 ManifestTamperedError */
  read(): Manifest | null {
    if (!existsSync(this.file)) return null;
    const m = parseManifest(readJson(this.file));
    if (m.locked && m.digest !== manifestDigest(m.artifacts)) throw new ManifestTamperedError(this.file);
    return m;
  }

  isLocked(): boolean {
    return this.read()?.locked ?? false;
  }

  /** 23.5 manifest.resolve(artifactId) → 정식 경로 */
  resolve(artifactId: string): ResolvedArtifact {
    const e = this.read()?.artifacts[artifactId];
    if (!e) throw new UnknownArtifactError(artifactId);
    return { artifactId, ...e };
  }

  /** 잠기기 전(계획 단계) 초안 항목 쓰기. 잠긴 뒤에는 ManifestLockedError */
  setDraft(artifactId: string, entry: ManifestEntry | null): Manifest {
    return this.withLock(() => {
      const cur = this.read() ?? emptyManifest();
      if (cur.locked) throw new ManifestLockedError();
      const artifacts = { ...cur.artifacts };
      if (entry) artifacts[ArtifactIdSchema.parse(artifactId)] = ManifestEntrySchema.parse(entry);
      else delete artifacts[artifactId];
      return this.write({ ...cur, artifacts });
    });
  }

  /**
   * Lock: 초안들의 정식 경로를 이름 정책으로 한 번에 확정하고 manifest를 고정한다.
   * glossary에 없는 한글 단어가 있으면 잠그지 않고 approval_request 이벤트를 남긴 뒤
   * needs_approval을 돌려준다 — 사용자가 영문 이름을 정하면 overrides로 다시 호출한다.
   */
  lock(drafts: readonly ManifestDraft[], opts: ManifestLockOptions): ManifestLockResult {
    const artifacts: ManifestArtifacts = {};
    const pending: { artifactId: string; displayName: string; unknown: string[] }[] = [];
    for (const d of drafts) {
      const id = ArtifactIdSchema.parse(d.artifactId);
      let path = d.path;
      if (path === undefined) {
        const r = toCanonicalPath(d.displayName, opts.glossary, {
          kind: d.kind,
          ...(opts.overrides ? { overrides: opts.overrides } : {}),
        });
        if (r.path === null) {
          pending.push({ artifactId: id, displayName: d.displayName, unknown: r.unknown });
          continue;
        }
        path = r.path;
      }
      artifacts[id] = ManifestEntrySchema.parse({ displayName: d.displayName, path, kind: d.kind });
    }
    if (pending.length > 0) {
      const unknownWords = [...new Set(pending.flatMap((p) => p.unknown))];
      const approvalId = this.idGen();
      this.emit({
        type: 'approval_request',
        approvalId,
        kind: 'glossary.unknown-terms',
        title: `영문 이름 확인 필요: ${unknownWords.join(', ')}`,
        detail: { words: unknownWords, artifacts: pending },
        options: ['provide-english-names', 'cancel'],
      });
      return { status: 'needs_approval', approvalId, unknownWords, artifacts: pending };
    }
    const manifest = this.withLock(() => {
      const cur = this.read();
      if (cur?.locked) throw new ManifestLockedError();
      return this.write({
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        revision: (cur?.revision ?? 0) + 1,
        locked: true,
        lockedAt: this.now().toISOString(),
        digest: manifestDigest(artifacts),
        artifacts,
      });
    });
    this.emit({ type: 'manifest_lock', revision: manifest.revision, artifactIds: Object.keys(artifacts) });
    return { status: 'locked', manifest };
  }

  /**
   * 잠긴 manifest의 개정 — 유일한 변경 경로. 이전 개정본을 manifest.r{n}.json으로 보관하고
   * manifest_revision 이벤트(변경 전후·사유)를 남긴다. 값이 null이면 산출물 제거.
   */
  revise(changes: Record<string, ManifestEntry | null>, opts: ReviseOptions): Manifest {
    let diff: ManifestChange[] = [];
    const next = this.withLock(() => {
      const cur = this.read();
      if (!cur?.locked) throw new Error('잠기지 않은 manifest는 revise할 수 없습니다 — lock()을 먼저 하세요');
      if (opts.expectedRevision !== undefined && opts.expectedRevision !== cur.revision)
        throw new ManifestRevisionConflictError(opts.expectedRevision, cur.revision);
      const artifacts = { ...cur.artifacts };
      diff = [];
      for (const [id, entry] of Object.entries(changes)) {
        const from = artifacts[id] ?? null;
        if (entry) artifacts[ArtifactIdSchema.parse(id)] = ManifestEntrySchema.parse(entry);
        else delete artifacts[id];
        diff.push({ artifactId: id, from, to: entry ? artifacts[id]! : null });
      }
      copyFileSync(this.file, this.archiveFile(cur.revision));
      return this.write({ ...cur, revision: cur.revision + 1, digest: manifestDigest(artifacts), artifacts });
    });
    this.emit({ type: 'manifest_revision', revision: next.revision, reason: opts.reason, changes: diff });
    return next;
  }

  /** 동치로 인정된 경로를 산출물 별칭에 추가 (revise 경유) */
  addPathAlias(artifactId: string, aliasPath: string, reason: string): Manifest {
    const e = this.resolve(artifactId);
    const aliases = [...new Set([...(e.aliases ?? []), aliasPath])];
    const { artifactId: _id, ...entry } = e;
    return this.revise({ [artifactId]: { ...entry, aliases } }, { reason });
  }

  archiveFile(revision: number): string {
    return this.file.replace(/\.json$/, `.r${revision}.json`);
  }

  private withLock<T>(fn: () => T): T {
    return withFileLock(this.lockFile, fn);
  }

  private write(m: Manifest): Manifest {
    const parsed = parseManifest(m);
    writeFileAtomic(this.file, JSON.stringify(parsed, null, 2) + '\n');
    return parsed;
  }

  private emit(body: { type: string } & Record<string, unknown>): void {
    const { log, sessionId, engineId } = this.opts;
    if (!log || !sessionId) return;
    const rec = {
      id: this.idGen(),
      ts: this.now().toISOString(),
      sessionId,
      ...(engineId ? { engineId } : {}),
      ...body,
    };
    if (body.type === 'approval_request') ApprovalRequestEventSchema.parse(rec);
    log.append(rec as Parameters<EventSink['append']>[0]);
  }
}

function emptyManifest(): Manifest {
  return { schemaVersion: MANIFEST_SCHEMA_VERSION, revision: 0, locked: false, artifacts: {} };
}
