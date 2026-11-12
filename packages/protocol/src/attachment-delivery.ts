import { z } from 'zod';
import {
  representation,
  type Attachment,
  type Representation,
  type RepresentationForm,
} from './attachment.js';

/**
 * T-101 1D 어떤 AI·에이전트든 전달: 엔진 입력 능력 + 전달 방식 선택기 + 프롬프트 첨부 목록.
 * 엔진 어댑터가 실행할 때마다 자기 능력으로 고르므로, 엔진이 바뀌면(폴백·재개) 새 방식으로 다시 전달된다.
 */

// ── 1D.1 엔진 입력 능력 ──────────────────────────────────────────

/** AI가 직접 받을 수 있는 입력 (5번 모델 목록이 이 값을 그대로 씀) */
export const EngineInputsSchema = z
  .object({
    image: z.boolean(),
    pdf: z.boolean(),
    audio: z.boolean(),
    /** 그림 한 장 최대 크기 (MB). 넘으면 축소본 */
    maxImageMB: z.number().nonnegative(),
  })
  .strict();
export type EngineInputs = z.infer<typeof EngineInputsSchema>;

/** 글만 받는 AI */
export const TEXT_ONLY_INPUTS: EngineInputs = Object.freeze({
  image: false,
  pdf: false,
  audio: false,
  maxImageMB: 0,
});

/** 엔진(+모델)의 입력 능력: inputsFor(model) → capabilities.inputs → 글만 */
export function engineInputs(
  engine: { capabilities: { inputs?: EngineInputs }; inputsFor?(model?: string): EngineInputs },
  model?: string,
): EngineInputs {
  return engine.inputsFor?.(model) ?? engine.capabilities.inputs ?? TEXT_ONLY_INPUTS;
}

// ── 1D.2 전달 방식 선택기 ────────────────────────────────────────

export type DeliveryMode = 'native' | 'text' | 'meta';

export interface AttachmentDelivery {
  attachment: Attachment;
  mode: DeliveryMode;
  /** native: AI에게 직접 줄 파일 (원본 또는 축소본) / text: 글 형태 파일 */
  path?: string;
  mime?: string;
  /** native 그림·PDF 종류 */
  as?: 'image' | 'pdf' | 'audio';
  /** 쉬운 말 안내 (예: 이 AI는 그림을 직접 못 봐요 → 글로 바꿔서 보낼게요) */
  note?: string;
}

const MB = 1024 * 1024;

/** 글 형태 우선순위: 비밀을 가린 글 → 글 → 받아쓰기 → 목록 */
const TEXT_FORMS: RepresentationForm[] = ['masked-text', 'text', 'transcript', 'listing'];

function textRep(a: Attachment): Representation | undefined {
  for (const f of TEXT_FORMS) {
    const r = representation(a, f);
    if (r) return r;
  }
  return undefined;
}

export const DELIVERY_NOTES = {
  imageAsText: '이 AI는 그림을 직접 못 봐요 → 글로 바꿔서 보낼게요.',
  pdfAsText: '이 AI는 PDF를 직접 못 읽어요 → 글로 바꿔서 보낼게요.',
  audioAsText: '이 AI는 소리를 직접 못 들어요 → 받아쓴 글로 보낼게요.',
  metaOnly: '내용은 읽을 수 없어요. 이름과 크기만 알려 줄게요.',
  imageMeta: '이 AI는 그림을 직접 못 봐요. 이름과 크기만 알려 줄게요.',
  thumbnail: '그림이 커서 줄인 그림으로 보낼게요.',
} as const;

/**
 * AI가 직접 받을 수 있으면 원본(그림 등) → 아니면 글 형태 → 아니면 이름·크기만 + 안내.
 * 비밀을 가린 글이 있으면(1C.2 가리고 보내기) 원본 대신 늘 그 글을 보낸다.
 */
export function planDelivery(a: Attachment, inputs: EngineInputs): AttachmentDelivery {
  const masked = representation(a, 'masked-text');
  if (masked) return { attachment: a, mode: 'text', path: masked.path, mime: masked.mime };
  const nativeAs =
    a.kind === 'image' && inputs.image
      ? 'image'
      : a.kind === 'pdf' && inputs.pdf
        ? 'pdf'
        : a.kind === 'audio' && inputs.audio
          ? 'audio'
          : undefined;
  if (nativeAs) {
    if (nativeAs === 'image' && inputs.maxImageMB > 0 && a.sizeBytes > inputs.maxImageMB * MB) {
      const thumb = representation(a, 'thumbnail');
      if (thumb && thumb.sizeBytes <= inputs.maxImageMB * MB)
        return {
          attachment: a,
          mode: 'native',
          as: 'image',
          path: thumb.path,
          mime: thumb.mime,
          note: DELIVERY_NOTES.thumbnail,
        };
    } else return { attachment: a, mode: 'native', as: nativeAs, path: a.storedPath, mime: a.mime };
  }
  const t = textRep(a);
  const note =
    a.kind === 'image'
      ? DELIVERY_NOTES.imageAsText
      : a.kind === 'pdf'
        ? DELIVERY_NOTES.pdfAsText
        : a.kind === 'audio'
          ? DELIVERY_NOTES.audioAsText
          : undefined;
  if (t) return { attachment: a, mode: 'text', path: t.path, mime: t.mime, ...(note ? { note } : {}) };
  return {
    attachment: a,
    mode: 'meta',
    note: a.kind === 'image' ? DELIVERY_NOTES.imageMeta : DELIVERY_NOTES.metaOnly,
  };
}

