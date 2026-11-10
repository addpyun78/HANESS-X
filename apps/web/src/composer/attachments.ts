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

/** 붙여넣기에서는 이미지 파일만 첨부로 받는다 (텍스트는 그대로 입력) */
export function imagesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return [];
  const out: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const f = item.getAsFile();
      if (f) out.push(f);
    }
  }
  if (out.length === 0)
    for (const f of Array.from(data.files ?? [])) if (f.type.startsWith('image/')) out.push(f);
  return out;
}

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
