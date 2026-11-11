import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { moveTab, PANEL_TABS, type PanelTabId } from './layout-store.js';
import { act } from '../actions/registry.js';

export interface RightPanelProps {
  order: PanelTabId[];
  onOrderChange: (order: PanelTabId[]) => void;
  /** 탭별 내용 (없으면 빈 자리 안내) */
  content?: Partial<Record<PanelTabId, ReactNode>>;
  /** 바깥에서 탭을 고를 때 (예: Diff 열기). 생략하면 내부 상태 */
  active?: PanelTabId;
  onActiveChange?: (id: PanelTabId) => void;
  /** 탭 위에 고정되는 영역 (T-100 H.11 "확인이 필요해요") */
  top?: ReactNode;
}

const LABEL = Object.fromEntries(PANEL_TABS.map((t) => [t.id, t.label])) as Record<PanelTabId, string>;

/** 우측 패널: 탭을 끌어서 순서를 바꾼다 (키보드: Alt+←/→) */
export function RightPanel({
  order,
  onOrderChange,
  content = {},
  active: activeProp,
  onActiveChange,
  top,
}: RightPanelProps) {
  const [activeState, setActiveState] = useState<PanelTabId>(order[0] ?? 'checklist');
  const active = activeProp ?? activeState;
  const setActive = (id: PanelTabId) => {
    setActiveState(id);
    onActiveChange?.(id);
  };
  const [over, setOver] = useState<PanelTabId | undefined>();
  const dragId = useRef<PanelTabId | undefined>(undefined);

  const onKeyDown = (id: PanelTabId, e: KeyboardEvent) => {
    if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const i = order.indexOf(id);
    const j = e.key === 'ArrowLeft' ? i - 1 : i + 1;
    const target = order[j];
    if (target) onOrderChange(moveTab(order, id, target));
  };

  return (
    <aside className="hx-panel" aria-label="우측 패널">
      {top}
      <div className="hx-panel__tabs" role="tablist" aria-label="패널 탭 (끌어서 순서 변경)">
        {order.map((id) => (
          <button
            {...act('panel.tab')}
            key={id}
            type="button"
            role="tab"
            id={`hx-tab-${id}`}
            aria-selected={id === active}
            aria-controls={`hx-tabpanel-${id}`}
            className="hx-tab"
            draggable
            data-tab={id}
            data-drop-target={over === id && dragId.current !== id ? 'true' : undefined}
            onClick={() => setActive(id)}
            onKeyDown={(e) => onKeyDown(id, e)}
            onDragStart={(e) => {
              dragId.current = id;
              e.dataTransfer?.setData('text/plain', id);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(id);
            }}
            onDragLeave={() => setOver(undefined)}
            onDrop={(e) => {
              e.preventDefault();
              const from =
                dragId.current ?? (e.dataTransfer?.getData('text/plain') as PanelTabId | undefined);
              if (from && from !== id) onOrderChange(moveTab(order, from, id));
              dragId.current = undefined;
              setOver(undefined);
            }}
            onDragEnd={() => {
              dragId.current = undefined;
              setOver(undefined);
            }}
          >
            {LABEL[id]}
          </button>
        ))}
      </div>
      <div
        className="hx-panel__body"
        role="tabpanel"
        id={`hx-tabpanel-${active}`}
        aria-labelledby={`hx-tab-${active}`}
      >
        {content[active] ?? <p>{LABEL[active]} 내용이 여기에 표시됩니다</p>}
      </div>
    </aside>
  );
}
