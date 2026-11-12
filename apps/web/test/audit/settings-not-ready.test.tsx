// @vitest-environment jsdom
// T-102 E.C2-004.1 재현: 바꿔도 효과 없는 설정 4개(assist.model·verifier.local.baseUrl·model·timeoutMs)는
// 설정 화면에서 비활성 + "준비 중이에요"로 보여야 한다(껍데기 숨김 규칙 E.3)
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { NOT_READY } from '../../src/actions/registry.js';
import { CORE_SETTINGS } from '../../../../packages/kernel/src/settings/registry.js';
import { openTab, renderScreen } from '../settings-screen-fixtures.js';

afterEach(cleanup);
const KEYS = ['assist.model', 'verifier.local.baseUrl', 'verifier.local.model', 'verifier.local.timeoutMs'];

describe('효과 없는 설정 숨김 (T-102 C2-004)', () => {
  it('레지스트리에 준비 중 이유가 있다', () => {
    for (const k of KEYS)
      expect((CORE_SETTINGS.find((d) => d.key === k) as { notReady?: string }).notReady, k).toBeTruthy();
  });

  it('설정 화면에서 비활성 + "준비 중이에요" 표시', async () => {
    const { m } = await renderScreen({});
    fireEvent.click(screen.getByRole('checkbox', { name: '고급 설정 보기' }));
    for (const [tab, keys] of [
      ['도구·설치', ['assist.model']],
      ['판정', KEYS.slice(1)],
    ] as const) {
      const region = await openTab(tab);
      for (const k of keys) {
        const row = await waitFor(() => {
          const el = region.querySelector(`[data-setting-key="${k}"]`) as HTMLElement | null;
          if (!el) throw new Error(`${k} 없음`);
          return el;
        });
        expect(row.textContent, k).toContain(NOT_READY);
        const inputs = row.querySelectorAll('input, select, button:not(.hx-setting__link)');
        expect(inputs.length, k).toBeGreaterThan(0);
        for (const i of inputs) expect((i as HTMLInputElement).disabled, k).toBe(true);
      }
    }
    m.dispose();
  });
});
