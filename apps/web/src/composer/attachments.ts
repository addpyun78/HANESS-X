import { DELIVERY_NOTES, type EngineInputs } from '@harness-x/protocol';
import type { Attachment } from './types.js';

let seq = 0;

export function toAttachments(files: Iterable<File>, source: Attachment['source']): Attachment[] {
  return [...files].map((file) => ({
    id: `att-${Date.now().toString(36)}-${++seq}`,
    name:
      file.name ||
      (file.type.startsWith('image/') ? `붙여넣은 이미지.${file.type.slice(6) || 'png'}` : '파일'),
    mime: file.type || 'application/octet-stream',
    size: file.size,
    source,
    file,
  }));
}

/**
 * T-101 1E.2 붙여넣기(Ctrl+V): 이미지뿐 아니라 파일도 첨부로 받는다 (글은 그대로 입력).
 * 탐색기에서 복사한 파일은 items(kind=file) 또는 files로 들어온다.
 */
export function filesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return [];
  const out: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === 'file') {
      const f = item.getAsFile();
      if (f) out.push(f);
    }
  }
  if (out.length === 0) for (const f of Array.from(data.files ?? [])) out.push(f);
  return out;
}

/** 붙여넣기에서 이미지 파일만 (예전 이름 유지) */
export function imagesFromClipboard(data: DataTransfer | null): File[] {
  return filesFromClipboard(data).filter((f) => f.type.startsWith('image/'));
}

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// ── 1E.4 칩 종류 아이콘 ───────────────────────────────────────────

export type ChipKind =
  'image' | 'pdf' | 'text' | 'doc' | 'sheet' | 'slide' | 'hwp' | 'audio' | 'video' | 'archive' | 'other';

export const KIND_ICON: Record<ChipKind, string> = {
  image: '🖼',
  pdf: '📕',
  text: '📄',
  doc: '📝',
  sheet: '📊',
  slide: '📽',
  hwp: '📄',
  audio: '🎵',
  video: '🎬',
  archive: '🗜',
  other: '📎',
};

/** 화면 표시용 종류 (정확한 종류는 서버가 내용으로 다시 본다) */
export function chipKind(a: Pick<Attachment, 'mime' | 'name'>): ChipKind {
  const m = a.mime;
  const ext = a.name.toLowerCase().split('.').pop() ?? '';
  if (m.startsWith('image/')) return 'image';
  if (m === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('video/')) return 'video';
  if (ext === 'hwp' || ext === 'hwpx') return 'hwp';
  if (ext === 'docx' || ext === 'doc') return 'doc';
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') return 'sheet';
  if (ext === 'pptx' || ext === 'ppt') return 'slide';
  if (/zip|tar|gzip|7z|rar/.test(m) || ['zip', 'tar', 'gz', 'tgz', '7z', 'rar'].includes(ext))
    return 'archive';
  if (m.startsWith('text/') || /json|xml|yaml/.test(m)) return 'text';
  return 'other';
}

export const STATUS_LABEL = {
  converting: '바꾸는 중…',
  ready: '✓',
  failed: '⚠',
} as const;

// ── 1E.5 선택된 AI 기준 안내 ──────────────────────────────────────

/** 지금 고른 AI가 첨부를 직접 못 받으면 쉬운 말 안내 (능력을 모르면 안내 없음) */
export function attachmentHints(
  attachments: readonly Pick<Attachment, 'mime' | 'name'>[],
  inputs: Pick<EngineInputs, 'image' | 'pdf' | 'audio'> | undefined,
): string[] {
  if (!inputs || attachments.length === 0) return [];
  const kinds = new Set(attachments.map(chipKind));
  const out: string[] = [];
  if (kinds.has('image') && !inputs.image) out.push(DELIVERY_NOTES.imageAsText);
  if (kinds.has('pdf') && !inputs.pdf) out.push(DELIVERY_NOTES.pdfAsText);
  if (kinds.has('audio') && !inputs.audio) out.push(DELIVERY_NOTES.audioAsText);
  return out;
}
