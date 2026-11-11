// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Toasts } from '../src/panels/Approvals/Toasts.js';
import { useNotices, type NoticesApi } from '../src/panels/Approvals/useNotices.js';
import { renderApp } from './app-fixtures.js';

/** T-100 J.6 연결: 서버가 남긴 한 번짜리 안내(notice)를 패널이 토스트로 보여 준다 */

const MESSAGE = '더 이상 쓰지 않는 판정 서비스 키를 지웠어요';
const notice = { type: 'notice', noticeId: 'retired-judge-key-removed', level: 'info', message: MESSAGE };

function Harness({ events, api }: { events: unknown[]; api?: NoticesApi }) {
  const n = useNotices({ events, ...(api ? { api } : {}) });
  return <Toasts toasts={n.toasts} onDismiss={n.dismiss} />;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('J.6 안내(notice) 토스트', () => {
  it('notice 이벤트 → 토스트 1개, 같은 안내가 두 번 와도 1개, 누르면 닫히고 다시 안 뜸', () => {
    const { rerender } = render(<Harness events={[notice, notice]} />);
    expect(screen.getAllByRole('button', { name: MESSAGE })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: MESSAGE }));
    expect(screen.queryByText(MESSAGE)).toBeNull();
    rerender(<Harness events={[notice, notice, { type: 'turn_end' }]} />);
    expect(screen.queryByText(MESSAGE)).toBeNull();
  });

  it('서버 시작 때 남긴 안내(GET /api/notices) + 이벤트가 겹쳐도 1개', async () => {
    const api: NoticesApi = { list: async () => [notice] };
    render(<Harness events={[notice]} api={api} />);
    await act(async () => {});
    expect(screen.getAllByText(MESSAGE)).toHaveLength(1);
  });

  it('App: 서버의 GET /api/notices 안내를 토스트로 띄운다', async () => {
    const r = renderApp({
      'GET /api/notices': () => ({ body: { notices: [notice] } }),
    });
    expect(await screen.findByRole('button', { name: MESSAGE })).toBeTruthy();
    expect(r.calls.some((c) => c.method === 'GET' && c.path === '/api/notices')).toBe(true);
  });

  it('App: /api/notices가 없는 서버(404)면 안내 없음', async () => {
    const r = renderApp();
    await act(async () => {
      await new Promise((res) => setTimeout(res, 50));
    });
    expect(r.calls.some((c) => c.path === '/api/notices')).toBe(true);
    expect(screen.queryByText(MESSAGE)).toBeNull();
  });
});
