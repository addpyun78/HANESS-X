import { z } from 'zod';

/**
 * T-101 1. 입력창 첨부 — 엔진·MCP·화면이 함께 쓰는 첨부 모양.
 * 하네스가 첨부를 먼저 받아 여러 형태(원본·글·그림)로 바꿔 두고, 각 AI가 받을 수 있는 형태로 골라 전달한다.
 */

export const ATTACHMENT_KINDS = [
  'text',
  'pdf',
  'docx',
  'pptx',
  'xlsx',
  'hwpx',
  'hwp',
  'image',
  'audio',
  'video',
  'archive',
  'folder',
  'executable',
  'unknown',
] as const;
export const AttachmentKindSchema = z.enum(ATTACHMENT_KINDS);
export type AttachmentKind = z.infer<typeof AttachmentKindSchema>;

/** 바꿔 둔 형태 */
export const REPRESENTATION_FORMS = [
  /** 받은 그대로 (그림은 위치정보를 지운 것) */
  'original',
  /** 글 (UTF-8 Markdown·평문) */
  'text',
  /** 긴 변 2000px 축소본 */
  'thumbnail',
  /** PDF 페이지 그림 */
  'page-image',
  /** 동영상 장면 그림 */
  'frame',
  /** 소리 받아쓰기 */
  'transcript',
  /** 압축·폴더 안 파일 목록 */
  'listing',
  /** 비밀을 가린 글 */
  'masked-text',
] as const;
export const RepresentationFormSchema = z.enum(REPRESENTATION_FORMS);
export type RepresentationForm = z.infer<typeof RepresentationFormSchema>;

export const RepresentationSchema = z
  .object({
    form: RepresentationFormSchema,
    /** 절대 경로 (프로젝트 폴더 안) */
    path: z.string().min(1),
    mime: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    /** 여러 장일 때 순번 (1부터) */
    index: z.number().int().positive().optional(),
  })
  .strict();
export type Representation = z.infer<typeof RepresentationSchema>;

export const AttachmentWarningSchema = z
  .object({
    /** 예: scanned-pdf, tool-needed, exif-removed, secret-found, not-executed, too-many-files */
    code: z.string().min(1),
    /** 쉬운 말 안내 */
    message: z.string().min(1),
    /** tool-needed일 때 도구 찾기 카드에 넘길 능력 설명 */
    capability: z.string().optional(),
  })
  .strict();
export type AttachmentWarning = z.infer<typeof AttachmentWarningSchema>;

export const ATTACHMENT_STATUSES = ['converting', 'ready', 'failed'] as const;

export const AttachmentSchema = z
  .object({
    /** att_<sha256 앞 12자> */
    id: z.string().regex(/^att_[0-9a-f]{12}$/),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    originalName: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    mime: z.string().min(1),
    kind: AttachmentKindSchema,
    /** 원본 저장 경로 (절대 경로) */
    storedPath: z.string().min(1),
    representations: z.array(RepresentationSchema),
    warnings: z.array(AttachmentWarningSchema),
    /** 형태 바꾸기 진행 상태 (칩 표시) */
    status: z.enum(ATTACHMENT_STATUSES).default('converting'),
    sessionId: z.string().min(1).optional(),
    createdAt: z.string().optional(),
  })
  .strict();
export type Attachment = z.infer<typeof AttachmentSchema>;
export type AttachmentInput = z.input<typeof AttachmentSchema>;

export function parseAttachment(v: unknown): Attachment {
  return AttachmentSchema.parse(v);
}

export function attachmentId(sha256: string): string {
  return `att_${sha256.slice(0, 12)}`;
}

export function representation(a: Pick<Attachment, 'representations'>, form: RepresentationForm) {
  return a.representations.find((r) => r.form === form);
}
