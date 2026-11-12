import { RUN_MODE_DESC, RUN_MODE_LABEL, RUN_MODES, type RunMode } from '@harness-x/protocol';
import type { ChipOption } from './ChipMenu.js';
import type { PermissionMode } from './types.js';

/**
 * T-101 3A.3·3A.4 입력창 모드 칩 화면 모델 (순수 함수)
 * - 3A.3 권한 칩 오른쪽 `[모드: 일반 ▾]`, 펼치면 모드 3개 + 쉬운 말 설명 한 줄씩
 * - 3A.4 계획 → 권한 칩 읽기 전용 고정(자물쇠), 오토 선택 시 권한이 읽기 전용이면 바꿀지 묻는다
 */

export type { RunMode };
export { RUN_MODE_DESC, RUN_MODE_LABEL, RUN_MODES };

export const MODE_CHIP_NAME = '모드';

export function modeOptions(): ChipOption<RunMode>[] {
  return RUN_MODES.map((m) => ({ value: m, label: RUN_MODE_LABEL[m], description: RUN_MODE_DESC[m] }));
}

/** 3A.4 오토로 바꿀 때 권한이 읽기 전용이면 보이는 질문 */
export const AUTO_NEEDS_WRITE = '오토 모드는 파일을 고칠 수 있어야 해요. 워크스페이스 쓰기로 바꿀까요?';
/** 계획 모드에서 잠긴 권한 칩 설명 */
export const PLAN_LOCK_REASON = '계획 모드에서는 읽기만 해요. 모드를 바꾸면 풀려요.';

export interface PermissionView {
  /** 화면·전송에 쓰는 실제 권한 */
  permission: PermissionMode;
  /** 자물쇠 (바꿀 수 없음) */
  locked: boolean;
}

/** 3A.4 모드에 따른 권한 칩 모습. 계획이면 읽기 전용으로 잠그고, 사용자가 고른 값은 그대로 둔다(모드를 풀면 돌아옴) */
export function permissionView(mode: RunMode, chosen: PermissionMode): PermissionView {
  if (mode === 'plan') return { permission: 'read-only', locked: true };
  return { permission: chosen, locked: false };
}

export type ModeChange =
  | { kind: 'apply'; mode: RunMode }
  /** 오토 + 읽기 전용: 먼저 묻는다. yes면 권한을 workspace-write로 바꾸고 오토 */
  | { kind: 'confirm-write'; mode: 'auto'; question: string; upgradeTo: PermissionMode };

/** 3A.4 모드를 고를 때 할 일 */
export function planModeChange(next: RunMode, chosen: PermissionMode): ModeChange {
  if (next === 'auto' && chosen === 'read-only')
    return { kind: 'confirm-write', mode: 'auto', question: AUTO_NEEDS_WRITE, upgradeTo: 'workspace-write' };
  return { kind: 'apply', mode: next };
}
