import { useEffect, useRef, useState } from 'react';

/** 최근 프로젝트 한 줄 (커널 GET /api/workspaces 응답) */
export interface RecentProject {
  name: string;
  path: string;
  branch?: string;
  pinned?: boolean;
}

export interface PlusMenuProps {
  /** 모바일(·Tauri 모바일): 폴더 대화상자가 없으므로 최근 프로젝트 목록만 */
  mobile?: boolean;
  recent: RecentProject[];
  /** "프로젝트 폴더 열기…" → 네이티브 폴더 대화상자 */
  onOpenFolder?: () => void;
  onPickRecent?: (p: RecentProject) => void;
  onTogglePin?: (p: RecentProject) => void;
  /** "파일 첨부" (Composer가 파일 선택 창을 연다) */
  onAttachFiles?: () => void;
  onClose: () => void;
}

/**
 * + 버튼 메뉴 (컨셉 B 1단계): "프로젝트 폴더 열기…", "최근 프로젝트", "파일 첨부".
 * 입력창 위로 뜨는 팝오버. Esc·바깥 클릭으로 닫힌다.
 */
export function PlusMenu({
  mobile,
  recent,
  onOpenFolder,
  onPickRecent,
  onTogglePin,
  onAttachFiles,
  onClose,
}: PlusMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [showRecent, setShowRecent] = useState(!!mobile);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (ref.current?.contains(t) || t?.closest?.('[data-slot="plus"]')) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const act = (fn?: () => void) => () => {
    onClose();
    fn?.();
  };

  const recentList = (
    <div className="hx-plus-menu__recent" role="group" aria-label="최근 프로젝트 목록">
      {recent.length === 0 && <p className="hx-popover__empty">최근 프로젝트가 없습니다</p>}
      {recent.map((p) => (
        <div key={p.path} className="hx-plus-menu__project">
          <button
            type="button"
            role="menuitem"
            className="hx-popover__item"
            title={p.path}
            onClick={act(() => onPickRecent?.(p))}
          >
            <span className="hx-popover__check" aria-hidden="true">
              {p.pinned ? '★' : ''}
            </span>
            <span className="hx-popover__label">{p.name}</span>
            <span className="hx-popover__desc hx-mono">{p.path}</span>
          </button>
          {onTogglePin && (
            <button
              type="button"
              className="hx-plus-menu__pin"
              aria-pressed={!!p.pinned}
              aria-label={`${p.name} ${p.pinned ? '고정 해제' : '고정'}`}
              onClick={() => onTogglePin(p)}
            >
              {p.pinned ? '★' : '☆'}
            </button>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div
      className="hx-popover hx-plus-menu"
      role="menu"
      aria-label={mobile ? '최근 프로젝트' : '추가 메뉴'}
      ref={ref}
      data-mobile={mobile || undefined}
    >
      {mobile ? (
        recentList
      ) : (
        <>
          <button type="button" role="menuitem" className="hx-popover__item" onClick={act(onOpenFolder)}>
            <span className="hx-popover__check" aria-hidden="true">
              📁
            </span>
            <span className="hx-popover__label">프로젝트 폴더 열기…</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="hx-popover__item"
            aria-haspopup="true"
            aria-expanded={showRecent}
            onClick={() => setShowRecent((v) => !v)}
          >
            <span className="hx-popover__check" aria-hidden="true">
              🕘
            </span>
            <span className="hx-popover__label">최근 프로젝트</span>
          </button>
          {showRecent && recentList}
          <button type="button" role="menuitem" className="hx-popover__item" onClick={act(onAttachFiles)}>
            <span className="hx-popover__check" aria-hidden="true">
              📎
            </span>
            <span className="hx-popover__label">파일 첨부</span>
          </button>
        </>
      )}
    </div>
  );
}
