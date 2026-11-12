import { RUN_MODE_LABEL, toRunMode, type RunMode } from '@harness-x/protocol';
import { ChipMenu } from '../composer/ChipMenu.js';
import { MODE_CHIP_NAME, modeOptions } from '../composer/run-mode.js';

/**
 * T-101 3E.6 이어하기 카드에 붙이는 모드 고르기. 기본은 멈추기 전 세션의 모드 그대로(유지),
 * 바꾸면 이번 이어하기부터 그 모드. (2번 이어하기 카드 2B.1이 이 조각을 그대로 쓴다)
 */

/** 멈추기 전 모드 (기록이 없으면 일반) */
export function keptMode(sessionMode: unknown): RunMode {
  return toRunMode(sessionMode) ?? 'normal';
}

export interface ResumeModeChoiceProps {
  /** 멈춘 세션의 모드 */
  sessionMode?: string;
  /** 지금 고른 값 (없으면 유지) */
  value?: RunMode;
  onChange: (mode: RunMode) => void;
}

export function ResumeModeChoice({ sessionMode, value, onChange }: ResumeModeChoiceProps) {
  const kept = keptMode(sessionMode);
  const cur = value ?? kept;
  return (
    <div className="hx-resume-mode">
      <ChipMenu
        name={MODE_CHIP_NAME}
        className="hx-chip--mode"
        value={cur}
        valueLabel={RUN_MODE_LABEL[cur]}
        options={modeOptions().map((o) =>
          o.value === kept ? { ...o, description: `${o.description} (멈추기 전 모드)` } : o,
        )}
        onChange={onChange}
      />
    </div>
  );
}
