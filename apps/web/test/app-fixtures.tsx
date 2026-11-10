import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { App } from '../src/App.js';

type Handler = (body: unknown, init: RequestInit) => { status?: number; body: unknown } | undefined;

/** App을 가짜 하네스 서버(fetch·WebSocket 스텁)로 띄운다. routes: 'METHOD /path' → 응답 */
export function renderApp(routes: Record<string, Handler> = {}) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  history.replaceState(null, '', '/?token=t0k');
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init.method ?? 'GET').toUpperCase();
    const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: url.pathname, body });
    const h = routes[`${method} ${url.pathname}`];
    const r =
      h?.(body, init) ??
      (url.pathname === '/api/plugins' ? { body: { plugins: [], rejected: [] } } : undefined);
    if (!r) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  class FakeWS {
    static OPEN = 1;
    readyState = 0;
    onopen?: () => void;
    onclose?: () => void;
    onmessage?: (m: unknown) => void;
    onerror?: () => void;
    close() {}
  }
  vi.stubGlobal('WebSocket', FakeWS);
  const r = render(<App />);
  return { ...r, calls, fetchMock };
}