export function planDeliveries(list: readonly Attachment[], inputs: EngineInputs): AttachmentDelivery[] {
  return list.map((a) => planDelivery(a, inputs));
}

// ── 1D.3 프롬프트에 넣는 첨부 목록 ───────────────────────────────

const MODE_LABEL: Record<DeliveryMode, string> = {
  native: '직접 전달',
  text: '글 형태',
  meta: '이름·크기만',
};

/** 프롬프트 끝에 붙이는 첨부 목록 (이름·종류·원본 경로·글 형태 경로). hint = 엔진별 읽는 방법 */
export function renderAttachmentList(ds: readonly AttachmentDelivery[], hint?: string): string {
  if (ds.length === 0) return '';
  const lines = [
    '## 첨부 파일',
    '사용자가 첨부한 파일이에요. 원본은 실행하지 말고 내용만 보세요. 더 읽으려면 attachments.read 도구를 쓰세요.',
    ...(hint ? [hint] : []),
  ];
  for (const d of ds) {
    const a = d.attachment;
    const text = textRep(a);
    const parts = [
      `- ${a.originalName} (id ${a.id}, 종류 ${a.kind}, ${a.sizeBytes} bytes, ${MODE_LABEL[d.mode]})`,
      `  - 원본: ${a.storedPath}`,
    ];
    if (text) parts.push(`  - 글 형태: ${text.path}`);
    if (d.mode === 'native' && d.path && d.path !== a.storedPath) parts.push(`  - 보낸 그림: ${d.path}`);
    for (const r of a.representations.filter((x) => x.form === 'page-image' || x.form === 'frame'))
      parts.push(`  - ${r.form === 'frame' ? '장면' : '페이지'} 그림 ${r.index ?? ''}: ${r.path}`);
    if (d.note) parts.push(`  - 안내: ${d.note}`);
    for (const w of a.warnings) parts.push(`  - 안내: ${w.message}`);
    lines.push(...parts);
  }
  return lines.join('\n');
}

/** 프롬프트 + 첨부 목록 */
export function promptWithAttachments(
  prompt: string,
  ds: readonly AttachmentDelivery[],
  hint?: string,
): string {
  const list = renderAttachmentList(ds, hint);
  return list ? `${prompt}\n\n${list}` : prompt;
}

export interface CliDelivery {
  prompt: string;
  /** 그림 직접 입력 옵션(codex --image 등)으로 넘길 그림 경로 */
  images: string[];
  deliveries: AttachmentDelivery[];
}

/**
 * 1D.3 CLI 엔진: 프롬프트에 첨부 목록을 넣고, 그림 직접 입력 옵션이 있는 엔진은 그림 경로를 따로 돌려준다.
 * 첨부가 없으면 프롬프트를 그대로 둔다.
 */
export function deliverToCli(
  prompt: string,
  attachments: readonly Attachment[] | undefined,
  inputs: EngineInputs,
  o: { imageFlag?: boolean; hint?: string } = {},
): CliDelivery {
  if (!attachments?.length) return { prompt, images: [], deliveries: [] };
  const deliveries = planDeliveries(attachments, inputs);
  const images = o.imageFlag
    ? deliveries.filter((d) => d.mode === 'native' && d.as === 'image' && d.path).map((d) => d.path!)
    : [];
  return { prompt: promptWithAttachments(prompt, deliveries, o.hint), images, deliveries };
}

// ── 1D.7 에이전트 단계 입력 ──────────────────────────────────────

/** 노드 입력 값에 넣는 첨부 목록 (값 그대로 프롬프트에 들어가므로 내용은 넣지 않는다) */
export interface AttachmentRef {
  id: string;
  name: string;
  kind: Attachment['kind'];
  mime: string;
  sizeBytes: number;
  path: string;
  textPath?: string;
}

export function attachmentRefs(list: readonly Attachment[]): AttachmentRef[] {
  return list.map((a) => {
    const t = textRep(a);
    return {
      id: a.id,
      name: a.originalName,
      kind: a.kind,
      mime: a.mime,
      sizeBytes: a.sizeBytes,
      path: a.storedPath,
      ...(t ? { textPath: t.path } : {}),
    };
  });
}

/** 노드 inputSchema에 넣는 attachments 필드 모양 */
export const ATTACHMENTS_FIELD_SCHEMA: Record<string, unknown> = {
  type: 'array',
  description: '세션 첨부 목록 (내용은 attachments.read 도구로 읽기)',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      kind: { type: 'string' },
      mime: { type: 'string' },
      sizeBytes: { type: 'number' },
      path: { type: 'string' },
      textPath: { type: 'string' },
    },
    required: ['id', 'name', 'kind', 'path'],
  },
};
