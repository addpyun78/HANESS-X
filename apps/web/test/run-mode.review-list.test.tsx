// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  REVIEW_ACTION_LABEL,
  REVIEW_KIND_LABEL,
  ReviewListSection,
  type ReviewItemView,
} from '../src/run-mode/ReviewListSection.js';
import { checkPlainKorean } from './plain-check.js';

afterEach(cleanup);

const ITEMS: ReviewItemView[] = [
  {
    id: 'r1',
    kind: 'permission',
    reason: '작업 폴더 밖에 파일을 쓰려고 해서 하지 않았어요.',
    itemId: '1',
    actions: ['allow', 'deny'],
    at: '2026-11-12T09:00:00.000Z',
  },
  {
    id: 'r2',
    kind: 'human-only',
    reason: '프로그램 설치는 사람이 직접 해야 해서 하지 않았어요. 돌아오시면 확인해 주세요.',
    actions: ['do-it', 'dismiss'],
    at: '2026-11-12T09:01:00.000Z',
  },
  {
    id: 'r3',
    kind: 'verdict',
    reason: '다시 만들어도 맞지 않아서 멈춰 뒀어요. 카드를 보고 정해 주세요.',
    itemId: '2.1',
    actions: ['open'],
    at: '2026-11-12T09:02:00.000Z',
  },
];

// T-101 3D.7 "돌아오면 확인할 것" 패널 섹션: 항목별 이유(쉬운 말) + 처리 버튼
describe('3D.7 돌아오면 확인할 것', () => {
  it('항목별 이유 + 처리 버튼 (스냅샷)', () => {
    const { container } = render(<ReviewListSection items={ITEMS} onAction={() => {}} />);
    const sec = screen.getByRole('region', { name: '돌아오면 확인할 것' });
    expect(sec.querySelector('.hx-review__count')!.textContent).toBe('3');
    expect(sec.querySelectorAll('.hx-review__item')).toHaveLength(3);
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('화면 문구는 모두 쉬운 말', () => {
    for (const t of ITEMS.map((i) => i.reason)) expect(checkPlainKorean(t).ok, t).toBe(true);
    const labels = [
      ...Object.values(REVIEW_ACTION_LABEL),
      ...Object.values(REVIEW_KIND_LABEL).map((k) => k.label),
    ];
    for (const t of labels) expect(checkPlainKorean(t, { label: true }).ok, t).toBe(true);
  });

  it('처리 버튼 → onAction(id, 처리)', () => {
    const onAction = vi.fn();
    render(<ReviewListSection items={ITEMS} onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', { name: '하지 않기' }));
    fireEvent.click(screen.getByRole('button', { name: '직접 하기' }));
    expect(onAction.mock.calls).toEqual([
      ['r1', 'deny'],
      ['r2', 'do-it'],
    ]);
  });

  it('비었으면 안내 한 줄', () => {
    render(<ReviewListSection items={[]} onAction={() => {}} />);
    expect(screen.getByText('확인할 것이 없어요.')).toBeTruthy();
  });
});
