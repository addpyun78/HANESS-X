import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { Attachment, AttachmentWarning } from '@harness-x/protocol';
import type { Converter } from './context.js';
import { warn, writeRep } from './context.js';
import { MESSAGES } from './messages.js';
import { writeAtomic } from './store.js';
import { TOOL_NEEDS, type ExternalTools } from './tools.js';
import { listZip, readZipEntry, ZipError } from './zip.js';

/**
 * 1B.9 압축(zip / tar / tar.gz / 7z): 기본은 목록만. 풀기는 요청 시에만 —
 * 경로 탈출(../, 절대 경로) 차단, 총 크기·파일 수·압축률 상한(압축 폭탄 방지).
 */

export interface ArchiveEntry {
  name: string;
  size: number;
  compressedSize?: number;
  isDir: boolean;
}

export interface ArchiveLimits {
  /** 풀었을 때 총 크기 (기본 1GB) */
  maxTotalBytes: number;
  /** 파일 수 (기본 10000) */
  maxFiles: number;
  /** 항목 하나의 압축률 상한 (기본 200배, 1MB 넘는 항목만) */
  maxRatio: number;
}

export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  maxTotalBytes: 1024 * 1024 * 1024,
  maxFiles: 10_000,
  maxRatio: 200,
};

export type ArchiveIssue = 'unsafe-path' | 'bomb' | 'too-many-files';

export class ArchiveSafetyError extends Error {
  constructor(
    message: string,
    readonly issue: ArchiveIssue,
  ) {
    super(message);
    this.name = 'ArchiveSafetyError';
  }
}

/** 압축 안 이름이 풀 폴더 밖을 가리키는지 */
export function isUnsafeEntryName(name: string): boolean {
  const n = name.replace(/\\/g, '/');
  if (n.startsWith('/') || /^[a-zA-Z]:/.test(n) || n.includes('\0')) return true;
  return n.split('/').some((seg) => seg === '..');
}

export function checkArchive(
  entries: readonly ArchiveEntry[],
  l: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS,
): ArchiveIssue[] {
  const issues = new Set<ArchiveIssue>();
  if (entries.some((e) => isUnsafeEntryName(e.name))) issues.add('unsafe-path');
  const files = entries.filter((e) => !e.isDir);
  if (files.length > l.maxFiles) issues.add('too-many-files');
  const total = files.reduce((s, e) => s + e.size, 0);
  const ratioBomb = files.some(
    (e) =>
      e.compressedSize !== undefined &&
      e.size > 1024 * 1024 &&
      e.size / Math.max(1, e.compressedSize) > l.maxRatio,
  );
  if (total > l.maxTotalBytes || ratioBomb) issues.add('bomb');
  return [...issues];
}

const ISSUE_MESSAGE: Record<ArchiveIssue, string> = {
  'unsafe-path': MESSAGES.archiveUnsafePath,
  bomb: MESSAGES.archiveBomb,
  'too-many-files': MESSAGES.archiveTooMany,
};

// ── 목록 읽기 ──────────────────────────────────────────────────
export function listTar(buf: Buffer): ArchiveEntry[] {
  const out: ArchiveEntry[] = [];
  let i = 0;
  let longName: string | undefined;
  while (i + 512 <= buf.length) {
    const h = buf.subarray(i, i + 512);
    if (h.every((b) => b === 0)) break;
    const field = (a: number, n: number) =>
      h
        .subarray(a, a + n)
        .toString('utf8')
        .replace(/\0.*$/s, '');
    const size = parseInt(field(124, 12).trim() || '0', 8) || 0;
    const type = field(156, 1);
    const prefix = field(345, 155);
    let name = (prefix ? `${prefix}/` : '') + field(0, 100);
    if (longName) {
      name = longName;
      longName = undefined;
    }
    const body = i + 512;
    if (type === 'L')
      longName = buf
        .subarray(body, body + size)
        .toString('utf8')
        .replace(/\0.*$/s, '');
    else if (type !== 'x' && type !== 'g')
      out.push({ name, size, isDir: type === '5' || name.endsWith('/') });
    i = body + Math.ceil(size / 512) * 512;
  }
  return out;
}

function tarEntryData(buf: Buffer, wanted: string): Buffer | undefined {
  let i = 0;
  while (i + 512 <= buf.length) {
    const h = buf.subarray(i, i + 512);
    if (h.every((b) => b === 0)) break;
    const size =
      parseInt(h.subarray(124, 136).toString('latin1').replace(/\0.*$/s, '').trim() || '0', 8) || 0;
    const name = h.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    if (name === wanted) return buf.subarray(i + 512, i + 512 + size);
    i += 512 + Math.ceil(size / 512) * 512;
  }
  return undefined;
}

function gunzipLimited(buf: Buffer, max: number): Buffer {
  try {
    return gunzipSync(buf, { maxOutputLength: max });
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE')
      throw new ArchiveSafetyError(MESSAGES.archiveBomb, 'bomb');
    throw e;
  }
}

/** 7z -slt 목록 출력 → 항목 */
export function parse7zList(stdout: string): ArchiveEntry[] {
  const out: ArchiveEntry[] = [];
  for (const block of stdout.split(/\r?\n\r?\n/)) {
    const path = /^Path = (.*)$/m.exec(block)?.[1];
    if (!path || /^Type = /m.test(block)) continue;
    const size = Number(/^Size = (\d+)$/m.exec(block)?.[1] ?? 0);
    const packed = /^Packed Size = (\d+)$/m.exec(block)?.[1];
    out.push({
      name: path,
      size,
      ...(packed ? { compressedSize: Number(packed) } : {}),
      isDir: /^Folder = \+$/m.test(block),
    });
  }
  return out;
}

