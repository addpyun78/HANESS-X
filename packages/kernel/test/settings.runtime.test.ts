import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveSessionDefaults } from '../src/projects/defaults.js';
import {
  checklistRunnerOptions,
  installerConfig,
  readSettingsFile,
  sessionDefaultsFromSettings,
} from '../src/settings/runtime.js';

/** T-101 6B.3·6B.4·6B.7 설정 화면 항목 → 실제 동작 연결 (cli.ts가 settings.json을 읽어 넘김) */

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hx-settings-runtime-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('settings.json 읽기', () => {
  it('없거나 깨졌으면 {} (기본값으로)', () => {
    expect(readSettingsFile(join(dir, 'none.json'))).toEqual({});
    writeFileSync(join(dir, 'bad.json'), '{oops');
    expect(readSettingsFile(join(dir, 'bad.json'))).toEqual({});
    writeFileSync(join(dir, 'ok.json'), JSON.stringify({ permission: { default: 'read-only' } }));
    expect(readSettingsFile(join(dir, 'ok.json'))).toEqual({ permission: { default: 'read-only' } });
  });
});

describe('6B.3 기본 허락 범위 → 새 세션 기본값', () => {
  it('설정이 없으면 workspace-write, 있으면 그 값, 프로젝트 기본값(0B.40)이 더 우선', () => {
    expect(sessionDefaultsFromSettings({})).toEqual({ permission: 'workspace-write' });
    const g = sessionDefaultsFromSettings({ permission: { default: 'read-only' } });
    expect(resolveSessionDefaults(undefined, g)).toMatchObject({
      permission: 'read-only',
      from: { permission: 'global' },
    });
    expect(resolveSessionDefaults({ defaults: { permission: 'full' } }, g)).toMatchObject({
      permission: 'full',
      from: { permission: 'project' },
    });
    // 잘못된 값은 기본값으로
    expect(sessionDefaultsFromSettings({ permission: { default: 'root' } })).toEqual({
      permission: 'workspace-write',
    });
  });
});

describe('6B.4 체크리스트 설정 → 실행 옵션', () => {
  it('기본값 = 예전 동작(2턴·3턴·20번, 재요청 있음)', () => {
    expect(checklistRunnerOptions({})).toEqual({
      stall: { changeApproachTurns: 2, blockTurns: 3 },
      maxAutoTurns: 20,
    });
  });
  it('엄격하게 확인하기 = #strict(재요청 0번), 정체 기준·최대 횟수 반영, 멈추기는 늘 방법 바꾸기보다 뒤', () => {
    expect(
      checklistRunnerOptions({
        checklist: { strict: true, stallChangeTurns: 4, stallBlockTurns: 3, maxAutoTurns: 7 },
      }),
    ).toEqual({ stall: { changeApproachTurns: 4, blockTurns: 5 }, maxAutoTurns: 7, maxContractRetries: 0 });
  });
});

describe('6B.7 설치 도구 켜기 → installer 플러그인 config', () => {
  it('초코는 기본 꺼짐, 켜면 chocoEnabled', () => {
    expect(installerConfig({})).toEqual({ chocoEnabled: false });
    expect(installerConfig({ installer: { chocoEnabled: true } })).toEqual({ chocoEnabled: true });
  });
});
