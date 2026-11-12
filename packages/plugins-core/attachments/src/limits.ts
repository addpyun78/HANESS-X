import { z } from 'zod';
import { MESSAGES } from './messages.js';

/**
 * 1A.5 크기 한도 (설정): 파일당 200MB, 한 번에 1GB 기본.
 * 설정 등록 틀(0-1)이 생기면 ATTACHMENT_SETTINGS를 그대로 등록한다.
 */

export const AttachmentLimitsSchema = z
  .object({
    maxFileMB: z.number().positive().default(200),
    maxBatchMB: z.number().positive().default(1024),
    /** 동시에 형태를 바꾸는 작업 수 */
    concurrency: z.number().int().min(1).max(8).default(2),
    /** 폴더를 놓았을 때 이보다 많으면 묻는다 */
    folderConfirmOver: z.number().int().positive().default(50),
  })
  .strict();
export type AttachmentLimits = z.infer<typeof AttachmentLimitsSchema>;

/** 설정 화면에 올릴 값 (키 · 기본값 · 쉬운 말 설명) */
export const ATTACHMENT_SETTINGS = [
  { key: 'attachments.maxFileMB', default: 200, label: '한 파일 최대 크기(MB)' },
  { key: 'attachments.maxBatchMB', default: 1024, label: '한 번에 넣는 최대 크기(MB)' },
  { key: 'attachments.concurrency', default: 2, label: '동시에 바꾸는 파일 수' },
  { key: 'attachments.folderConfirmOver', default: 50, label: '폴더 파일이 이보다 많으면 묻기' },
] as const;

export function resolveLimits(p: Partial<AttachmentLimits> = {}): AttachmentLimits {
  return AttachmentLimitsSchema.parse(p);
}

const MB = 1024 * 1024;

export class AttachmentLimitError extends Error {
  constructor(
    message: string,
    readonly code: 'file-too-big' | 'batch-too-big',
    readonly limitMB: number,
  ) {
    super(message);
    this.name = 'AttachmentLimitError';
  }
}

export function checkFileLimit(sizeBytes: number, l: AttachmentLimits): void {
  if (sizeBytes > l.maxFileMB * MB)
    throw new AttachmentLimitError(MESSAGES.fileTooBig(l.maxFileMB), 'file-too-big', l.maxFileMB);
}

export function checkBatchLimit(sizes: readonly number[], l: AttachmentLimits): void {
  for (const s of sizes) checkFileLimit(s, l);
  const total = sizes.reduce((a, b) => a + b, 0);
  if (total > l.maxBatchMB * MB)
    throw new AttachmentLimitError(MESSAGES.batchTooBig(l.maxBatchMB), 'batch-too-big', l.maxBatchMB);
}
