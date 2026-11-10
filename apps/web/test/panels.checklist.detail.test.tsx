// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ChecklistPanel } from '../src/panels/Checklist/ChecklistPanel.js';
import { ladderSteps } from '../src/panels/Checklist/model.js';
import { ITEMS, view } from './checklist-fixtures.js';

afterEach(cleanup);

describe('36.3 항목 펼침', () => {
  it('사다리 결과: evidence의 L1~L4 기록 + 증거에 없는 항목 verdict(L5)를 덧붙인다', () => {
    expect(ladderSteps(ITEMS[0]!).map((s) => [s.level, s.verdict, s.confidence])).toEqual([
      [3, 'relocated', 0.8],
      [4, 'equal', 0.93],
    ]);
    const l5 = { level: 5, verdict: 'equal', confidence: 1, reason: 'L5 동치 인정 (api)' };
    expect(ladderSteps({ ...ITEMS[0]!, verdict: l5 }).at(-1)).toEqual(l5);
    expect(ladderSteps(ITEMS[2]!)).toEqual([]);
  });

  it('클릭하면 acceptance·evidence·판정 사다리(L, 확률, 사유)를 보여준다 (스냅샷)', () => {
    render(<ChecklistPanel events={[]} initialView={view()} />);
    expect(screen.queryByTestId('checklist-detail-1')).toBeNull();
    const row = screen.getByRole('button', { name: /^1 모바일 앱 폴더 생성/ });
    act(() => row.click());
    expect(row.closest('[role="treeitem"]')?.getAttribute('aria-expanded')).toBe('true');
    const d = screen.getByTestId('checklist-detail-1');

    const acc = within(d).getByRole('region', { name: '검증 조건' });
    expect(
      within(acc)
        .getAllByRole('listitem')
        .map((l) => l.textContent),
    ).toEqual(['file_exists 산출물 존재', 'symbol 심볼 MobileApp in src/index.ts']);

    const ladder = within(d).getByRole('region', { name: '판정 사다리' });
    const steps = within(ladder).getAllByRole('listitem');
    expect(steps.map((s) => s.getAttribute('data-level'))).toEqual(['3', '4']);
    expect(within(ladder).getByLabelText('L3 확률').textContent).toBe('80%');
    expect(within(ladder).getByLabelText('L4 확률').textContent).toBe('93%');
    expect(steps[0]!.textContent).toContain('내용 증거');
    expect(steps[0]!.textContent).toContain('내용 증거 통과: ai/mobile에서 acceptance 2/2');
    expect(steps[1]!.textContent).toContain('경량 판정 모델');
    expect(steps[1]!.textContent).toContain('Jev: 같은 산출물 p=0.93, 동치');

    const evid = within(d).getByRole('region', { name: '증거' });
    expect(
      within(evid)
        .getAllByRole('listitem')
        .map((l) => l.textContent),
    ).toEqual(['test_run pnpm test mobile 통과 00:01:02']);
    expect(d.outerHTML).toMatchSnapshot();

    // 다시 누르면 접힌다, 판정이 없는 항목은 안내
    act(() => row.click());
    expect(screen.queryByTestId('checklist-detail-1')).toBeNull();
    act(() => screen.getByRole('button', { name: /^2 로그인 화면 구현/ }).click());
    expect(screen.getByTestId('checklist-detail-2').textContent).toContain('아직 판정 결과가 없습니다');
  });
});
