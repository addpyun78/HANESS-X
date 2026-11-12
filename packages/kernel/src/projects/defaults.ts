import { toRunMode, type RunMode } from '@harness-x/protocol';
import type { Project, ProjectDefaults } from './schema.js';

/**
 * 0B.11 / 0B.40 초안 세션 기본값
 * 적용 순서: 프로젝트 기본값 → 전체 기본값(주입). 전체 기본값의 출처는 아직 없는 기능이 많아 함수로 받는다:
 * - engine: 지금은 "현재 기본 엔진"(감지된 첫 엔진), 5번(메인 AI) 뒤에는 메인 AI가 이 함수를 채운다
 * - mode:   설정 `mode.default`(3A.2, cli.ts에서 주입). 모르는 값(plan|normal|auto 밖)은 버린다
 * - permission: 기본 권한 (비면 'workspace-write')
 */
export interface GlobalSessionDefaults {
  engine?: string;
  model?: string;
  mode?: string;
  permission?: string;
  agent?: string;
}

export type GlobalDefaultsSource = () => GlobalSessionDefaults;

export const DEFAULT_PERMISSION = 'workspace-write';

export interface ResolvedSessionDefaults extends GlobalSessionDefaults {
  permission: string;
  mode?: RunMode;
  /** 값마다 어디서 왔나 (화면의 "이 프로젝트 기본" 표시용) */
  from: Partial<Record<keyof ProjectDefaults, 'project' | 'global'>>;
}

const KEYS = ['engine', 'model', 'permission', 'agent'] as const;

export function resolveSessionDefaults(
  project: Pick<Project, 'defaults'> | undefined,
  global: GlobalSessionDefaults = {},
): ResolvedSessionDefaults {
  const out: ResolvedSessionDefaults = { permission: DEFAULT_PERMISSION, from: {} };
  for (const k of KEYS) {
    const pv = project?.defaults?.[k];
    const gv = global[k];
    if (pv) {
      out[k] = pv;
      out.from[k] = 'project';
    } else if (gv) {
      out[k] = gv;
      out.from[k] = 'global';
    }
  }
  // 3A.2 모드는 알려진 값만 (프로젝트 값이 잘못됐으면 전체 값으로)
  const pm = toRunMode(project?.defaults?.mode);
  const gm = toRunMode(global.mode);
  if (pm) {
    out.mode = pm;
    out.from.mode = 'project';
  } else if (gm) {
    out.mode = gm;
    out.from.mode = 'global';
  }
  return out;
}
