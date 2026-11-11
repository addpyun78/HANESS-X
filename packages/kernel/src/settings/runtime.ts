import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readSetting } from './registry.js';

/**
 * T-101 6번 설정 화면 항목을 실제 동작에 잇는 도우미 (cli.ts가 settings.json을 읽어 넘긴다).
 * 값은 readSetting으로 읽으므로 0A.10 재발 방지 검사가 등록 여부를 확인한다.
 */

/** settings.json 원본 (없거나 깨졌으면 {}) — 요청마다 읽어 저장 즉시 적용 */
export function readSettingsFile(file: string): Record<string, unknown> {
  try {
    if (!existsSync(file)) return {};
    const v = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** 6B.3 새 세션의 전체 기본값 중 설정에서 오는 것 (0B.11 GlobalDefaultsSource에 섞는다) */
export function sessionDefaultsFromSettings(values: Record<string, unknown>): { permission: string } {
  return { permission: readSetting<string>(values, 'permission.default') };
}

/** 6B.4 체크리스트 실행 설정 → PipelineRunner 옵션 */
export interface ChecklistRunnerOptions {
  stall: { changeApproachTurns: number; blockTurns: number };
  maxAutoTurns: number;
  maxContractRetries?: number;
}

export function checklistRunnerOptions(values: Record<string, unknown>): ChecklistRunnerOptions {
  const change = readSetting<number>(values, 'checklist.stallChangeTurns');
  const block = readSetting<number>(values, 'checklist.stallBlockTurns');
  return {
    // 멈추는 차례는 방법을 바꾸라는 차례보다 늦어야 한다
    stall: { changeApproachTurns: change, blockTurns: Math.max(block, change + 1) },
    maxAutoTurns: readSetting<number>(values, 'checklist.maxAutoTurns'),
    // 엄격하게 확인하기 = 입력창 #strict 와 같음 (출력 계약 재요청 없이 첫 불충족에서 멈춤)
    ...(readSetting<boolean>(values, 'checklist.strict') ? { maxContractRetries: 0 } : {}),
  };
}

/** 6B.7 installer 플러그인 config (설치 도구 켜기) */
export function installerConfig(values: Record<string, unknown>): { chocoEnabled: boolean } {
  return { chocoEnabled: readSetting<boolean>(values, 'installer.chocoEnabled') };
}

/** 6B.10 임시 작업 공간 위치 (빈 값 = <home>/scratch) — ProjectStore scratchRoot */
export function scratchRootFrom(values: Record<string, unknown>): string {
  return readSetting<string>(values, 'project.scratchDir');
}

/** 6B.13 하네스 버전 (커널 package.json) */
export function kernelVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
    ) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}
