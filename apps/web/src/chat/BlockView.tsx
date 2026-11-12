import { memo } from 'react';
import { ForgeCard, isForgeCard } from '../forge/ForgeCards.js';
import { MiniApprovalCard } from '../panels/Approvals/MiniApprovalCard.js';
import { APPROVAL_CARD_KIND, type ApprovalCardData } from '../panels/Approvals/model.js';
import { usePanelActions } from '../panels/panel-actions.js';
import type { ChatBlock } from './blocks.js';
import { StopBlockCard } from './StopBlockCard.js';
import { CollapsibleCard, formatValue, ItemTag, ToolCard, truncate } from './ToolCard.js';

const CHANGE_LABEL = { create: '생성', modify: '수정', delete: '삭제', rename: '이름 변경' } as const;
const TURN_END_LABEL = {
  completed: '완료',
  interrupted: '중단됨',
  error: '오류로 종료',
  max_turns: '최대 턴 도달',
} as const;

/** 메시지 블록 하나 렌더 */
export const BlockView = memo(function BlockView({ block: b }: { block: ChatBlock }) {
  switch (b.kind) {
    case 'text':
      return (
        <div className="hx-msg hx-msg--assistant" data-streaming={b.streaming || undefined}>
          <div className="hx-msg__text">{b.text}</div>
          <ItemTag itemId={b.itemId} />
        </div>
      );
    case 'tool':
      return <ToolCard tool={b.tool} input={b.input} result={b.result} itemId={b.itemId} />;
    case 'tool_result':
      return (
        <CollapsibleCard
          className="hx-card--tool"
          icon="↩"
          title="도구 결과"
          summary={b.callId}
          status={b.ok ? 'ok' : 'fail'}
          itemId={b.itemId}
        >
          <pre className="hx-pre">{formatValue(b.output)}</pre>
        </CollapsibleCard>
      );
    case 'file':
      return <FileCard block={b} />;
    case 'usage':
      return (
        <div className="hx-meta" aria-label="사용량">
          토큰 입력 {b.inputTokens.toLocaleString('ko-KR')} · 출력 {b.outputTokens.toLocaleString('ko-KR')}
          {b.cacheReadTokens !== undefined && ` · 캐시 ${b.cacheReadTokens.toLocaleString('ko-KR')}`}
          {b.costUsd !== undefined && ` · $${b.costUsd.toFixed(4)}`}
          {b.quotaRatio !== undefined && ` · 쿼터 ${Math.round(b.quotaRatio * 100)}%`}
        </div>
      );
    case 'error':
      return (
        <div className="hx-error" role="alert">
          <strong>오류</strong> <span className="hx-mono">{b.code}</span>
          <span className="hx-error__msg">{truncate(b.message, 2000)}</span>
          {b.retryable && <span className="hx-error__retry">다시 시도할 수 있음</span>}
          <ItemTag itemId={b.itemId} />
        </div>
      );
    case 'turn_end':
      return (
        <div className="hx-turn-end" role="separator" aria-label={`턴 종료: ${TURN_END_LABEL[b.reason]}`}>
          <span>턴 종료 · {TURN_END_LABEL[b.reason]}</span>
        </div>
      );
    case 'stop_block':
      return (
        <StopBlockCard remaining={b.remaining} nextItemId={b.nextItemId} nextItemTitle={b.nextItemTitle} />
      );
    case 'approval':
      // Forge 카드(질문·spec 확인·설치)는 선택지 버튼 UI로
      if (isForgeCard(b.approvalKind)) return <ForgeCard block={b} />;
      // T-100 H.14 쉬운 말 승인 카드는 채팅에 축소 카드만 (누르면 패널 카드로)
      if (b.approvalKind === APPROVAL_CARD_KIND)
        return (
          <MiniApprovalCard
            approvalId={b.approvalId}
            card={(b.detail as { card?: ApprovalCardData } | undefined)?.card}
          />
        );
      return (
        <div className="hx-approval" role="group" aria-label={`승인 요청: ${b.title}`}>
          <div className="hx-approval__head">
            <strong>승인 요청</strong> <span className="hx-mono">{b.approvalKind}</span>
            <ItemTag itemId={b.itemId} />
          </div>
          <p>{b.title}</p>
          <div className="hx-approval__options">
            {b.options.map((o) => (
              <button key={o} type="button" className="hx-icon-btn" data-option={o}>
                {o}
              </button>
            ))}
          </div>
        </div>
      );
    case 'checklist':
      return (
        <div className="hx-meta hx-meta--checklist">
          ☑ 항목 <span className="hx-mono">{b.changedItemId}</span>: {b.from ?? '없음'} → {b.to}
        </div>
      );
    case 'pause_mark':
      // T-101 2B.12 세션 타임라인 "멈춤 → 이어감"
      return (
        <div className={`hx-pause-mark hx-pause-mark--${b.state}`} role="separator" aria-label={b.text}>
          <span>{b.text}</span>
          {b.ts && <time dateTime={b.ts} />}
        </div>
      );
  }
});

/** 파일 변경 카드 — 우측 패널이 연결돼 있으면 "Diff 열기"로 Monaco diff 패널을 연다 */
function FileCard({ block: b }: { block: Extract<ChatBlock, { kind: 'file' }> }) {
  const panel = usePanelActions();
  return (
    <CollapsibleCard
      className={`hx-card--file hx-change--${b.change}`}
      icon="✎"
      title={
        <>
          <span className="hx-change">{CHANGE_LABEL[b.change]}</span>{' '}
          <span className="hx-mono">{b.fromPath ? `${b.fromPath} → ${b.path}` : b.path}</span>
        </>
      }
      itemId={b.itemId}
      actions={
        panel && (
          <button
            type="button"
            className="hx-icon-btn hx-card__action"
            aria-label={`Diff 열기: ${b.path}`}
            onClick={() =>
              panel.openDiff({
                path: b.path,
                change: b.change,
                ...(b.fromPath ? { fromPath: b.fromPath } : {}),
                ...(b.diff !== undefined ? { diff: b.diff } : {}),
                ...(b.itemId ? { itemId: b.itemId } : {}),
              })
            }
          >
            Diff
          </button>
        )
      }
    >
      {b.diff ? <pre className="hx-pre hx-diff">{b.diff}</pre> : undefined}
    </CollapsibleCard>
  );
}
