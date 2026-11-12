// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { settingsRegistry } from '../../../packages/kernel/src/settings/registry.js';
import { renderScreen } from './settings-screen-fixtures.js';

/**
 * T-101 6C.2 "고급 설정 보기"는 꺼짐이 기본, 초보자에게 필요한 항목만 보인다 — 기본 노출 항목 수 테스트.
 * 탭 13개를 차례로 열어 기본 화면에 보이는 항목 수를 센다(레지스트리의 advanced:false 이고 전체 범위인 키 수와 같아야 함).
 */

afterEach(cleanup);

const shownCount = () => document.querySelectorAll('[data-setting-key]').length;

async function countAll(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const tab of screen.getAllByRole('tab')) {
    fireEvent.click(tab);
    const id = tab.getAttribute('data-group')!;
    await waitFor(() => expect(document.querySelector(`[data-setting-group="${id}"]`)).toBeTruthy());
    out[id] = shownCount();
  }
  return out;
}

describe('6C.2 고급 설정 보기', () => {
  it('기본은 꺼짐: 고급이 아닌 항목만 보이고, 켜면 전부 보인다 (기본 노출 항목 수)', async () => {
    const { m } = await renderScreen();
    expect(screen.getByRole('checkbox', { name: '고급 설정 보기' })).toHaveProperty('checked', false);
    const defs = settingsRegistry.list().filter((d) => d.scope !== 'project');
    const basic = defs.filter((d) => !d.advanced);
    const byGroup = (list: typeof defs) =>
      Object.fromEntries(
        [...new Set(defs.map((d) => d.group))].map((g) => [g, list.filter((d) => d.group === g).length]),
      );

    const off = await countAll();
    const offTotal = Object.values(off).reduce((a, b) => a + b, 0);
    expect(offTotal).toBe(basic.length);
    for (const [g, n] of Object.entries(byGroup(basic))) expect(off[g], g).toBe(n);
    // 초보자 화면은 전체보다 확실히 적다 (고급 항목이 숨는다)
    expect(offTotal).toBeLessThan(defs.length);
    expect(off.judge).toBe(2);

    fireEvent.click(screen.getByRole('checkbox', { name: '고급 설정 보기' }));
    const on = await countAll();
    expect(Object.values(on).reduce((a, b) => a + b, 0)).toBe(defs.length);
    m.dispose();
  });
});
