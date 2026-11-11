import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { attachmentId, parseAttachment, type Attachment, type AttachmentWarning } from '@harness-x/protocol';
import { detectType, extOf } from './detect.js';
import { checkBatchLimit, checkFileLimit, resolveLimits, type AttachmentLimits } from './limits.js';

/**
 * 1A.2 첨부 저장: <프로젝트 루트>/.harness-x/attachments/<세션id>/<해시12>/original<확장자>
 * 엔진이 작업 폴더 밖 파일을 못 읽는 경우가 있어 프로젝트 폴더 안에 둔다. .gitignore에 자동 추가.
 * 프로젝트 루트는 0-2(프로젝트)가 정하므로 주입받는다.
 */

export const ATTACHMENTS_DIR = join('.harness-x', 'attachments');
export const GITIGNORE_LINE = '.harness-x/attachments/';
export const META_FILE = 'attachment.json';

export function attachmentsRoot(projectRoot: string): string {
  return join(projectRoot, ATTACHMENTS_DIR);
}

export function sessionAttachmentsDir(projectRoot: string, sessionId: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(sessionId) || sessionId.includes('..'))
    throw new Error(`세션 id가 올바르지 않아요: ${sessionId}`);
  return join(attachmentsRoot(projectRoot), sessionId);
}

/** .gitignore에 첨부 폴더를 넣는다 (이미 있으면 그대로). 바꿨으면 true */
export function ensureGitignore(projectRoot: string): boolean {
  const file = join(projectRoot, '.gitignore');
  const cur = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const lines = cur.split(/\r?\n/).map((l) => l.trim());
  const covered = ['.harness-x', '.harness-x/', '/.harness-x/', GITIGNORE_LINE, `/${GITIGNORE_LINE}`];
  if (lines.some((l) => covered.includes(l))) return false;
  const sep = cur.length === 0 || cur.endsWith('\n') ? '' : '\n';
  writeFileSync(file, `${cur}${sep}# HARNESS-X 첨부 파일 (자동 추가)\n${GITIGNORE_LINE}\n`);
  return true;
}

/** 로그·이벤트에 남기는 첨부 기록: 경로·해시만 (1C.3 원문 금지) */
export interface AttachmentEventSink {
  append(record: { type: string } & Record<string, unknown>): unknown;
}

export interface AttachmentStoreOptions {
  /** 프로젝트 루트 (0-2가 정함). 함수면 저장할 때마다 묻는다 */
  projectRoot: string | (() => string | undefined);
  limits?: Partial<AttachmentLimits>;
  events?: AttachmentEventSink;
  now?: () => Date;
}

export interface AddInput {
  name: string;
  /** 내용 (data 또는 path 중 하나) */
  data?: Buffer;
  /** 로컬 파일 경로 */
  path?: string;
}

export interface AddResult {
  attachment: Attachment;
  /** 같은 해시가 이미 있어 다시 저장하지 않음 (1A.6) */
  reused: boolean;
}

export class NoProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoProjectError';
  }
}

export function sha256Of(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** 저장할 원본 파일 이름 (영문 고정 + 원래 확장자) */
export function originalFileName(name: string): string {
  const ext = extOf(name).replace(/[^.a-z0-9]/g, '');
  return `original${ext === '.env' ? '.env.txt' : ext}`;
}

export class AttachmentStore {
  readonly limits: AttachmentLimits;
  private readonly now: () => Date;

  constructor(private readonly opts: AttachmentStoreOptions) {
    this.limits = resolveLimits(opts.limits);
    this.now = opts.now ?? (() => new Date());
  }

  /** 지금 프로젝트 루트 (없으면 NoProjectError) */
  root(): string {
    const r = typeof this.opts.projectRoot === 'function' ? this.opts.projectRoot() : this.opts.projectRoot;
    if (!r) throw new NoProjectError('프로젝트를 먼저 골라야 해요');
    return r;
  }

  dir(sessionId: string): string {
    return sessionAttachmentsDir(this.root(), sessionId);
  }

  attachmentDir(sessionId: string, id: string): string {
    return join(this.dir(sessionId), id.replace(/^att_/, ''));
  }

  /** 여러 개 한 번에 (한 번 한도 1GB 먼저 검사) */
  async addMany(sessionId: string, inputs: readonly AddInput[]): Promise<AddResult[]> {
    checkBatchLimit(
      inputs.map((i) => sizeOf(i)),
      this.limits,
    );
    const out: AddResult[] = [];
    for (const i of inputs) out.push(await this.add(sessionId, i));
    return out;
  }

  async add(sessionId: string, input: AddInput): Promise<AddResult> {
    checkFileLimit(sizeOf(input), this.limits);
    const data = input.data ?? readFileSync(input.path!);
    const sha256 = sha256Of(data);
    const id = attachmentId(sha256);
    const root = this.root();
    ensureGitignore(root);
    const dir = this.attachmentDir(sessionId, id);
    const existing = this.get(sessionId, id);
    if (existing) {
      this.opts.events?.append({
        type: 'attachment_reused',
        sessionId,
        attachmentId: id,
        sha256,
        path: existing.storedPath,
      });
      return { attachment: existing, reused: true };
    }
    mkdirSync(dir, { recursive: true });
    const name = basename(input.name) || 'file';
    const det = detectType(data, name);
    const storedPath = join(dir, originalFileName(name));
    writeAtomic(storedPath, data);
    const warnings: AttachmentWarning[] = [];
    const attachment = parseAttachment({
      id,
      sha256,
      originalName: name,
      sizeBytes: data.length,
      mime: det.mime,
      kind: det.kind,
      storedPath,
      representations: [],
      warnings,
      status: 'converting',
      sessionId,
      createdAt: this.now().toISOString(),
    });
    this.save(attachment);
    this.opts.events?.append({
      type: 'attachment_added',
      sessionId,
      attachmentId: id,
      sha256,
      kind: det.kind,
      sizeBytes: data.length,
      path: storedPath,
    });
    return { attachment, reused: false };
  }

  /** attachment.json 저장 */
  save(a: Attachment): void {
    const sid = a.sessionId;
    if (!sid) throw new Error('세션 id가 없는 첨부는 저장할 수 없어요');
    const dir = this.attachmentDir(sid, a.id);
    mkdirSync(dir, { recursive: true });
    writeAtomic(join(dir, META_FILE), JSON.stringify(parseAttachment(a), null, 2) + '\n');
  }

  get(sessionId: string, id: string): Attachment | undefined {
    const f = join(this.attachmentDir(sessionId, id), META_FILE);
    if (!existsSync(f)) return undefined;
    return parseAttachment(JSON.parse(readFileSync(f, 'utf8')));
  }

  list(sessionId: string): Attachment[] {
    return listAttachmentsIn(this.dir(sessionId));
  }
}

/** 세션 첨부 폴더 안의 attachment.json 전부 (MCP 서버도 이것으로 읽는다) */
export function listAttachmentsIn(dir: string): Attachment[] {
  if (!existsSync(dir)) return [];
  const out: Attachment[] = [];
  for (const d of readdirSync(dir)) {
    const f = join(dir, d, META_FILE);
    if (!existsSync(f)) continue;
    try {
      out.push(parseAttachment(JSON.parse(readFileSync(f, 'utf8'))));
    } catch {
      /* 망가진 기록은 건너뜀 */
    }
  }
  return out.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
}

function sizeOf(i: AddInput): number {
  if (i.data) return i.data.length;
  if (i.path) return statSync(i.path).size;
  throw new Error('data 또는 path가 필요해요');
}

export function writeAtomic(file: string, data: Buffer | string): void {
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}
