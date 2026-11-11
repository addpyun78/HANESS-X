import { fireEvent, render, screen, within } from '@testing-library/react';
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
