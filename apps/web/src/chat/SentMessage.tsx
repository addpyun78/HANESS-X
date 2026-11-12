import { KIND_ICON, chipKind, formatSize } from '../composer/attachments.js';

/** 보낸 메시지에 남기는 첨부 기록 (파일 내용은 넣지 않는다) */
export interface SentAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  /** 그림 썸네일 주소 (서버 축소본 또는 브라우저 object URL) */
  thumbUrl?: string;
}

/**
 * T-101 1E.6 보낸 메시지: 글 + 첨부 썸네일·이름.
 * 그림은 썸네일, 나머지는 종류 아이콘 + 이름·크기.
 */
export function SentMessage({ text, attachments }: { text: string; attachments: readonly SentAttachment[] }) {
  return (
    <div className="hx-sent" data-testid="sent-message">
      {attachments.length > 0 && (
        <ul className="hx-sent__attachments" aria-label="보낸 첨부">
          {attachments.map((a) => {
            const kind = chipKind(a);
            return (
              <li key={a.id} className="hx-sent__attachment" data-kind={kind}>
                {kind === 'image' && a.thumbUrl ? (
                  <img className="hx-sent__thumb" src={a.thumbUrl} alt={a.name} width={64} height={64} />
                ) : (
                  <span className="hx-sent__icon" aria-hidden="true">
                    {KIND_ICON[kind]}
                  </span>
                )}
                <span className="hx-sent__name">{a.name}</span>
                <span className="hx-sent__size">{formatSize(a.size)}</span>
              </li>
            );
          })}
        </ul>
      )}
      {text && <p className="hx-sent__text">{text}</p>}
    </div>
  );
}

/** 입력창 첨부 → 보낸 메시지 기록 (그림은 미리 만든 주소를 쓴다) */
export function toSentAttachments(
  list: readonly { id: string; name: string; mime: string; size: number; file?: File; previewUrl?: string }[],
  makeUrl: (f: File) => string | undefined = (f) =>
    typeof URL.createObjectURL === 'function' ? URL.createObjectURL(f) : undefined,
): SentAttachment[] {
  return list.map((a) => {
    const thumb = a.previewUrl ?? (a.mime.startsWith('image/') && a.file ? makeUrl(a.file) : undefined);
    return { id: a.id, name: a.name, mime: a.mime, size: a.size, ...(thumb ? { thumbUrl: thumb } : {}) };
  });
}
