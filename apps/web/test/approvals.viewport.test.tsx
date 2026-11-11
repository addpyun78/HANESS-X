// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApprovalsArea } from '../src/panels/Approvals/ApprovalsArea.js';
import { AppShell } from '../src/shell/AppShell.js';
import { CSS_FILE, fixtureCard } from './approvals-fixtures.js';

/** 뷰포트 너비를 흉내 내는 matchMedia (max-width 쿼리만 해석) — shell.viewport.test와 같은 방식 */
let width = 1280;
const listeners = new Set<() => void>();
beforeEach(() => {
  width = 1280;
  window.matchMedia = ((q: string) => {
    const max = Number(/max-width:\s*([\d.]+)px/.exec(q)?.[1] ?? Infinity);
    return {
      get matches() {
        return width <= max;
      },
      media: q,
      addEventListener: (_: string, l: () => void) => listeners.add(l),
      removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
});
afterEach(() => {
  cleanup();
  listeners.clear();
});

const shell = () =>
  render(
    <AppShell
      topBar={{ runState: 'idle', quotas: [] }}
      sidebar={<nav aria-label="세션 사이드바">사이드</nav>}
      main={<div>채팅</div>}
      panelTop={<ApprovalsArea cards={[fixtureCard('path-1')]} onChoose={() => {}} />}
    />,
  );

/** CSS 규칙 본문 */
function rule(css: string, selector: string): string {
  const i = css.indexOf(`${selector} {`);
  return i < 0 ? '' : css.slice(i, css.indexOf('}', i));
}

describe('H.15 모바일(768px 미만) 하단 시트, 버튼 높이 48px 이상', () => {
  it('767px 뷰포트 스냅샷: 패널은 접혀도 카드는 하단 시트로 보인다', () => {
    width = 767;
    shell();
    expect(screen.queryByLabelText('우측 패널')).toBeNull();
    const sheet = screen.getByRole('dialog', { name: '확인이 필요해요' });
    expect(sheet.dataset.variant).toBe('sheet');
    expect(sheet.className).toContain('hx-approvals--sheet');
    expect(sheet.querySelectorAll('button[data-choice]')).toHaveLength(4);
    expect(sheet).toMatchSnapshot();
  });

  it('1280px → 패널 안, 줄이면 시트로 바뀐다', () => {
    shell();
    const panel = screen.getByLabelText('우측 패널');
    expect(panel.querySelector('[data-variant="panel"]')).toBeTruthy();
    act(() => {
      width = 700;
      listeners.forEach((l) => l());
    });
    expect(screen.getByRole('dialog', { name: '확인이 필요해요' }).dataset.variant).toBe('sheet');
  });

  it('CSS: 시트는 화면 아래 고정, 버튼·체크 상자·자세히 보기 48px 이상', () => {
    const css = readFileSync(CSS_FILE, 'utf8');
    const sheet = rule(css, '.hx-approvals--sheet');
    expect(sheet).toMatch(/position: fixed/);
    expect(sheet).toMatch(/bottom: 0/);
    for (const sel of [
      '.hx-action-card__btn',
      '.hx-action-card__check',
      '.hx-action-card__more',
      '.hx-approvals__undo',
    ]) {
      const h = Number(/min-height: (\d+)px/.exec(rule(css, sel))?.[1] ?? 0);
      expect(h, sel).toBeGreaterThanOrEqual(48);
    }
    expect(rule(css, '.hx-approvals--sheet .hx-action-card__btn')).toMatch(/flex: 1 1 100%/);
  });
});