export async function listArchive(
  a: Pick<Attachment, 'mime' | 'storedPath'>,
  data: Buffer,
  tools?: ExternalTools,
  l: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS,
): Promise<ArchiveEntry[] | undefined> {
  if (a.mime === 'application/zip')
    return listZip(data).map((e) => ({
      name: e.name,
      size: e.size,
      compressedSize: e.compressedSize,
      isDir: e.isDir,
    }));
  if (a.mime === 'application/x-tar') return listTar(data);
  if (a.mime === 'application/gzip') {
    const inner = gunzipLimited(data, l.maxTotalBytes);
    if (inner.subarray(257, 262).toString('latin1') === 'ustar') return listTar(inner);
    return [{ name: 'gzip 안 파일', size: inner.length, compressedSize: data.length, isDir: false }];
  }
  const bin = tools?.which('7z') ?? tools?.which('7za');
  if (!bin) return undefined;
  const r = await tools!.run(bin, ['l', '-slt', '--', a.storedPath]);
  return r.code === 0 ? parse7zList(r.stdout.toString('utf8')) : undefined;
}

export function renderListing(entries: readonly ArchiveEntry[]): string {
  const files = entries.filter((e) => !e.isDir);
  const total = files.reduce((s, e) => s + e.size, 0);
  return [
    `파일 ${files.length}개, 풀면 ${total} bytes`,
    '',
    ...entries.map((e) => `- ${e.name}${e.isDir ? '' : ` (${e.size} bytes)`}`),
  ].join('\n');
}

export const convertArchive: Converter = async (a, data, ctx) => {
  const warnings: AttachmentWarning[] = [];
  let entries: ArchiveEntry[] | undefined;
  try {
    entries = await listArchive(a, data, ctx.tools);
  } catch (e) {
    if (e instanceof ArchiveSafetyError) return { representations: [], warnings: [warn(e.issue, e.message)] };
    if (e instanceof ZipError) entries = undefined;
    else throw e;
  }
  if (!entries) {
    if (a.mime !== 'application/zip') ctx.onToolNeeded?.({ ...TOOL_NEEDS['7z'] });
    return {
      representations: [],
      warnings: [warn('tool-needed', MESSAGES.archiveNeedsTool, TOOL_NEEDS['7z'].capability)],
    };
  }
  warnings.push(warn('list-only', MESSAGES.archiveListOnly));
  for (const issue of checkArchive(entries)) warnings.push(warn(issue, ISSUE_MESSAGE[issue]));
  return {
    representations: [writeRep(ctx, 'listing', 'listing.md', renderListing(entries) + '\n', 'text/markdown')],
    warnings,
  };
};

// ── 요청 시 풀기 ────────────────────────────────────────────────
/**
 * 사용자가 풀어 달라고 했을 때만. 문제가 하나라도 있으면 아무것도 쓰지 않고 ArchiveSafetyError.
 * 적힌 크기를 믿지 않고 실제로 풀리는 양도 남은 한도로 막는다.
 */
export function extractArchive(
  a: Pick<Attachment, 'mime' | 'storedPath'>,
  dest: string,
  l: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS,
): string[] {
  const data = readFileSync(a.storedPath);
  let tarBuf: Buffer | undefined;
  let entries: ArchiveEntry[];
  if (a.mime === 'application/zip')
    entries = listZip(data).map((e) => ({
      name: e.name,
      size: e.size,
      compressedSize: e.compressedSize,
      isDir: e.isDir,
    }));
  else if (a.mime === 'application/x-tar' || a.mime === 'application/gzip') {
    tarBuf = a.mime === 'application/gzip' ? gunzipLimited(data, l.maxTotalBytes) : data;
    entries = listTar(tarBuf);
  } else throw new ArchiveSafetyError(MESSAGES.archiveNeedsTool, 'unsafe-path');
  const issues = checkArchive(entries, l);
  if (issues.length) throw new ArchiveSafetyError(ISSUE_MESSAGE[issues[0]!], issues[0]!);
  const root = resolve(dest);
  const written: string[] = [];
  let budget = l.maxTotalBytes;
  const zipEntries = a.mime === 'application/zip' ? listZip(data) : [];
  for (const e of entries) {
    const target = resolve(root, e.name);
    const rel = relative(root, target);
    if (rel.startsWith('..') || isAbsolute(rel))
      throw new ArchiveSafetyError(MESSAGES.archiveUnsafePath, 'unsafe-path');
    if (e.isDir) {
      mkdirSync(target, { recursive: true });
      continue;
    }
    let body: Buffer;
    try {
      body = tarBuf
        ? tarEntryData(tarBuf, e.name)!
        : readZipEntry(
            data,
            zipEntries.find((z) => z.name === e.name)!,
            budget,
          );
    } catch (err) {
      if (err instanceof ZipError && err.code === 'too-large')
        throw new ArchiveSafetyError(MESSAGES.archiveBomb, 'bomb');
      throw err;
    }
    budget -= body.length;
    if (budget < 0) throw new ArchiveSafetyError(MESSAGES.archiveBomb, 'bomb');
    mkdirSync(dirname(target), { recursive: true });
    writeAtomic(target, body);
    written.push(join(rel));
  }
  return written;
}
