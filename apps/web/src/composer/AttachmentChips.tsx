import { useEffect, useState } from 'react';
import { act } from '../actions/registry.js';
import { KIND_ICON, STATUS_LABEL, chipKind, formatSize } from './attachments.js';
import type { Attachment } from './types.js';

/** 글 미리보기 앞부분 길이 */
export const PREVIEW_TEXT_CHARS = 400;

function useObjectUrl(file: File | undefined, on: boolean): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!on || !file || typeof URL.createObjectURL !== 'function') return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL?.(u);
  }, [file, on]);
  return url;
}

/** 칩을 누르면 뜨는 미리보기: 그림 / 글 앞부분 / PDF 첫 장 */
export function AttachmentPreview({ a }: { a: Attachment }) {
  const kind = chipKind(a);
  const url = useObjectUrl(a.file, !a.previewUrl && (kind === 'image' || kind === 'pdf'));
  const [text, setText] = useState<string>();
  useEffect(() => {
    if (kind !== 'text') return;
    let live = true;
    void a.file
      .slice(0, PREVIEW_TEXT_CHARS * 4)
      .text()
      .then((t) => live && setText(t.slice(0, PREVIEW_TEXT_CHARS)));
    return () => {
      live = false;
    };
  }, [a.file, kind]);
  const src = a.previewUrl ?? url;
  return (
    <div className="hx-attachment-preview" role="dialog" aria-label={`${a.name} 내용 보기`}>
      {kind === 'image' && src && <img src={src} alt={a.name} />}
      {kind === 'pdf' &&
        (a.previewUrl ? (
          <img src={a.previewUrl} alt={`${a.name} 첫 장`} />
        ) : src ? (
          <object data={`${src}#page=1`} type="application/pdf" aria-label={`${a.name} 첫 장`} />
        ) : null)}
      {kind === 'text' && <pre className="hx-attachment-preview__text">{text ?? '읽는 중…'}</pre>}
      {kind !== 'image' && kind !== 'pdf' && kind !== 'text' && (
        <p className="hx-attachment-preview__meta">
          {a.name} · {formatSize(a.size)} · {a.mime}
        </p>
      )}
      {a.warning && <p className="hx-attachment-preview__warn">{a.warning}</p>}
    </div>
  );
}

/**
 * T-101 1E.4 첨부 칩: 종류 아이콘·이름·크기·상태(바꾸는 중…/✓/⚠)·×, 누르면 미리보기.
 */
export function AttachmentChips({
  attachments,
  onRemove,
}: {
  attachments: readonly Attachment[];
  onRemove: (id: string) => void;
}) {
  const [open, setOpen] = useState<string>();
  if (attachments.length === 0) return null;
  const opened = attachments.find((a) => a.id === open);
  return (
    <div className="hx-attachments-wrap">
      <ul className="hx-attachments" aria-label="첨부 파일">
        {attachments.map((a) => {
          const kind = chipKind(a);
          return (
            <li key={a.id} className="hx-attachment" data-kind={kind} data-status={a.status}>
              <button
                {...act('composer.attachment-preview')}
                type="button"
                className="hx-attachment__open"
                aria-label={`${a.name} 미리보기`}
                aria-expanded={open === a.id}
                onClick={() => setOpen((cur) => (cur === a.id ? undefined : a.id))}
              >
                <span aria-hidden="true">{KIND_ICON[kind]}</span>
                <span className="hx-attachment__name">{a.name}</span>
              </button>
              <span className="hx-attachment__size">{formatSize(a.size)}</span>
              {a.status && (
                <span
                  className="hx-attachment__status"
                  data-status={a.status}
                  {...(a.status === 'failed' && a.warning ? { title: a.warning } : {})}
                >
                  {STATUS_LABEL[a.status]}
                </span>
              )}
              <button
                {...act('composer.remove-attachment')}
                type="button"
                className="hx-attachment__remove"
                aria-label={`${a.name} 첨부 빼기`}
                onClick={() => {
                  if (open === a.id) setOpen(undefined);
                  onRemove(a.id);
                }}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
      {opened && <AttachmentPreview a={opened} />}
    </div>
  );
}
