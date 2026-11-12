import { useState } from 'react';
import type { BuilderCatalog } from '../catalog.js';
import { Drawer } from '../Drawer.js';
import { BuilderChat, type BuilderChatProps } from './BuilderChat.js';
import { act } from '../../actions/registry.js';

export const SIDEBAR_MODES = ['blocks', 'chat'] as const;
export type SidebarMode = (typeof SIDEBAR_MODES)[number];
export const SIDEBAR_MODE_LABEL: Record<SidebarMode, string> = { blocks: '블록', chat: '💬 대화로 만들기' };

export interface BuilderSidebarProps {
  catalog: BuilderCatalog;
  initialMode?: SidebarMode;
  chat?: BuilderChatProps;
}

/** P4-B.2 빌더 왼쪽 서랍: `블록 | 대화로 만들기` 탭. 두 탭 모두 마운트해 두어 탭을 바꿔도 입력이 남는다 */
export function BuilderSidebar({ catalog, initialMode = 'blocks', chat }: BuilderSidebarProps) {
  const [mode, setMode] = useState<SidebarMode>(initialMode);
  return (
    <div className="hx-sidebar" data-mode={mode} aria-label="블록 서랍">
      <div className="hx-sidebar__tabs" role="tablist" aria-label="만들기 방식">
        {SIDEBAR_MODES.map((m) => (
          <button
            {...act('builder.sidebar-tab')}
            key={m}
            type="button"
            role="tab"
            id={`hx-sidebar-tab-${m}`}
            aria-controls={`hx-sidebar-panel-${m}`}
            aria-selected={m === mode}
            className="hx-sidebar__tab"
            onClick={() => setMode(m)}
          >
            {SIDEBAR_MODE_LABEL[m]}
          </button>
        ))}
      </div>
      {SIDEBAR_MODES.map((m) => (
        <div
          key={m}
          role="tabpanel"
          id={`hx-sidebar-panel-${m}`}
          aria-labelledby={`hx-sidebar-tab-${m}`}
          className="hx-sidebar__panel"
          hidden={m !== mode}
        >
          {m === 'blocks' ? <Drawer catalog={catalog} /> : <BuilderChat {...chat} />}
        </div>
      ))}
    </div>
  );
}
