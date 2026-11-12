// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { keysIn, renderScreen } from './settings-screen-fixtures.js';

/** T-101 6B.7 도구·설치 탭: 비용 기준(무료만/무료 먼저/상관없음)·검색 공급자(브레이브·내 검색 서버)·설치 도구 켜기(초코) */

afterEach(cleanup);

describe('6B.7 도구·설치', () => {
  it('비용 기준·브레이브 검색·키·초코 설치가 보이고 내 검색 서버는 고급 (스냅샷)', async () => {
    const { m } = await renderScreen({ initialTab: 'tools' });
    const tools = await screen.findByRole('region', { name: '도구·설치' });
    expect(keysIn(tools)).toEqual([
      'tools.budget',
      'tools.brave',
      'tools.braveKey',
      'installer.chocoEnabled',
    ]);
    const budget = within(tools).getByLabelText('도구 비용 기준');
    expect([...budget.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      '무료만',
      '무료 먼저',
      '상관없음',
    ]);
    expect(tools).toMatchSnapshot();
    fireEvent.click(screen.getByRole('checkbox', { name: '고급 설정 보기' }));
    await waitFor(() =>
      expect(keysIn(screen.getByRole('region', { name: '도구·설치' }))).toContain('tools.searxng'),
    );
    m.dispose();
  });

  it('초코로 설치하기를 켜면 저장되고 "다시 시작하면 적용돼요"', async () => {
    const { m } = await renderScreen({ initialTab: 'tools' });
    const tools = await screen.findByRole('region', { name: '도구·설치' });
    const row = tools.querySelector('[data-setting-key="installer.chocoEnabled"]') as HTMLElement;
    fireEvent.click(within(row).getByRole('switch'));
    expect((await within(row).findByRole('status')).textContent).toBe('다시 시작하면 적용돼요.');
    expect(m.store.readGlobal()).toEqual({ installer: { chocoEnabled: true } });
    m.dispose();
  });
});
