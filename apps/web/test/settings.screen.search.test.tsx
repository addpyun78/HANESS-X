// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { matchSetting } from '../src/settings/SettingsScreen.js';
import { renderScreen } from './settings-screen-fixtures.js';

/** T-101 6C.1 설정 검색 (제목·설명·키 이름) — 모든 탭에서 찾고(고급 포함), 맞는 묶음만 보인다 */

afterEach(cleanup);

const shown = () =>
  [...document.querySelectorAll('[data-setting-key]')].map((e) => e.getAttribute('data-setting-key'));
const regions = () =>
  [...document.querySelectorAll('[data-setting-group]')].map((e) => e.getAttribute('data-setting-group'));

async function search(q: string) {
  fireEvent.change(screen.getByRole('searchbox', { name: '설정 검색' }), { target: { value: q } });
  await waitFor(() =>
    expect(document.querySelector('[data-setting-key], .hx-settings-form__empty')).toBeTruthy(),
  );
}

describe('6C.1 설정 검색', () => {
  it('matchSetting: 제목·설명·키 이름, 띄어 쓴 말은 모두 들어 있어야, 대소문자 무시', () => {
    const f = { title: '판정할 때 쓸 AI', description: '결과가 맞는지 따져 볼 AI예요.', key: 'judge.engine' };
    expect(matchSetting(f, '판정')).toBe(true);
    expect(matchSetting(f, '따져')).toBe(true);
    expect(matchSetting(f, 'JUDGE.ENG')).toBe(true);
    expect(matchSetting(f, '판정 engine')).toBe(true);
    expect(matchSetting(f, '판정 테마')).toBe(false);
  });

  it('제목으로·설명으로·키 이름으로 찾기 (여러 탭에 걸쳐, 고급 항목 포함)', async () => {
    const { m } = await renderScreen();
    await search('테마');
    expect(shown()).toEqual(['ui.theme']);
    await search('여러 번');
    expect(shown()).toEqual(['judge.samples']); // 고급 항목도 찾는다
    await search('키체인'); // 설명에 없는 말
    expect(shown()).toEqual([]);
    expect(screen.getByRole('status').textContent).toBe('찾는 설정이 없어요. 다른 말로 찾아 보세요.');
    await search('judge.');
    expect(shown()).toEqual(expect.arrayContaining(['judge.engine', 'judge.semantic', 'judge.samples']));
    expect(regions()).toEqual(['judge']);
    await search('engine');
    expect(new Set(regions())).toEqual(new Set(['ai', 'judge', 'tools']));
    // 검색 중에는 어떤 탭도 고른 상태가 아니고, 탭을 누르면 검색을 지운다
    expect(screen.queryByRole('tab', { selected: true })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: '음성' }));
    expect((screen.getByRole('searchbox', { name: '설정 검색' }) as HTMLInputElement).value).toBe('');
    await waitFor(() => expect(shown()).toEqual(['voice.provider']));
    m.dispose();
  });
});
