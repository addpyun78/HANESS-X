// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from '../src/api/client.js';
import { ChecklistPanel } from '../src/panels/Checklist/ChecklistPanel.js';
import { fakeApi, S, view } from './checklist-fixtures.js';

afterEach(cleanup);

const unlocked = (violations: { rule: string; itemId: string; message: string }[] = []) =>
  view({
    plan: { locked: false, revision: 0, artifacts: {} },
    lint: { ok: violations.length === 0, violations },
  });

describe('36.5 Lock 전 계획 검토', () => {
  it('린터 위반을 항목별로 표시하고 [승인]을 막는다', () => {
    render(
      <ChecklistPanel
        events={[]}
        initialView={unlocked([
          { rule: 'R1', itemId: '3', message: '동작이 둘 이상입니다 (하고).' },
          { rule: 'R3', itemId: '2.1', message: 'acceptance가 llm 판단뿐입니다.' },
        ])}
        api={fakeApi()}
      />,
    );
    const review = screen.getByRole('region', { name: '계획 검토' });
    const list = within(review).getByTestId('lint-violations');
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((l) => l.textContent),
    ).toEqual([
      'R1 단일 동사 #3 동작이 둘 이상입니다 (하고).',
      'R3 기계 검증 가능 #2.1 acceptance가 llm 판단뿐입니다.',
    ]);
    const flagged = within(review)
      .getAllByRole('treeitem')
      .filter((r) => r.getAttribute('data-flagged') === 'true')
      .map((r) => r.querySelector('.hx-ck-row__id')?.textContent);
    expect(flagged).toEqual(['2.1', '3']);
    expect((within(review).getByRole('button', { name: '승인' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('위반이 없으면 [승인] → POST lock → 재조회 → 잠긴 트리(진행률)로 바뀐다', async () => {
    let locked = false;
    const api = fakeApi({
      get: async () => (locked ? view() : unlocked()),
      lock: async () => {
        locked = true;
        return { status: 'locked', revision: 1, artifacts: { 'art.mobile-app': 'harness/mobile' } };
      },
    });
    render(<ChecklistPanel events={[]} api={api} sessionId={S} />);
    const review = await screen.findByRole('region', { name: '계획 검토' });
    expect(within(review).getByText('린터 위반 없음')).toBeTruthy();
    act(() => within(review).getByRole('button', { name: '승인' }).click());
    await waitFor(() => expect(screen.queryByRole('region', { name: '계획 검토' })).toBeNull());
    expect(api.calls.filter((c) => c.method === 'lock')).toEqual([{ method: 'lock', args: [S] }]);
    expect(screen.getByRole('progressbar')).toBeTruthy();
  });

  it('서버가 Lock을 거부하면(409) 사유를 보여주고 검토 화면에 남는다', async () => {
    const api = fakeApi({
      get: async () => unlocked(),
      lock: async () => {
        throw new ApiError(409, { status: 'needs_approval', approvalId: 'a', unknownWords: ['결제'] });
      },
    });
    render(<ChecklistPanel events={[]} api={api} sessionId={S} />);
    const review = await screen.findByRole('region', { name: '계획 검토' });
    act(() => within(review).getByRole('button', { name: '승인' }).click());
    expect((await within(review).findByRole('alert')).textContent).toBe('영문 이름 확인이 필요합니다: 결제');
  });
});
