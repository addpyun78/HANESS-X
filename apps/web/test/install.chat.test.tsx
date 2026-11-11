// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HarnessApiClient } from '../src/api/client.js';
import { GESTURE_HEADER, installApi } from '../src/install/api.js';
import { InstallPlanCard, ResolveFailureCard } from '../src/install/InstallPlanCard.js';
import { chatInstallCalls, toolOutputValue, useInstallCards } from '../src/install/useInstallCards.js';
import { ApprovalsArea } from '../src/panels/Approvals/ApprovalsArea.js';
import { RESOLVE_FAIL_TITLE } from '../src/install/model.js';
import { fixturePlan } from './install-fixtures.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** 가짜 하네스 서버: 설치 API (실제 설치 없음) */
function fakeServer(over: Partial<Record<string, (body: unknown, h: Headers) => unknown>> = {}) {
  const calls: { method: string; path: string; body: unknown; gesture: string | null }[] = [];
  const plans = new Map<string, unknown>();
  const routes: Record<string, (body: unknown, h: Headers) => unknown> = {
    'POST /api/gesture-tokens': (b) => ({ token: `tok-${(b as { kind: string }).kind}`, id: 'g1' }),
    'POST /api/install/plan': (b) => {
      const req = b as { kind: string; target: { id: string } };
      const p = fixturePlan({
        id: `plan_${req.target.id}`,
        kind: req.kind as never,
        name: req.target.id,
        target: req.target.id,
      });
      plans.set(p.id, p);
      return p;
    },
    'POST /api/install/execute': (b, h) =>
      h.get(GESTURE_HEADER) === 'tok-install'
        ? { id: 'job1', planId: (b as { planId: string }).planId, action: 'install', status: 'queued' }
        : undefined,
    ...over,
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const headers = new Headers(init.headers);
    calls.push({ method, path: url.pathname, body, gesture: headers.get(GESTURE_HEADER) });
    const m = /^\/api\/install\/plans\/(.+)$/.exec(url.pathname);
    let r: unknown;
    if (m) r = plans.get(decodeURIComponent(m[1]!));
    else r = routes[`${method} ${url.pathname}`]?.(body, headers);
    if (r === undefined)
      return new Response(JSON.stringify({ error: m ? 'not_found' : 'gesture_required' }), {
        status: m ? 404 : 403,
      });
    return new Response(JSON.stringify(r), { status: 200 });
  });
  const client = new HarnessApiClient({ baseUrl: 'http://127.0.0.1:3790', token: 't', fetch: fetchMock });
  return { api: installApi(client), calls, plans };
}

/** 채팅 + 승인 카드 영역 (App과 같은 연결) */
function ChatHarness({ events, api }: { events: unknown[]; api: ReturnType<typeof installApi> }) {
  const install = useInstallCards({ events, api });
  return (
    <ApprovalsArea
      cards={[]}
      variant="panel"
      extra={install.cards.map((c) => ({
        id: c.id,
        render: ({ autoFocus }) =>
          c.type === 'plan' ? (
            <InstallPlanCard
              plan={c.plan}
              api={api}
              autoFocus={autoFocus}
              onClose={() => install.remove(c.id)}
            />
          ) : (
            <ResolveFailureCard result={c.result} onClose={() => install.remove(c.id)} />
          ),
      }))}
    />
  );
}

const ev = (i: number, e: Record<string, unknown>) => ({
  id: `e${i}`,
  ts: `2026-11-11T00:00:0${i}Z`,
  sessionId: 's1',
  engineId: 'claude-code',
  ...e,
});
/** MCP 도구 결과 모양 (content[0].text = JSON) */
const mcp = (v: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(v) }], structuredContent: v });

