import { RUN_MODE_DESC, RUN_MODE_LABEL, RUN_MODES, type RunMode } from '@harness-x/protocol';
import type { ChipOption } from './ChipMenu.js';

/**
 * T-101 3A.3 입력창 모드 칩 화면 모델 (순수 함수)
 * - 3A.3 권한 칩 오른쪽 `[모드: 일반 ▾]`, 펼치면 모드 3개 + 쉬운 말 설명 한 줄씩
 */

export type { RunMode };
export { RUN_MODE_DESC, RUN_MODE_LABEL, RUN_MODES };

export const MODE_CHIP_NAME = '모드';

export function modeOptions(): ChipOption<RunMode>[] {
  return RUN_MODES.map((m) => ({ value: m, label: RUN_MODE_LABEL[m], description: RUN_MODE_DESC[m] }));
}
