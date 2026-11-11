// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Routes } from '../src/Routes.js';
import { fixturePlan } from './install-fixtures.js';
import { pickerCandidate } from './toolpicker-fixtures.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
});

type Handler = (body: unknown, headers: Headers) => unknown;

/** 가짜 하네스 서버 (fetch + 이벤트 WebSocket이 events를 흘려보낸다) */
function boot(routes: Record<string, Handler>, events: unknown[] = [], hash = '') {
  const calls: { method: string; path: string; body: unknown; gesture: string | null }[] = [];
  history.replaceState(null, '', `/?token=t0k${hash}`);
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init.method ?? 'GET').toUpperCase();
    const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const headers = new Headers(init.headers);
    calls.push({ method, path: url.pathname, body, gesture: headers.get('x-harness-gesture') });
    const h = routes[`${method} ${url.pathname}`];
    const r = h
      ? h(body, headers)
      : url.pathname === '/api/plugins'
        ? { plugins: [], rejected: [] }
        : undefined;
    if (r === undefined) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
    return new Response(JSON.stringify(r), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  class FakeWS {
    static OPEN = 1;
    readyState = 0;
    onopen?: () => void;
    onclose?: () => void;
    onmessage?: (m: { data: string }) => void;
    onerror?: () => void;
    constructor(url: string) {
      if (!url.includes('/ws/events')) return;
      setTimeout(() => {
        this.readyState = 1;
        this.onopen?.();
        this.onmessage?.({ data: JSON.stringify({ type: 'hello' }) });
        for (const e of events) this.onmessage?.({ data: JSON.stringify(e) });
      }, 0);
    }
    send() {}
    close() {}
  }
  vi.stubGlobal('WebSocket', FakeWS);
  render(<Routes />);
  return { calls };
}

const candidate = pickerCandidate({ id: 'winget:Gyan.FFmpeg', name: 'ffmpeg', recommended: true });
const need = {
  capability: '동영상에서 소리 뽑기',
  why: '',
  constraints: { os: 'windows', offline: false, budget: 'free-first' },
  source: 'engine',
};
const pickerEvent = {
  id: 'ev-tp',
  ts: '2026-11-11T00:00:00.000Z',
  sessionId: 'tools',
  type: 'approval_request',
  approvalId: 'tool-picker-1',
  kind: 'tool.picker',
  title: '이 작업에 도구가 필요해요',
  detail: {
    result: { status: 'candidates', need, candidates: [candidate], recommendedId: candidate.id, notices: [] },
  },
  options: ['install', 'url', 'skip'],
};

describe('Part 2·3 실제 앱 연결 (App)', () => {
  it('② 도구 고르기 카드가 승인 카드 영역에 뜨고, [선택한 걸로 설치] → 계획 카드(Part 2) → [설치]는 클릭 토큰', async () => {
    const plan = fixturePlan({ id: 'plan_ffmpeg' });
    const { calls } = boot(
      {
        'POST /api/tools/plan-selected': () => ({ plans: [{ candidateId: candidate.id, plan }] }),
        'POST /api/gesture-tokens': () => ({ token: 'tok', id: 'g' }),
        'POST /api/install/execute': (_b, h) =>
          h.get('x-harness-gesture') === 'tok'
            ? { id: 'job', planId: plan.id, action: 'install', status: 'queued' }
            : undefined,
      },
      [pickerEvent],
    );
    const area = await screen.findByRole('region', { name: '확인이 필요해요' });
    const picker = await within(area).findByRole('group', { name: /도구가 필요해요/ });
    await act(
      async () => void fireEvent.click(within(picker).getByRole('button', { name: /선택한 걸로 설치/ })),
    );
    const card = await within(area).findByRole('group', { name: /설치해도 될까요/ });
    expect(calls.find((c) => c.path === '/api/tools/plan-selected')!.body).toMatchObject({
      candidates: [{ id: candidate.id }],
    });
    expect(calls.some((c) => c.path === '/api/install/execute')).toBe(false);
    await act(async () => void fireEvent.click(within(card).getByRole('button', { name: '설치' })));
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/api/install/execute')).toMatchObject({ gesture: 'tok' }),
    );
  });

  it('③ #/install/url 경로 = 설치 관리의 [주소로 설치] 화면 (도구 고르기 [주소 직접 넣기]가 여는 곳)', async () => {
    boot({ 'GET /api/install/tools': () => ({ tools: [] }) }, [], '#/install/url');
    const tab = await screen.findByRole('tab', { name: '주소로 설치' });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('textbox', { name: '설치할 주소' })).toBeTruthy();
  });

  it('③ 도구 고르기 카드의 [주소 직접 넣기] → #/install/url → 주소로 설치 화면', async () => {
    boot({ 'GET /api/install/tools': () => ({ tools: [] }) }, [pickerEvent]);
    const picker = await screen.findByRole('group', { name: /도구가 필요해요/ });
    await act(
      async () => void fireEvent.click(within(picker).getByRole('button', { name: /주소 직접 넣기/ })),
    );
    expect((await screen.findByRole('tab', { name: '주소로 설치' })).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByRole('textbox', { name: '설치할 주소' })).toBeTruthy();
  });
});
