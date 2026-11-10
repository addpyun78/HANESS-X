// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiError, HarnessApiClient } from '../src/api/client.js';
import { checklistApi } from '../src/panels/Checklist/api.js';
import { ChecklistPanel } from '../src/panels/Checklist/ChecklistPanel.js';
import { pendingApprovals } from '../src/panels/Checklist/model.js';
import { ev, fakeApi, view } from './checklist-fixtures.js';

afterEach(cleanup);

const APPROVAL = ev(1, {
  type: 'approval_request',
  itemId: '2',
  approvalId: 'ap-1',
  kind: 'ladder.l5',
  title: '경로 판정 확인: harness/mobile ↔ ai/mobile',
  detail: {
    itemId: '2',
    artifactId: 'art.mobile-app',
    expectedPath: 'harness/mobile',
    actualPath: 'ai/mobile',
    reason: 'L4 p=0.72 (0.6~0.9) / codex: 이동으로 보임',
    buttons: [
      { id: 'equivalent', label: '동치 인정' },
      { id: 'move', label: '이동 승인' },
      { id: 'fail', label: '실패' },
    ],
  },
  options: ['equivalent', 'move', 'fail'],
});

describe('36.4 승인 카드', () => {
  it('ladder.l5 승인 요청만 카드로 (다른 kind·세션 제외)', () => {
    const other = ev(2, {
      type: 'approval_request',
      approvalId: 'g-1',
      kind: 'glossary.unknown-terms',
      title: '영문 이름',
      options: ['cancel'],
    });
    expect(pendingApprovals([APPROVAL, other], 's-ck').map((a) => a.approvalId)).toEqual(['ap-1']);
    expect(pendingApprovals([APPROVAL], 'x')).toEqual([]);
    expect(pendingApprovals([APPROVAL], 's-ck', new Set(['ap-1']))).toEqual([]);
  });

  it('예상/실제 경로 + 버튼 3개, 클릭하면 POST /api/approvals/:id {decision} 호출 후 카드가 사라진다', async () => {
    const requests: { url: string; method?: string; body?: unknown }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit = {}) => {
      requests.push({
        url,
        method: init.method,
        body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      });
      const body = url.endsWith('/api/checklist/s-ck') ? view() : { id: 'ap-1', decision: 'move' };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    const api = checklistApi(
      new HarnessApiClient({ baseUrl: 'http://hx.test', token: 't', fetch: fetchImpl }),
    );
    render(<ChecklistPanel events={[APPROVAL]} api={api} />);
    const card = await screen.findByRole('group', { name: '경로 판정 승인: 2' });
    expect(within(card).getByTestId('approval-expected').textContent).toBe('harness/mobile');
    expect(within(card).getByTestId('approval-actual').textContent).toBe('ai/mobile');
    expect(card.textContent).toContain('L4 p=0.72');
    expect(
      within(card)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['동치 인정', '이동 승인', '실패']);
    act(() => within(card).getByRole('button', { name: '이동 승인' }).click());
    await waitFor(() => expect(screen.queryByRole('group', { name: '경로 판정 승인: 2' })).toBeNull());
    expect(requests).toContainEqual({
      url: 'http://hx.test/api/approvals/ap-1',
      method: 'POST',
      body: { decision: 'move' },
    });
    // 응답 후 항목 상태를 다시 읽는다
    await waitFor(() =>
      expect(requests.filter((r) => r.url === 'http://hx.test/api/checklist/s-ck').length).toBe(2),
    );
  });

  it('각 버튼이 해당 decision으로 호출되고, 실패하면 카드에 오류를 남긴다', async () => {
    for (const [label, decision] of [
      ['동치 인정', 'equivalent'],
      ['실패', 'fail'],
    ] as const) {
      const api = fakeApi();
      render(<ChecklistPanel events={[APPROVAL]} api={api} initialView={view()} />);
      act(() => screen.getByRole('button', { name: label }).click());
      await waitFor(() =>
        expect(api.calls.find((c) => c.method === 'resolveApproval')).toEqual({
          method: 'resolveApproval',
          args: ['ap-1', decision],
        }),
      );
      cleanup();
    }
    const api = fakeApi({
      resolveApproval: async () => {
        throw new ApiError(404, { error: 'not_found', message: '없는 승인 요청' });
      },
    });
    render(<ChecklistPanel events={[APPROVAL]} api={api} initialView={view()} />);
    act(() => screen.getByRole('button', { name: '동치 인정' }).click());
    const card = screen.getByRole('group', { name: '경로 판정 승인: 2' });
    expect((await within(card).findByRole('alert')).textContent).toBe('없는 승인 요청');
  });
});
