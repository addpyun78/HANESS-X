// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { memorySettings } from './settings-form-fixtures.js';
import { openTab, renderScreen } from './settings-screen-fixtures.js';

/** T-101 6B.12 플러그인 탭: 설치된 플러그인별 설정(0A.9 configSchema 자동 포함) */

afterEach(cleanup);

const SAMPLE = {
  id: 'sample-notes',
  displayName: '샘플 메모',
  configSchema: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', default: true, title: '메모 켜기', description: '작업마다 메모를 남겨요.' },
      style: { type: 'string', enum: ['short', 'long'], default: 'short', title: '메모 길이' },
    },
  },
};

describe('6B.12 플러그인', () => {
  it('설치된 플러그인마다 소제목 아래 그 플러그인 설정 (스냅샷)', async () => {
    const m = memorySettings({ plugins: [SAMPLE, { id: 'no-config', displayName: '설정 없는 것' }] });
    await renderScreen({ m });
    const sec = await openTab('플러그인');
    const blocks = [...sec.querySelectorAll('[data-setting-plugin]')].map(
      (b) => b.querySelector('h4')!.textContent,
    );
    expect(blocks).toEqual(['샘플 메모']);
    const sample = sec.querySelector('[data-setting-plugin="sample-notes"]') as HTMLElement;
    expect(within(sample).getByText('메모 켜기')).toBeTruthy();
    expect(within(sample).getByLabelText('메모 길이')).toBeTruthy();
    expect(sec).toMatchSnapshot();
    // 동작: 끄면 plugins.<id>.<속성>으로 저장
    fireEvent.click(within(sample).getByRole('switch'));
    await waitFor(() =>
      expect(m.store.readGlobal()).toEqual({ plugins: { 'sample-notes': { enabled: false } } }),
    );
    m.dispose();
  });

  it('설정이 있는 플러그인이 없으면 쉬운 말 안내', async () => {
    const m = memorySettings();
    await renderScreen({ m, initialTab: 'plugins' });
    const sec = await screen.findByRole('region', { name: '플러그인' });
    expect(within(sec).getByText('아직 바꿀 수 있는 설정이 없어요.')).toBeTruthy();
    m.dispose();
  });
});
