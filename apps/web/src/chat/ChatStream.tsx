import type { HarnessEvent } from '@harness-x/protocol';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef } from 'react';
import { BlockView } from './BlockView.js';
import { eventsToBlocks, VIEW_MODE_LABEL, visibleBlocks, type ViewMode } from './blocks.js';
import './chat.css';

export interface ChatStreamProps {
  events: readonly HarnessEvent[];
  mode: ViewMode;
  onModeChange?: (m: ViewMode) => void;
  /** 블록 예상 높이(px). 실제 높이는 렌더 후 측정 */
  estimateSize?: number;
  /** 테스트·SSR용 초기 뷰포트 크기 */
  initialRect?: { width: number; height: number };
}

export function ViewModeSwitch({ mode, onChange }: { mode: ViewMode; onChange?: (m: ViewMode) => void }) {
  return (
    <div className="hx-modes" role="radiogroup" aria-label="보기 모드">
      {(Object.keys(VIEW_MODE_LABEL) as ViewMode[]).map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={m === mode}
          className="hx-mode"
          data-mode={m}
          onClick={() => onChange?.(m)}
        >
          {VIEW_MODE_LABEL[m]}
        </button>
      ))}
    </div>
  );
}

/**
 * 채팅 스트림: 이벤트 → 블록 → 보기 모드 필터 → 가상 스크롤.
 * 수천 개 이벤트에서도 화면에 보이는 블록(+여유분)만 DOM에 둔다.
 * 맨 아래를 보고 있으면 새 블록이 올 때 따라 내려간다.
 */
export function ChatStream({ events, mode, onModeChange, estimateSize = 72, initialRect }: ChatStreamProps) {
  const blocks = useMemo(() => visibleBlocks(eventsToBlocks(events), mode), [events, mode]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  const v = useVirtualizer({
    count: blocks.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateSize,
    overscan: 8,
    getItemKey: (i) => blocks[i]!.id,
    ...(initialRect ? { initialRect } : {}),
  });

  useEffect(() => {
    if (atBottom.current && blocks.length > 0) v.scrollToIndex(blocks.length - 1, { align: 'end' });
  }, [blocks.length, v]);

  const items = v.getVirtualItems();
  return (
    <section className="hx-chat" aria-label="채팅">
      <div className="hx-chat__bar">
        <ViewModeSwitch mode={mode} onChange={onModeChange} />
        <span className="hx-chat__count" data-testid="block-count">
          블록 {blocks.length.toLocaleString('ko-KR')}개
        </span>
      </div>
      <div
        ref={scrollRef}
        className="hx-chat__scroll"
        data-testid="chat-scroll"
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
        }}
      >
        {blocks.length === 0 ? (
          <p className="hx-chat__empty">아직 메시지가 없습니다. 아래에 지시를 입력하세요.</p>
        ) : (
          <div className="hx-chat__inner" style={{ height: v.getTotalSize() }}>
            <div
              className="hx-chat__window"
              style={{ transform: `translateY(${items[0]?.start ?? 0}px)` }}
              role="log"
              aria-live="polite"
            >
              {items.map((it) => (
                <div key={it.key} data-index={it.index} ref={v.measureElement} className="hx-chat__row">
                  <BlockView block={blocks[it.index]!} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
