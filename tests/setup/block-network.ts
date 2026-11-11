/**
 * 테스트 HTTP 차단 레이어 (T-100 P1-J.9) — vitest setupFiles로 모든 테스트 파일 앞에서 실행된다.
 * 전역 fetch를 감싸 loopback(localhost·127.0.0.1·::1) 밖의 호스트로 나가는 요청을 막는다.
 * 테스트는 외부 서비스(더 이상 쓰지 않는 유료 판정 서비스 포함)를 절대 호출하지 않는다 — 모킹은 fetch 주입으로 한다.
 * 막힌 요청은 globalThis.__hxBlockedRequests에 남고, 네트워크 오류(TypeError)처럼 실패한다.
 */

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

export function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();
  return LOOPBACK.has(h) || h.endsWith('.localhost') || /^127\.\d+\.\d+\.\d+$/.test(h);
}

declare global {
  var __hxBlockedRequests: string[] | undefined;
  var __hxFetchGuard: boolean | undefined;
}

function urlOf(input: Parameters<typeof fetch>[0]): URL | null {
  try {
    if (typeof input === 'string') return new URL(input);
    if (input instanceof URL) return input;
    return new URL(input.url);
  } catch {
    return null;
  }
}

if (!globalThis.__hxFetchGuard && typeof globalThis.fetch === 'function') {
  const original = globalThis.fetch.bind(globalThis);
  globalThis.__hxBlockedRequests ??= [];
  const guarded: typeof fetch = (input, init) => {
    const url = urlOf(input);
    if (url && /^(https?|wss?):$/.test(url.protocol) && !isLoopbackHost(url.hostname)) {
      globalThis.__hxBlockedRequests!.push(url.hostname);
      return Promise.reject(
        new TypeError('fetch failed', {
          cause: new Error(`HX_TEST_NET_BLOCKED: 테스트 중 외부 요청 차단 (${url.hostname})`),
        }),
      );
    }
    return original(input, init);
  };
  globalThis.fetch = guarded;
  globalThis.__hxFetchGuard = true;
}
