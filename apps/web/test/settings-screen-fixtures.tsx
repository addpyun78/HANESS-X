import { fireEvent, render, screen, within } from '@testing-library/react';
import {
  CORE_SETTINGS,
  SettingsRegistry,
  type SettingDef,
} from '../../../packages/kernel/src/settings/registry.js';
import { SettingsScreen, type SettingsScreenProps } from '../src/settings/SettingsScreen.js';
import { memorySettings, memoryStorage, type MemorySettings } from './settings-form-fixtures.js';

/** T-101 6번 설정 화면 테스트 공용: 실제 커널 SettingsStore + 메모리 브라우저 저장소로 화면을 그린다 */
export async function renderScreen(
  over: Partial<SettingsScreenProps> & { m?: MemorySettings; storageInit?: Record<string, string> } = {},
) {
  const m = over.m ?? memorySettings();
  const storage = memoryStorage(over.storageInit);
  const r = render(<SettingsScreen api={m.api} storage={storage} onBrowserChange={() => {}} {...over} />);
  await screen.findByRole('tablist', { name: '설정 묶음' });
  return { m, storage, ...r };
}

/** 탭을 누르고 그 묶음 영역이 그려질 때까지 기다린다 */
export async function openTab(title: string) {
  const tab = screen.getByRole('tab', { name: title });
  fireEvent.click(tab);
  return await screen.findByRole('region', { name: title });
}

/** 영역 안 항목 키 목록 */
export const keysIn = (el: HTMLElement) =>
  [...el.querySelectorAll('[data-setting-key]')].map((e) => e.getAttribute('data-setting-key')!);

/** 영역 안 항목 제목 목록 */
export const titlesIn = (el: HTMLElement) =>
  [...el.querySelectorAll('.hx-setting__title')].map((e) => e.textContent);

export const tabTitles = () =>
  within(screen.getByRole('tablist', { name: '설정 묶음' }))
    .getAllByRole('tab')
    .map((t) => t.textContent);

/**
 * 다른 구역이 나중에 등록할 키를 미리 넣은 레지스트리 — "그 구역이 등록하면 이 탭에 저절로 나타난다"를 보이는 데 쓴다
 */
export function registryWith(...extra: SettingDef[]): SettingsRegistry {
  // 그 구역이 이미 등록했으면(병합 뒤) 진짜 등록을 쓴다
  const core = new Set(CORE_SETTINGS.map((d) => d.key));
  return new SettingsRegistry([...CORE_SETTINGS, ...extra.filter((d) => !core.has(d.key))]);
}

/** 영역 안에서 이 키들의 항목만 (다른 구역이 같은 탭에 키를 더해도 스냅샷이 흔들리지 않게) */
export function rowsOf(el: HTMLElement, keys: readonly string[]): HTMLElement[] {
  return keys.map((k) => el.querySelector(`[data-setting-key="${k}"]`) as HTMLElement);
}
