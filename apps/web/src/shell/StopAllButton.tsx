import { act } from '../actions/registry.js';

/** T-101 2A.8 실행 중인 세션이 2개 이상이면 상단 바에 [전체 정지] → POST /api/sessions/stop-all */
export interface StopAllButtonProps {
  runningCount: number;
  onStopAll(): void;
}

export function StopAllButton({ runningCount, onStopAll }: StopAllButtonProps) {
  if (runningCount < 2) return null;
  return (
    <button
      type="button"
      className="hx-stop-all"
      {...act('shell.stop-all')}
      aria-label={`전체 정지 (실행 중 ${runningCount}개)`}
      onClick={onStopAll}
    >
      ■ 전체 정지
    </button>
  );
}
