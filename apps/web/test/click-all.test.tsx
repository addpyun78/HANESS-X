// @vitest-environment jsdom
/**
 * T-101 0C.4 "전부 눌러 보기" — e2e/screens.ts의 화면마다 보이는 활성 버튼·링크·메뉴 항목·탭을 하나씩 눌러
 * 2초 안에 효과가 있는지 본다. 실패 목록이 비어 있어야 통과. (`pnpm check:dead-buttons`)
 * HX_DEAD_BUTTONS_REPORT=<경로>면 전체 결과를 JSON으로 남긴다 (0C.6 표 만들기).
 */
import { writeFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { READY_SCREENS, SCREENS } from '../../../e2e/screens.js';
import { clickAll, failures, type ClickResult } from './click-all/click-all.js';
import { RENDERERS } from './click-all/renderers.js';
import { mockReactFlowDom } from './flow-mock.js';
import { mockChatLayout } from './layout-mock.js';

const only = process.env.HX_DEAD_BUTTONS_SCREENS?.split(',').filter(Boolean);
const all: ClickResult[] = [];
let restoreLayout = () => {};
const origMatchMedia = window.matchMedia;

beforeAll(() => {
  mockReactFlowDom();
  restoreLayout = mockChatLayout({ viewport: { width: 800, height: 4000 } });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  restoreLayout();
  const out = process.env.HX_DEAD_BUTTONS_REPORT;
  if (out) writeFileSync(out, JSON.stringify(all, null, 2));
});

const reset = () => {
  history.replaceState(null, '', '/');
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    /* 없음 */
  }
  window.matchMedia = origMatchMedia;
};
afterEach(reset);

describe('0C.5 화면 목록과 그리기 함수가 맞물린다', () => {
  it('준비된 화면마다 그리기 함수가 있고, 목록에 없는 그리기 함수는 없다', () => {
    expect(READY_SCREENS.map((s) => s.id).filter((id) => !RENDERERS[id])).toEqual([]);
    expect(Object.keys(RENDERERS).filter((id) => !SCREENS.some((s) => s.id === id && !s.pending))).toEqual(
      [],
    );
  });
});

describe('0C.4 전부 눌러 보기', () => {
  for (const s of READY_SCREENS) {
    const run = !only || only.includes(s.id);
    it.runIf(run)(
      `${s.id} — ${s.name}`,
      async () => {
        const rs = await clickAll(s.id, RENDERERS[s.id]!, { reset });
        all.push(...rs);
        expect(rs.length, '누를 수 있는 것이 하나도 없어요(그리기 실패?)').toBeGreaterThan(0);
        expect(
          failures(rs).map(
            (r) => `${r.problem}: [${r.action ?? '-'}] ${r.label}${r.detail ? ` — ${r.detail}` : ''}`,
          ),
        ).toEqual([]);
      },
      900_000,
    );
  }
});
