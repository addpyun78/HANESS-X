/**
 * T-101 0C.4 "전부 눌러 보기" 검사기 (Playwright 대신 vitest + jsdom + @testing-library/react).
 *
 * 화면을 새로 그릴 때마다 보이는 활성 버튼·링크·메뉴 항목·탭 하나를 누르고 2초 안에 효과가 있는지 본다.
 * 효과 = 주소 변경 · 창 열림(window.open, 파일 고르기 창) · API 요청(모킹 fetch·모킹 API 함수) ·
 *        화면 변화(DOM) · 사용자 이벤트(CustomEvent·hashchange) · 파일 받기(URL.createObjectURL) · 저장소 쓰기.
 * 삭제·설치·저장처럼 실제 영향이 있는 동작도 모킹 서버(fetch 스텁)·모킹 API에서만 실행된다.
 */
import { act, cleanup, fireEvent } from '@testing-library/react';
import { isActionId } from '../../src/actions/registry.js';

export type Observed =
  | 'navigate'
  | 'open'
  | 'api'
  | 'dom'
  | 'event'
  | 'download'
  | 'storage'
  /** 이미 골라져 있는 탭·보기 (다시 눌러도 그대로가 정상) */
  | 'current';

export interface ClickResult {
  screen: string;
  index: number;
  action: string | null;
  label: string;
  observed: Observed[];
  problem?: 'dead' | 'no-action' | 'unregistered' | 'error' | 'vanished';
  detail?: string;
}

/** 화면 하나를 그리는 함수. 돌려주기 전에 준비 단계(메뉴 열기 등)까지 끝낸다 */
export interface Harness {
  /** API 객체의 모든 함수 호출을 "API 요청"으로 센다 */
  api<T extends object>(obj: T): T;
  /** 모킹 서버: 'METHOD /path' → 응답 본문 (없는 경로는 404). 모든 호출을 "API 요청"으로 센다 */
  server(routes?: Record<string, (body: unknown) => unknown>, events?: readonly unknown[]): void;
  /** 부모가 넘긴 콜백 자리: 불리면 "이벤트" 효과 (실제 앱에서는 부모가 처리한다) */
  cb<A extends unknown[] = unknown[], R = void>(ret?: R): (...a: A) => R;
}
/** 화면 그리기. 돌려준 scope(CSS 선택자)가 있으면 그 안의 요소만 누른다 */
export type Renderer = (h: Harness) => Promise<void | { scope: string }> | void | { scope: string };

const SELECTOR =
  'button, a, [role="button"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="tab"]';

function visible(el: Element): boolean {
  for (let e: Element | null = el; e; e = e.parentElement) {
    if (e.hasAttribute('hidden') || e.getAttribute('aria-hidden') === 'true') return false;
    const s = (e as HTMLElement).style;
    if (s && (s.display === 'none' || s.visibility === 'hidden')) return false;
  }
  return true;
}

function enabled(el: Element): boolean {
  if ((el as HTMLButtonElement).disabled) return false;
  if (el.getAttribute('aria-disabled') === 'true') return false;
  return !el.closest('fieldset[disabled]');
}

/** 지금 화면에서 누를 수 있는 요소 (문서 순서) */
export function clickables(root: ParentNode = document.body): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(SELECTOR)].filter((el) => visible(el) && enabled(el));
}

