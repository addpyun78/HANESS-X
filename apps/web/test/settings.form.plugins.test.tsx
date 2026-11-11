// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SettingsForm } from '../src/settings/form/SettingsForm.js';
import { memorySettings, type MemorySettings } from './settings-form-fixtures.js';

let m: MemorySettings | undefined;
afterEach(() => {
  cleanup();
  m?.dispose();
  m = undefined;
});

/** 샘플 플러그인 매니페스트의 configSchema */
const SAMPLE = {
  id: 'sample-notes',
  displayName: '샘플 메모',
  configSchema: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', default: true, title: '메모 켜기', description: '작업마다 메모를 남겨요.' },
      style: { type: 'string', enum: ['short', 'long'], default: 'short', title: '메모 길이' },
      maxItems: { type: 'integer', minimum: 1, maximum: 20, default: 5, title: '최대 메모 수' },
    },
  },
};
const OTHER = {
  id: 'other.tool',
  displayName: '다른 도구',
  configSchema: { type: 'object', properties: { url: { type: 'string', default: '', title: '주소' } } },
};

describe('T-101 0A.9 샘플 플러그인 설정 표시', () => {
  it('"플러그인" 섹션 아래 플러그인별 소제목 + 위젯, 저장은 plugins.<id>.<속성>', async () => {
    m = memorySettings({ plugins: [SAMPLE, OTHER] });
    render(<SettingsForm api={m.api} groups={['plugins']} />);
    const sec = (await screen.findByRole('region', { name: '플러그인' })) as HTMLElement;
    const blocks = [...sec.querySelectorAll('[data-setting-plugin]')].map((b) => [
      b.getAttribute('data-setting-plugin'),
      b.querySelector('h4')!.textContent,
    ]);
    expect(blocks).toEqual([
      ['sample-notes', '샘플 메모'],
      ['other.tool', '다른 도구'],
    ]);
    const sample = sec.querySelector('[data-setting-plugin="sample-notes"]') as HTMLElement;
    expect(within(sample).getByText('메모 켜기')).toBeTruthy();
    expect(within(sample).getByText('작업마다 메모를 남겨요.')).toBeTruthy();
    expect(within(sample).getByRole('switch').getAttribute('aria-checked')).toBe('true');
    expect(within(sample).getAllByText('다시 시작 필요')).toHaveLength(3);

    const num = sample.querySelector(
      '[data-setting-key="plugins.sample-notes.maxItems"] input',
    ) as HTMLInputElement;
    fireEvent.change(num, { target: { value: '50' } });
    await act(async () => fireEvent.blur(num));
    expect((await within(sample).findByRole('alert')).textContent).toBe('20 이하로 넣어 주세요.');
    fireEvent.change(num, { target: { value: '7' } });
    await act(async () => fireEvent.blur(num));
    await act(async () => {
      fireEvent.change(within(sample).getByRole('combobox'), { target: { value: 'long' } });
    });
    expect(m.store.readGlobal()).toEqual({ plugins: { 'sample-notes': { maxItems: 7, style: 'long' } } });

    // 점이 들어간 플러그인 id도 경로가 깨지지 않는다
    const url = sec.querySelector('[data-setting-key="plugins.other.tool.url"] input') as HTMLInputElement;
    fireEvent.change(url, { target: { value: 'http://127.0.0.1:1' } });
    await act(async () => fireEvent.blur(url));
    expect(m.store.readGlobal().plugins).toMatchObject({ 'other.tool': { url: 'http://127.0.0.1:1' } });
  });

  it('설정이 없는 플러그인만 있으면 빈 안내', async () => {
    m = memorySettings({ plugins: [{ id: 'plain' }] });
    render(<SettingsForm api={m.api} groups={['plugins']} />);
    expect(await screen.findByText('아직 바꿀 수 있는 설정이 없어요.')).toBeTruthy();
  });
});
