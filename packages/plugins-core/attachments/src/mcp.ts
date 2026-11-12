import { readFileSync, statSync } from 'node:fs';
import type { AgentTool } from '@harness-x/kernel';
import { representation, type Attachment, type RepresentationForm } from '@harness-x/protocol';
import { listAttachmentsIn } from './store.js';

/**
 * T-101 1D.6 MCP 도구 attachments.list() / attachments.read(id, form, range) — 모든 엔진·모든 에이전트 단계 공통.
 * MCP를 못 쓰는 API 엔진(하네스 자체 도구 루프)에는 같은 내용을 attachments_list / attachments_read 도구로 준다.
 * 큰 파일은 부분 읽기(offset·length). 실행은 하지 않고 읽기만 한다.
 */

export const ATTACHMENT_TOOL_NAMES = ['attachments.list', 'attachments.read'] as const;

/** 한 번에 돌려주는 최대 글자 수 / 바이트 수 */
export const READ_DEFAULT_LENGTH = 64 * 1024;
export const READ_MAX_LENGTH = 256 * 1024;

export interface AttachmentSummary {
  id: string;
  name: string;
  kind: Attachment['kind'];
  mime: string;
  sizeBytes: number;
  status: Attachment['status'];
  /** 읽을 수 있는 형태 */
  forms: RepresentationForm[];
  /** 쉬운 말 안내 */
  notes: string[];
}

export interface ReadArgs {
  id: string;
  /** 기본: 글 형태 (가린 글 → 글 → 받아쓰기 → 목록), 없으면 원본 */
  form?: RepresentationForm;
  /** 페이지·장면 그림 순번 (1부터) */
  index?: number;
  /** 글이면 글자 위치, 그 밖은 바이트 위치 */
  offset?: number;
  length?: number;
}

export interface ReadResult {
  id: string;
  form: RepresentationForm;
  mime: string;
  offset: number;
  length: number;
  total: number;
  /** 더 읽을 게 있으면 다음 offset */
  nextOffset?: number;
  text?: string;
  /** 글이 아니면 base64 */
  base64?: string;
}

/** @harness-x/mcp-host의 AttachmentsToolsProvider와 같은 모양 */
export interface AttachmentsToolsProvider {
  list(): AttachmentSummary[];
  read(args: ReadArgs): ReadResult;
}

export class AttachmentToolError extends Error {
  constructor(
    message: string,
    readonly code: 'NOT_FOUND' | 'NO_FORM',
  ) {
    super(message);
    this.name = 'AttachmentToolError';
  }
}

const TEXT_FORMS: RepresentationForm[] = ['masked-text', 'text', 'transcript', 'listing'];
const isTextMime = (m: string) => /^text\/|json|xml|yaml|markdown/.test(m);

export function summarize(a: Attachment): AttachmentSummary {
  return {
    id: a.id,
    name: a.originalName,
    kind: a.kind,
    mime: a.mime,
    sizeBytes: a.sizeBytes,
    status: a.status,
    forms: ['original', ...new Set(a.representations.map((r) => r.form))],
    notes: a.warnings.map((w) => w.message),
  };
}

export function readAttachment(a: Attachment, args: ReadArgs): ReadResult {
  const masked = representation(a, 'masked-text');
  const original = { form: 'original' as RepresentationForm, path: a.storedPath, mime: a.mime };
  let src: { form: RepresentationForm; path: string; mime: string };
  if (args.form && args.form !== 'original') {
    // 비밀을 가린 첨부는 글 형태를 물어도 가린 글만 준다
    const want = masked && (args.form === 'text' || args.form === 'transcript') ? 'masked-text' : args.form;
    const reps = a.representations.filter((r) => r.form === want);
    const rep = args.index ? reps.find((r) => r.index === args.index) : reps[0];
    if (!rep) throw new AttachmentToolError(`${a.originalName}에는 ${args.form} 형태가 없어요`, 'NO_FORM');
    src = rep;
  } else if (!args.form) {
    src = TEXT_FORMS.map((f) => representation(a, f)).find((r) => r !== undefined) ?? original;
  } else {
    // 원본: 가린 글이 있으면 원본은 주지 않는다
    src = masked ?? original;
  }
  const { form, path, mime } = src;
  const offset = Math.max(0, Math.floor(args.offset ?? 0));
  const length = Math.min(READ_MAX_LENGTH, Math.max(1, Math.floor(args.length ?? READ_DEFAULT_LENGTH)));
  if (isTextMime(mime)) {
    const text = readFileSync(path, 'utf8');
    const part = text.slice(offset, offset + length);
    const end = offset + part.length;
    return {
      id: a.id,
      form,
      mime,
      offset,
      length: part.length,
      total: text.length,
      ...(end < text.length ? { nextOffset: end } : {}),
      text: part,
    };
  }
  const buf = readFileSync(path);
  const part = buf.subarray(offset, offset + length);
  const end = offset + part.length;
  return {
    id: a.id,
    form,
    mime,
    offset,
    length: part.length,
    total: statSync(path).size,
    ...(end < buf.length ? { nextOffset: end } : {}),
    base64: part.toString('base64'),
  };
}

/** 세션 첨부 폴더(<프로젝트>/.harness-x/attachments/<세션>)를 읽는 제공자 — 매번 새로 읽어 최신 상태 */
export function attachmentsProvider(sessionDir: string): AttachmentsToolsProvider {
  const find = (id: string) => {
    const a = listAttachmentsIn(sessionDir).find((x) => x.id === id);
    if (!a) throw new AttachmentToolError(`첨부를 찾지 못했어요: ${id}`, 'NOT_FOUND');
    return a;
  };
  return {
    list: () => listAttachmentsIn(sessionDir).map(summarize),
    read: (args) => readAttachment(find(args.id), args),
  };
}

/** MCP를 못 쓰는 API 엔진용 도구 (이름에 점 대신 밑줄) */
export function attachmentAgentTools(p: AttachmentsToolsProvider): AgentTool[] {
  return [
    {
      name: 'attachments_list',
      description: '사용자가 이 세션에 첨부한 파일 목록(id·이름·종류·읽을 수 있는 형태)을 돌려준다.',
      parameters: { type: 'object', properties: {} },
      run: () => ({ attachments: p.list() }),
    },
    {
      name: 'attachments_read',
      description:
        '첨부 파일 내용을 읽는다. form 기본은 글 형태. 큰 파일은 offset·length로 나눠 읽고 nextOffset이 있으면 이어 읽는다. 실행하지 않는다.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          form: {
            type: 'string',
            enum: [
              'original',
              'text',
              'thumbnail',
              'page-image',
              'frame',
              'transcript',
              'listing',
              'masked-text',
            ],
          },
          index: { type: 'integer', minimum: 1 },
          offset: { type: 'integer', minimum: 0 },
          length: { type: 'integer', minimum: 1, maximum: READ_MAX_LENGTH },
        },
        required: ['id'],
      },
      run: (input) => p.read(input as ReadArgs),
    },
  ];
}