describe('P2-G.5 채팅 지시 설치: "ffmpeg 깔아 줘" → AI가 install.search·install.plan → 계획 카드 → 사람 승인 (E2E 모킹)', () => {
  it('계획 카드가 뜨고, 사람이 [설치]를 눌러야 클릭 토큰 → 실행', async () => {
    const srv = fakeServer();
    // AI가 연 MCP 서버의 계획이 이 서버에도 있다 (같은 InstallService)
    const aiPlan = fixturePlan({ id: 'plan_ffmpeg', name: 'ffmpeg' });
    srv.plans.set(aiPlan.id, aiPlan);
    const events = [
      ev(1, { type: 'assistant_text', text: 'ffmpeg를 찾아볼게요.' }),
      ev(2, {
        type: 'tool_call',
        callId: 'c1',
        tool: 'mcp__harness__install.search',
        input: { query: 'ffmpeg' },
      }),
      ev(3, {
        type: 'tool_result',
        callId: 'c1',
        ok: true,
        output: mcp({ query: 'ffmpeg', candidates: [] }),
      }),
      ev(4, {
        type: 'tool_call',
        callId: 'c2',
        tool: 'install.plan',
        input: { kind: 'winget', target: { id: 'Gyan.FFmpeg' } },
      }),
      ev(5, { type: 'tool_result', callId: 'c2', ok: true, output: mcp(aiPlan) }),
    ];
    render(<ChatHarness events={events} api={srv.api} />);
    const card = await screen.findByRole('group', { name: /설치해도 될까요/ });
    expect(card.dataset.cardId).toBe('plan_ffmpeg');
    // 카드가 떴을 뿐 실행·토큰 요청은 0건 (AI는 실행할 수 없다)
    expect(
      srv.calls.filter((c) => c.path === '/api/install/execute' || c.path === '/api/gesture-tokens'),
    ).toEqual([]);
    await act(async () => void fireEvent.click(within(card).getByRole('button', { name: /설치/ })));
    await waitFor(() => expect(srv.calls.some((c) => c.path === '/api/install/execute')).toBe(true));
    const tokenIdx = srv.calls.findIndex((c) => c.path === '/api/gesture-tokens');
    const execIdx = srv.calls.findIndex((c) => c.path === '/api/install/execute');
    expect(srv.calls[tokenIdx]!.body).toEqual({ kind: 'install' });
    expect(tokenIdx).toBeLessThan(execIdx);
    expect(srv.calls[execIdx]).toMatchObject({ body: { planId: 'plan_ffmpeg' }, gesture: 'tok-install' });
  });

  it('엔진 쪽 MCP 서버의 계획이라 이 서버에 없으면 같은 대상으로 다시 계획해 카드에 쓴다', async () => {
    const srv = fakeServer();
    const aiPlan = fixturePlan({ id: 'plan_elsewhere', name: 'jq', target: 'jqlang.jq' });
    const events = [
      ev(1, { type: 'tool_call', callId: 'c9', tool: 'install_plan', input: {} }),
      ev(2, { type: 'tool_result', callId: 'c9', ok: true, output: JSON.stringify(aiPlan) }),
    ];
    render(<ChatHarness events={events} api={srv.api} />);
    const card = await screen.findByRole('group', { name: /설치해도 될까요/ });
    expect(card.dataset.cardId).toBe('plan_jqlang.jq');
    expect(srv.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /api/install/plans/plan_elsewhere',
      'POST /api/install/plan',
    ]);
  });

  it('도구 결과 파싱: structuredContent · content[0].text · 문자열 · 실패한 호출은 무시', () => {
    expect(toolOutputValue({ structuredContent: { a: 1 } })).toEqual({ a: 1 });
    expect(toolOutputValue({ content: [{ type: 'text', text: '{"b":2}' }] })).toEqual({ b: 2 });
    expect(toolOutputValue('{"c":3}')).toEqual({ c: 3 });
    expect(toolOutputValue('not json')).toBeUndefined();
    expect(
      chatInstallCalls([
        { type: 'tool_call', callId: 'x', tool: 'install.plan' },
        { type: 'tool_result', callId: 'x', ok: false, output: '{}' },
        { type: 'tool_call', callId: 'y', tool: 'Bash' },
        { type: 'tool_result', callId: 'y', ok: true, output: '{}' },
      ]),
    ).toEqual([]);
  });
});

describe('P2-C.7 채팅으로 주소 설치: 주소 + "이거 설치해 줘" → AI가 install.resolve → 계획 카드 (E2E 모킹)', () => {
  it('추천 후보로 계획 카드, 실행은 사람이 누를 때만', async () => {
    const srv = fakeServer();
    const resolved = {
      input: 'https://www.npmjs.com/package/prettier',
      classification: { type: 'npm', url: 'https://www.npmjs.com/package/prettier' },
      candidates: [{ kind: 'npm-cli', target: { id: 'prettier' }, label: 'npm', source: 'npm' }],
      recommended: { kind: 'npm-cli', target: { id: 'prettier' }, label: 'npm', source: 'npm' },
      reason: 'npm 공식 저장소예요.',
    };
    const events = [
      ev(1, { type: 'assistant_text', text: '주소를 살펴볼게요.' }),
      ev(2, {
        type: 'tool_call',
        callId: 'r1',
        tool: 'mcp__harness__install.resolve',
        input: { url: resolved.input },
      }),
      ev(3, { type: 'tool_result', callId: 'r1', ok: true, output: mcp(resolved) }),
    ];
    render(<ChatHarness events={events} api={srv.api} />);
    const card = await screen.findByRole('group', { name: /설치해도 될까요/ });
    expect(card.dataset.cardId).toBe('plan_prettier');
    expect(srv.calls.find((c) => c.path === '/api/install/plan')!.body).toEqual({
      kind: 'npm-cli',
      target: { id: 'prettier' },
    });
    expect(srv.calls.some((c) => c.path === '/api/install/execute')).toBe(false);
    await act(async () => void fireEvent.click(within(card).getByRole('button', { name: /설치/ })));
    await waitFor(() =>
      expect(srv.calls.find((c) => c.path === '/api/install/execute')).toMatchObject({
        gesture: 'tok-install',
      }),
    );
  });

  it('해석 실패면 실패 카드 (C.6)', async () => {
    const srv = fakeServer();
    const failed = {
      input: 'https://example.com/x',
      classification: { type: 'unknown', url: 'https://example.com/x' },
      candidates: [],
      failure: '이 주소에서 설치 방법을 찾지 못했어요.',
    };
    const events = [
      ev(1, { type: 'tool_call', callId: 'r2', tool: 'install.resolve', input: {} }),
      ev(2, { type: 'tool_result', callId: 'r2', ok: true, output: mcp(failed) }),
    ];
    render(<ChatHarness events={events} api={srv.api} />);
    expect(await screen.findByRole('group', { name: RESOLVE_FAIL_TITLE })).toBeTruthy();
    expect(srv.calls).toEqual([]);
  });
});
