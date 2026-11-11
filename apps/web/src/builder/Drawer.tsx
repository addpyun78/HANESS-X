import { useMemo, useState } from 'react';
import {
  BLOCK_MIME,
  blockKindMime,
  DRAWER_TAB_LABEL,
  DRAWER_TABS,
  drawerBlocks,
  filterBlocks,
  type BuilderCatalog,
  type DrawerBlock,
  type DrawerTab,
} from './catalog.js';
import { act } from '../actions/registry.js';

export interface DrawerProps {
  catalog: BuilderCatalog;
  initialTab?: DrawerTab;
}

/** 블록 서랍(좌): 노드·플러그인·스킬·엔진·도구 탭 + 검색. 블록은 캔버스·노드로 끌어 놓는다 */
export function Drawer({ catalog, initialTab = 'node' }: DrawerProps) {
  const [tab, setTab] = useState<DrawerTab>(initialTab);
  const [query, setQuery] = useState('');
  const blocks = useMemo(() => filterBlocks(drawerBlocks(catalog, tab), query), [catalog, tab, query]);
  return (
    <aside className="hx-drawer" aria-label="블록 서랍">
      <div className="hx-drawer__tabs" role="tablist" aria-label="블록 종류">
        {DRAWER_TABS.map((t) => (
          <button
            {...act('builder.drawer-tab')}
            key={t}
            type="button"
            role="tab"
            aria-selected={t === tab}
            className="hx-drawer__tab"
            onClick={() => setTab(t)}
          >
            {DRAWER_TAB_LABEL[t]}
          </button>
        ))}
      </div>
      <input
        type="search"
        className="hx-drawer__search"
        aria-label="블록 검색"
        placeholder={`${DRAWER_TAB_LABEL[tab]} 검색`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul className="hx-drawer__list" role="tabpanel" aria-label={`${DRAWER_TAB_LABEL[tab]} 블록`}>
        {blocks.map((b) => (
          <li key={`${b.kind}:${b.id}`}>
            <BlockItem block={b} />
          </li>
        ))}
        {blocks.length === 0 && <li className="hx-drawer__empty">맞는 블록이 없습니다</li>}
      </ul>
    </aside>
  );
}

function BlockItem({ block }: { block: DrawerBlock }) {
  return (
    <div
      className="hx-block"
      data-kind={block.kind}
      draggable
      title={block.description}
      onDragStart={(e) => {
        e.dataTransfer.setData(BLOCK_MIME, JSON.stringify({ kind: block.kind, id: block.id }));
        e.dataTransfer.setData(blockKindMime(block.kind), block.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
    >
      <span className="hx-block__stud" aria-hidden="true" />
      <span className="hx-block__label">{block.label}</span>
      {block.description && <span className="hx-block__desc">{block.description}</span>}
    </div>
  );
}

/** dataTransfer에서 서랍 블록 읽기 */
export function readBlock(dt: DataTransfer | null | undefined): Pick<DrawerBlock, 'kind' | 'id'> | undefined {
  const raw = dt?.getData(BLOCK_MIME);
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw) as { kind?: unknown; id?: unknown };
    if (typeof v.id !== 'string' || !DRAWER_TABS.includes(v.kind as DrawerTab)) return undefined;
    return { kind: v.kind as DrawerTab, id: v.id };
  } catch {
    return undefined;
  }
}
