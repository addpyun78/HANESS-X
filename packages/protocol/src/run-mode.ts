import { z } from 'zod';

/**
 * T-101 3. 실행 모드 (계획 / 일반 / 오토)
 * | 모드 | 사람 개입 | 하는 일 | 권한 칩 |
 * | 계획 | 계획 확인 1번 | 읽기만 하고 체크리스트(계획)까지 만들고 멈춤 | 읽기 전용으로 잠김 |
 * | 일반(기본) | 필요할 때마다 | 계획 승인 → 실행, 애매하면 승인 카드 | 사용자가 고른 값 |
 * | 오토 | 없음 | 계획 자동 승인 → 끝까지 자동. 사람 전용 일은 하지 않고 "돌아오면 확인할 것"에 모음 | 최소 워크스페이스 쓰기 |
 * 오토 모드에서도 절대 안 하는 것: 설치·제거·결제·에이전트 저장·워크스페이스 밖 쓰기·파괴적 명령.
 */
export const RUN_MODES = ['plan', 'normal', 'auto'] as const;
export const RunModeSchema = z.enum(RUN_MODES);
export type RunMode = z.infer<typeof RunModeSchema>;

export const DEFAULT_RUN_MODE: RunMode = 'normal';

/** 화면 이름 (쉬운 말) */
export const RUN_MODE_LABEL: Readonly<Record<RunMode, string>> = Object.freeze({
  plan: '계획',
  normal: '일반',
  auto: '오토',
});

/** 모드 설명 한 줄 (쉬운 말) */
export const RUN_MODE_DESC: Readonly<Record<RunMode, string>> = Object.freeze({
  plan: '읽기만 하고 할 일 목록까지 만든 뒤 멈춰요.',
  normal: '할 일 목록을 확인받고, 애매하면 물어봐요.',
  auto: '묻지 않고 끝까지 해요. 사람이 할 일은 모아 둬요.',
});

export function isRunMode(v: unknown): v is RunMode {
  return typeof v === 'string' && (RUN_MODES as readonly string[]).includes(v);
}

/** 모르는 값은 undefined (옛 기록·잘못된 설정은 무시) */
export function toRunMode(v: unknown): RunMode | undefined {
  return isRunMode(v) ? v : undefined;
}
