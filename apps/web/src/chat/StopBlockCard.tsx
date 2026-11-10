export interface StopBlockCardProps {
  remaining?: number;
  nextItemId?: string;
  nextItemTitle?: string;
}

/** "종료 차단" 카드(노란색): 체크리스트가 남아 있어 엔진의 종료를 막았다 */
export function StopBlockCard({ remaining, nextItemId, nextItemTitle }: StopBlockCardProps) {
  return (
    <div className="hx-stop-block" role="alert" aria-label="종료 차단">
      <div className="hx-stop-block__head">
        <span aria-hidden="true">⛔</span>
        <strong>종료 차단</strong>
        {remaining !== undefined && (
          <span className="hx-stop-block__count" data-testid="stop-remaining">
            남은 항목 {remaining}개
          </span>
        )}
      </div>
      <p className="hx-stop-block__body">
        체크리스트가 끝나지 않아 종료를 막고 다음 항목을 이어서 진행합니다.
      </p>
      {(nextItemId || nextItemTitle) && (
        <p className="hx-stop-block__next" data-testid="stop-next">
          다음 항목: {nextItemId && <span className="hx-mono">{nextItemId}</span>} {nextItemTitle}
        </p>
      )}
    </div>
  );
}
