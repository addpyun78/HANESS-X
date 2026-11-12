// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { applyBrowserSetting, applyUiPrefs } from '../src/design/ui-prefs.js';
import { keysIn, openTab, renderScreen, tabTitles, titlesIn } from './settings-screen-fixtures.js';

/** T-101 6B.1 설정 화면 뼈대(13개 탭 · 고급 설정 보기) + 일반 탭: 테마·글자 크기·움직임 줄이기·언어 */

afterEach(() => {
  cleanup();
  const root = document.documentElement;
  delete root.dataset.fontSize;
  delete root.dataset.reduceMotion;
  delete root.dataset.theme;
  localStorage.clear();
});

describe('6B.1 일반', () => {
  it('설계 그림대로 13개 탭이 있고, 처음엔 일반 탭: 테마·글자 크기·움직임 줄이기·언어 (스냅샷)', async () => {
    const { m } = await renderScreen();
    expect(tabTitles()).toEqual([
      '일반',
      'AI·엔진',
      '모드·권한',
      '체크리스트',
      '판정',
      '승인·알림',
      '도구·설치',
      '첨부',
      '음성',
      '프로젝트',
      '데이터·보안',
      '플러그인',
      '정보',
    ]);
    expect(screen.getByRole('tab', { name: '일반' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('checkbox', { name: '고급 설정 보기' })).toHaveProperty('checked', false);
    const general = await screen.findByRole('region', { name: '일반' });
    expect(keysIn(general)).toEqual(['ui.theme', 'ui.fontSize', 'ui.reduceMotion', 'ui.language']);
    expect(titlesIn(general)).toEqual(['화면 테마', '글자 크기', '움직임 줄이기', '화면 언어']);
    expect(general).toMatchSnapshot();
    m.dispose();
  });

  it('고른 값은 이 기기 저장소에 남고 화면에 바로 적용된다', async () => {
    const { m, storage } = await renderScreen({
      onBrowserChange: (f, v) => applyBrowserSetting(f.browserKey!, v),
    });
    const general = await openTab('일반');
    const font = within(general).getByLabelText('글자 크기');
    fireEvent.change(font, { target: { value: 'large' } });
    expect(storage.map.get('hx.ui.font-size')).toBe('large');
    expect(document.documentElement.dataset.fontSize).toBe('large');
    fireEvent.change(within(general).getByLabelText('움직임 줄이기'), { target: { value: 'on' } });
    expect(storage.map.get('hx.ui.reduce-motion')).toBe('on');
    expect(document.documentElement.dataset.reduceMotion).toBe('on');
    fireEvent.change(within(general).getByLabelText('화면 테마'), { target: { value: 'dark' } });
    expect(document.documentElement.dataset.theme).toBe('dark');
    // 보통 글자 = 속성 없음
    fireEvent.change(font, { target: { value: 'medium' } });
    expect(document.documentElement.dataset.fontSize).toBeUndefined();
    m.dispose();
  });

  it('앱 시작 때 저장된 글자 크기·움직임·언어를 적용한다 (잘못된 값은 무시)', () => {
    localStorage.setItem('hx.ui.font-size', 'small');
    localStorage.setItem('hx.ui.reduce-motion', 'weird');
    applyUiPrefs();
    const root = document.documentElement;
    expect(root.dataset.fontSize).toBe('small');
    expect(root.dataset.reduceMotion).toBeUndefined();
    expect(root.lang).toBe('ko');
  });
});
