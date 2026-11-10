// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { applyChecklistChange } from '../src/panels/Checklist/model.js';
import { ev, fakeApi, FakeEventStream, ITEMS, S, StreamedPanel, view } from './checklist-fixtures.js';

afterEach(cleanup);

const statusOf = (id: string) =>
  within(screen.getByRole('tree'))
    .getAllByRole('treeitem')
    .find((r) => r.querySelector('.hx-ck-row__id')?.textContent === id)
    ?.getAttribute('data-status');

describe('36.2 실시간 갱신', () => {
  it('checklist_change를 받으면 1초 안에 상태·진행률·현재 항목 반영 (가짜 이벤트 스트림, 서버 재조회 없이)', async () => {
    const stream = new FakeEventStream();
    render(<StreamedPanel stream={stream} initialView={view()} />);
    expect(statusOf('2')).toBe('doing');
    const t0 = performance.now();
    act(() => {
      stream.emit(
        ev(1, { type: 'checklist_change', changedItemId: '2', from: 'doing', to: 'verifying', version: 8 }),
      );
      stream.emit(
        ev(2, { type: 'checklist_change', changedItemId: '2', from: 'verifying', to: 'done', version: 9 }),
      );
    });
    await waitFor(() => expect(statusOf('2')).toBe('done'), { timeout: 1000 });
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(screen.getByTestId('checklist-progress').textContent).toBe('3/5 완료 · 60%');
    // 2가 끝났으므로 의존이 풀린 2.1이 현재 항목
    expect(
      screen.getByRole('treeitem', { current: 'step' }).querySelector('.hx-ck-row__id')?.textContent,
    ).toBe('2.1');
    // 다른 세션·옛 version 이벤트는 무시
    act(() => {
      stream.emit({
        ...ev(3, { type: 'checklist_change', changedItemId: '3', from: 'todo', to: 'doing', version: 10 }),
        sessionId: 'other',
      });
      stream.emit(
        ev(4, { type: 'checklist_change', changedItemId: '2', from: 'done', to: 'failed', version: 5 }),
      );
    });
    expect(statusOf('3')).toBe('todo');
    expect(statusOf('2')).toBe('done');
  });

  it('API가 있으면 checklist_change 뒤 재조회해 증거·판정까지 1초 안에 갱신', async () => {
    const updated = view(
      {},
      ITEMS.map((i) =>
        i.id === '2'
          ? {
              ...i,
              status: 'done' as const,
              evidence: [{ kind: 'test_run', summary: '로그인 테스트 통과' }],
            }
          : i,
      ),
    );
    updated.checklist.version = 9;
    let calls = 0;
    const api = fakeApi({ get: async () => (++calls === 1 ? view() : updated) });
    const stream = new FakeEventStream();
    render(<StreamedPanel stream={stream} api={api} sessionId={S} />);
    await waitFor(() => expect(statusOf('2')).toBe('doing'));
    const t0 = performance.now();
    act(() =>
      stream.emit(
        ev(1, { type: 'checklist_change', changedItemId: '2', from: 'doing', to: 'done', version: 9 }),
      ),
    );
    await waitFor(() => expect(api.calls.filter((c) => c.method === 'get')).toHaveLength(2), {
      timeout: 1000,
    });
    expect(performance.now() - t0).toBeLessThan(1000);
    act(() => screen.getByRole('button', { name: /^2 로그인 화면 구현/ }).click());
    await waitFor(
      () => expect(screen.getByTestId('checklist-detail-2').textContent).toContain('로그인 테스트 통과'),
      { timeout: 1000 },
    );
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(api.calls[0]).toEqual({ method: 'get', args: [S] });
  });

  it('removed 이벤트는 항목을 뺀다', () => {
    const v = applyChecklistChange(
      view(),
      ev(1, { type: 'checklist_change', changedItemId: '3', from: 'todo', to: 'removed', version: 8 }),
    );
    expect(v.checklist.items.map((i) => i.id)).toEqual(['1', '1.1', '2', '2.1']);
    expect(v.checklist.version).toBe(8);
  });
});