export function labelOf(el: Element): string {
  const t = (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim();
  return (t || el.getAttribute('title') || el.tagName.toLowerCase()).slice(0, 60);
}

/** 라이브러리가 그리는 버튼(우리 코드가 data-action을 달 수 없음) — 효과 검사는 그대로 한다 */
const THIRD_PARTY: readonly [string, string][] = [['.react-flow__controls', 'react-flow-controls']];
export const THIRD_PARTY_PREFIX = 'third-party:';
function thirdParty(el: Element): string | null {
  for (const [sel, name] of THIRD_PARTY) if (el.closest(sel)) return `${THIRD_PARTY_PREFIX}${name}`;
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 그린 뒤 비동기 로딩(가짜 API 응답 등)이 가라앉을 때까지 잠깐 기다린다 */
export async function settle(ms = 60): Promise<void> {
  await act(async () => {
    await sleep(ms);
  });
}

/** 누르기 전에 화면이 조용해질 때까지(DOM 변화·API 호출이 150ms 동안 없음, 최대 3초) 기다린다 — 배경 갱신을 효과로 착각하지 않게 */
async function quiet(probe: Probe): Promise<void> {
  let last = Date.now();
  const mo = new MutationObserver(() => {
    last = Date.now();
  });
  mo.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  let calls = probe.count;
  const t0 = Date.now();
  try {
    while (Date.now() - t0 < 3000) {
      await act(async () => {
        await sleep(30);
      });
      if (probe.count !== calls) {
        calls = probe.count;
        last = Date.now();
      }
      if (Date.now() - last >= 150) return;
    }
  } finally {
    mo.disconnect();
  }
}

interface Probe {
  count: number;
  observed: Set<Observed>;
}

function makeHarness(probe: Probe): Harness {
  const wrap = <T extends object>(obj: T): T =>
    new Proxy(obj, {
      get(t, k, r) {
        const v = Reflect.get(t, k, r) as unknown;
        if (typeof v !== 'function') return v;
        return (...a: unknown[]) => {
          probe.count++;
          return (v as (...x: unknown[]) => unknown).apply(t, a);
        };
      },
    });
  return {
    api: wrap,
    cb:
      <A extends unknown[], R>(ret?: R) =>
      (..._a: A) => {
        probe.observed.add('event');
        return ret as R;
      },
    server(routes = {}, events = []) {
      const fetchStub = async (input: RequestInfo | URL, init: RequestInit = {}) => {
        probe.count++;
        const url = new URL(String(input), 'http://localhost');
        const method = (init.method ?? 'GET').toUpperCase();
        const body: unknown = typeof init.body === 'string' ? safeJson(init.body) : undefined;
        const h = routes[`${method} ${url.pathname}`];
        const r = h ? h(body) : url.pathname === '/api/plugins' ? { plugins: [], rejected: [] } : undefined;
        if (r === undefined) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
        return new Response(JSON.stringify(r), { status: 200 });
      };
      globalThis.fetch = fetchStub as typeof fetch;
      class FakeWS {
        static OPEN = 1;
        readyState = 0;
        onopen?: () => void;
        onclose?: () => void;
        onmessage?: (m: unknown) => void;
        onerror?: () => void;
        constructor() {
          setTimeout(() => {
            this.readyState = 1;
            this.onopen?.();
            this.onmessage?.({ data: JSON.stringify({ type: 'hello' }) });
            for (const e of events) this.onmessage?.({ data: JSON.stringify(e) });
          }, 0);
        }
        close() {}
        send() {}
      }
      (globalThis as { WebSocket: unknown }).WebSocket = FakeWS;
    },
  };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/** 클릭 한 번 동안 효과를 지켜보는 장치들 */
function watch(probe: Probe) {
  const undo: (() => void)[] = [];
  const spy = <O extends object, K extends keyof O>(o: O, k: K, kind: Observed, keep = false) => {
    const orig = o[k];
    (o as Record<K, unknown>)[k] = function (this: unknown, ...a: unknown[]) {
      probe.observed.add(kind);
      return keep && typeof orig === 'function'
        ? (orig as (...x: unknown[]) => unknown).apply(this, a)
        : undefined;
    } as O[K];
    undo.push(() => {
      o[k] = orig;
    });
  };
  spy(window, 'open', 'open');
  spy(HTMLInputElement.prototype, 'click', 'open'); // 파일 고르기 창
  spy(HTMLDialogElement.prototype, 'showModal', 'open', true);
  spy(URL, 'createObjectURL', 'download');
  spy(Storage.prototype, 'setItem', 'storage', true);
  const origDispatch = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function (this: EventTarget, e: Event) {
    if (e instanceof CustomEvent || e.type === 'hashchange' || e.type === 'popstate' || e.type === 'submit')
      probe.observed.add('event');
    return origDispatch.call(this, e);
  };
  undo.push(() => {
    EventTarget.prototype.dispatchEvent = origDispatch;
  });
  // 링크: 브라우저라면 새 창(target=_blank)이 열리거나 주소가 바뀐다 (jsdom은 다른 문서로 이동하지 않으므로 여기서 센다)
  const onLink = (e: MouseEvent) => {
    const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
    if (!a || e.defaultPrevented) return;
    const href = a.getAttribute('href') ?? '';
    if (!href || href === '#') return;
    probe.observed.add(a.getAttribute('target') === '_blank' ? 'open' : 'navigate');
  };
  document.addEventListener('click', onLink);
  undo.push(() => document.removeEventListener('click', onLink));
  const mo = new MutationObserver((ms) => {
    if (ms.length) probe.observed.add('dom');
  });
  mo.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  undo.push(() => mo.disconnect());
  const href = location.href;
  const calls = probe.count;
  return {
    check() {
      if (location.href !== href) probe.observed.add('navigate');
      if (probe.count !== calls) probe.observed.add('api');
      return probe.observed.size > 0;
    },
    stop() {
      for (const u of undo.reverse()) u();
    },
  };
}

export interface ClickAllOptions {
  /** 효과를 기다리는 시간 (기본 2초) */
  timeoutMs?: number;
  /** 그린 뒤 기다리는 시간 */
  settleMs?: number;
  /** 각 클릭 뒤 정리 (location.hash 되돌리기 등) */
  reset?: () => void;
}

/**
 * 화면의 누를 수 있는 요소를 하나씩 (매번 새로 그려서) 누르고 결과를 돌려준다.
 * problem이 있는 결과가 실패 목록이다.
 */
export async function clickAll(
  screen: string,
  render: Renderer,
  opts: ClickAllOptions = {},
): Promise<ClickResult[]> {
  const timeoutMs = opts.timeoutMs ?? 2000;
  const origFetch = globalThis.fetch;
  const origWS = (globalThis as { WebSocket?: unknown }).WebSocket;
  const origConfirm = window.confirm;
  const origAlert = window.alert;
  window.confirm = () => true;
  window.alert = () => {};
  let scope: string | undefined;
  const mount = async () => {
    const probe: Probe = { count: 0, observed: new Set() };
    // render()는 testing-library가 act로 감싸므로 바깥에서 다시 감싸지 않는다 (그려진 화면을 준비 단계에서 바로 찾도록)
    const r = await render(makeHarness(probe));
    scope = r ? r.scope : undefined;
    await settle(opts.settleMs);
    await quiet(probe);
    return probe;
  };
  const targets = () => {
    if (!scope) return clickables();
    const root = document.querySelector(scope);
    if (!root) throw new Error(`${screen}: 검사 범위 "${scope}"가 화면에 없어요`);
    return clickables(root);
  };
  const results: ClickResult[] = [];
  try {
    await mount();
    const total = targets().length;
    cleanup();
    opts.reset?.();
    for (let i = 0; i < total; i++) {
      const probe = await mount();
      const el = targets()[i];
      if (!el) {
        results.push({ screen, index: i, action: null, label: '?', observed: [], problem: 'vanished' });
        cleanup();
        opts.reset?.();
        continue;
      }
      const action = el.getAttribute('data-action') ?? thirdParty(el);
      const label = labelOf(el);
      probe.observed.clear();
      const w = watch(probe);
      let detail: string | undefined;
      try {
        await act(async () => {
          fireEvent.click(el);
        });
        const t0 = Date.now();
        while (!w.check() && Date.now() - t0 < timeoutMs) {
          await act(async () => {
            await sleep(25);
          });
        }
      } catch (err) {
        detail = err instanceof Error ? err.message : String(err);
      } finally {
        w.stop();
      }
      // 이미 골라져 있는 탭·보기·현재 항목은 다시 눌러도 바뀌지 않는 것이 정상
      const current =
        el.getAttribute('aria-selected') === 'true' ||
        el.getAttribute('aria-checked') === 'true' ||
        (el.hasAttribute('aria-current') && el.getAttribute('aria-current') !== 'false');
      if (probe.observed.size === 0 && current && !detail) probe.observed.add('current');
      const observed = [...probe.observed].sort();
      const r: ClickResult = { screen, index: i, action, label, observed };
      if (detail) Object.assign(r, { problem: 'error', detail });
      else if (!action) r.problem = 'no-action';
      else if (!isActionId(action) && !action.startsWith(THIRD_PARTY_PREFIX)) r.problem = 'unregistered';
      else if (observed.length === 0 && !action.startsWith(THIRD_PARTY_PREFIX)) r.problem = 'dead';
      // 라이브러리 버튼(예: React Flow "Fit View"가 이미 맞춰진 화면)은 효과가 없어도 실패로 치지 않고 표에만 남긴다
      results.push(r);
      cleanup();
      opts.reset?.();
    }
  } finally {
    cleanup();
    globalThis.fetch = origFetch;
    (globalThis as { WebSocket?: unknown }).WebSocket = origWS;
    window.confirm = origConfirm;
    window.alert = origAlert;
  }
  return results;
}

export const failures = (rs: readonly ClickResult[]) => rs.filter((r) => r.problem);
