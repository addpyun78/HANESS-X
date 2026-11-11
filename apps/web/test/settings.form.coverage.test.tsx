// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineSetting, settingsRegistry } from '../../../packages/kernel/src/settings/registry.js';
import { SettingsForm } from '../src/settings/form/SettingsForm.js';
import type { SettingsApi } from '../src/settings/form/api.js';
import type { SettingsResponse } from '../src/settings/form/types.js';
import { checkPlainKorean } from './plain-check.js';
import {
  memorySettings,
  memoryStorage,
  registryResponse,
  type MemorySettings,
} from './settings-form-fixtures.js';

/**
 * T-101 0A.10 재발 방지 검사 (화면 쪽): 레지스트리의 모든 키가 설정 화면에 보인다(고급 포함).
 * 코드 쪽 검사(코드에서 쓰는 키 ⊆ 레지스트리)는 tests/settings-coverage.test.ts.
 */

let m: MemorySettings | undefined;
afterEach(() => {
  cleanup();
  m?.dispose();
  m = undefined;
});

/** 화면에 그려진 설정 키 */
const shownKeys = () =>
  [...document.querySelectorAll('[data-setting-key]')].map((e) => e.getAttribute('data-setting-key')!);

/** 레지스트리 키 중 화면에 없는 것 (전체 범위 + 프로젝트 범위 화면을 합쳐서) */
async function unexposed(api: SettingsApi, keys: readonly string[]): Promise<string[]> {
  const seen = new Set<string>();
  for (const scope of ['global', 'project'] as const) {
    const r = render(
      <SettingsForm
        api={api}
        showAdvanced
        scope={scope}
        project="p1"
        storage={memoryStorage()}
        onBrowserChange={() => {}}
      />,
    );
    await screen.findAllByRole('region');
    for (const k of shownKeys()) seen.add(k);
    r.unmount();
  }
  return keys.filter((k) => !seen.has(k));
}

const staticApi = (resp: SettingsResponse): SettingsApi => ({
  load: async () => structuredClone(resp),
  save: async () => {
    throw new Error('x');
  },
  reset: async () => ({ ok: true, reset: [], values: {} }),
  saveSecret: async () => ({ masked: '••••' }),
  deleteSecret: async () => ({}),
});

describe('T-101 0A.10 레지스트리 키 전부 화면 노출 (고급 포함)', () => {
  it('하네스 기본 레지스트리: 모든 키가 보이고, 제목·설명은 쉬운 말 검사 통과', async () => {
    m = memorySettings();
    expect(await unexposed(m.api, settingsRegistry.keys())).toEqual([]);
    render(<SettingsForm api={m.api} showAdvanced storage={memoryStorage()} onBrowserChange={() => {}} />);
    await screen.findAllByRole('region');
    expect(screen.getAllByRole('region')).toHaveLength(13);
    const bad = settingsRegistry
      .list()
      .flatMap((d) => [
        ...checkPlainKorean(d.title, { label: true }).violations.map((v) => `${d.key} 제목: ${v.detail}`),
        ...checkPlainKorean(d.description).violations.map((v) => `${d.key} 설명: ${v.detail}`),
      ]);
    expect(bad).toEqual([]);
  });

  it('고급 설정 보기를 끄면 고급 항목은 숨는다 (켜면 모두 보임)', async () => {
    m = memorySettings();
    render(<SettingsForm api={m.api} storage={memoryStorage()} onBrowserChange={() => {}} />);
    await screen.findAllByRole('region');
    const basic = shownKeys();
    expect(basic.length).toBeLessThan(settingsRegistry.keys().length);
    expect(basic).not.toContain('judge.samples');
    expect(basic).toContain('judge.engine');
  });

  it('일부러: 화면 응답에서 키 하나가 빠지면 검사가 잡는다', async () => {
    const reg = settingsRegistry.clone();
    reg.register(
      defineSetting('data.retentionDays', z.number().int().min(1).default(30), {
        group: 'data',
        title: '기록 보관 기간',
        description: '작업 기록을 며칠 동안 둘지 정해요.',
        advanced: true,
        restartRequired: false,
        scope: 'both',
      }),
    );
    const full = registryResponse(reg);
    // 렌더러가 새 키를 못 그리는 상황을 흉내: 응답에서 빼 버린다
    const dropped = { ...full, fields: full.fields.filter((f) => f.key !== 'data.retentionDays') };
    expect(await unexposed(staticApi(dropped), reg.keys())).toEqual(['data.retentionDays']);
    // 제대로 넘기면 프로젝트 범위 키도 보인다
    expect(await unexposed(staticApi(full), reg.keys())).toEqual([]);
  });
});
