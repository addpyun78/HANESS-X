import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { loadLayout, RIGHT, saveLayout, SIDEBAR, type Layout, type PanelTabId } from './layout-store.js';
import { Resizer } from './Resizer.js';
import { RightPanel } from './RightPanel.js';
import { TopBar, type TopBarProps } from './TopBar.js';
import { NARROW_QUERY, useMediaQuery } from './useMediaQuery.js';
import './shell.css';

export interface AppShellProps {
  topBar: Omit<TopBarProps, 'leading' | 'trailing'>;
  sidebar: ReactNode;
  main: ReactNode;
  panelContent?: Partial<Record<PanelTabId, ReactNode>>;
  panelActive?: PanelTabId;
  onPanelActiveChange?: (id: PanelTabId) => void;
  /** 우측 패널 맨 위 고정 영역. 좁은 화면에서는 패널 밖(하단 시트)으로 그린다 (T-100 H.11·H.15) */
  panelTop?: ReactNode;
}

type Sheet = 'sidebar' | 'panel' | undefined;

/**
 * 3열 레이아웃: 사이드바 240px / 채팅 가변 / 우측 패널 360px, 경계 드래그로 리사이즈(너비 저장).
 * 768px 미만에서는 사이드바·우측 패널이 시트로 접힌다.
 */
export function AppShell({
  topBar,
  sidebar,
  main,
  panelContent,
  panelActive,
  onPanelActiveChange,
  panelTop,
}: AppShellProps) {
  const [layout, setLayout] = useState<Layout>(loadLayout);
  const narrow = useMediaQuery(NARROW_QUERY);
  const [sheet, setSheet] = useState<Sheet>();

  const update = useCallback((patch: Partial<Layout>, persist: boolean) => {
    setLayout((l) => {
      const next = { ...l, ...patch };
      if (persist) saveLayout(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!narrow) setSheet(undefined);
  }, [narrow]);

  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSheet(undefined);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheet]);

  const panel = (
    <RightPanel
      order={layout.tabOrder}
      onOrderChange={(tabOrder) => update({ tabOrder }, true)}
      content={panelContent}
      active={panelActive}
      onActiveChange={onPanelActiveChange}
      top={narrow ? undefined : panelTop}
    />
  );

  const style = {
    '--hx-sidebar-w': `${layout.sidebarWidth}px`,
    '--hx-right-w': `${layout.rightWidth}px`,
  } as CSSProperties;

  return (
    <div
      className={`hx-shell${narrow ? ' hx-shell--narrow' : ''}`}
      style={style}
      data-layout={narrow ? 'narrow' : 'wide'}
    >
      <TopBar
        {...topBar}
        leading={
          narrow && (
            <button
              type="button"
              className="hx-icon-btn"
              aria-label="사이드바 열기"
              aria-expanded={sheet === 'sidebar'}
              onClick={() => setSheet('sidebar')}
            >
              ☰
            </button>
          )
        }
        trailing={
          narrow && (
            <button
              type="button"
              className="hx-icon-btn"
              aria-label="패널 열기"
              aria-expanded={sheet === 'panel'}
              onClick={() => setSheet('panel')}
            >
              ▤
            </button>
          )
        }
      />
      <div className="hx-shell__body">
        {!narrow && sidebar}
        {!narrow && (
          <Resizer
            label="사이드바 너비"
            side="left"
            value={layout.sidebarWidth}
            min={SIDEBAR.min}
            max={SIDEBAR.max}
            onChange={(w) => update({ sidebarWidth: w }, false)}
            onCommit={(w) => update({ sidebarWidth: w }, true)}
          />
        )}
        <main className="hx-shell__main">{main}</main>
        {!narrow && (
          <Resizer
            label="우측 패널 너비"
            side="right"
            value={layout.rightWidth}
            min={RIGHT.min}
            max={RIGHT.max}
            onChange={(w) => update({ rightWidth: w }, false)}
            onCommit={(w) => update({ rightWidth: w }, true)}
          />
        )}
        {!narrow && panel}
      </div>
      {narrow && panelTop}
      {narrow && sheet && (
        <>
          <div
            className="hx-sheet-backdrop"
            data-testid="sheet-backdrop"
            onClick={() => setSheet(undefined)}
          />
          <div
            className={`hx-sheet hx-sheet--${sheet === 'sidebar' ? 'left' : 'right'}`}
            role="dialog"
            aria-modal="true"
            aria-label={sheet === 'sidebar' ? '사이드바' : '우측 패널'}
          >
            {sheet === 'sidebar' ? sidebar : panel}
          </div>
        </>
      )}
    </div>
  );
}
