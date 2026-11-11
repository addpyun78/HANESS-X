import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { RETIRED_DOMAIN_LABEL, retiredName } from '../helpers/retired-names.js';
import { isLoopbackHost } from './block-network.js';

/**
 * T-100 P1-J.9 — 테스트 중 삭제된 판정 서비스 도메인으로의 요청 0건.
 * 도메인 이름은 조사 파일(P1-A.3)의 "차단 대상 도메인" 줄에서 읽는다
 * (코드·문서에서 서비스 이름을 지운 J.8과 충돌하지 않도록).
 */
const retiredHost = retiredName(RETIRED_DOMAIN_LABEL);

describe('J.9 테스트 HTTP 차단 레이어', () => {
  it('삭제된 판정 서비스 도메인 요청은 막히고 기록된다', async () => {
    expect(retiredHost).toMatch(/^api\.[a-z0-9.-]+\.[a-z]+$/);
    const before = globalThis.__hxBlockedRequests?.length ?? 0;
    await expect(fetch(`https://${retiredHost}/v1/chat/completions`, { method: 'POST' })).rejects.toThrow(
      'fetch failed',
    );
    await expect(fetch(new URL(`https://${retiredHost.toUpperCase()}/`))).rejects.toThrow(TypeError);
    expect(globalThis.__hxBlockedRequests!.slice(before)).toEqual([retiredHost, retiredHost]);
  });

  it('다른 외부 호스트도 막고, loopback은 통과', async () => {
    await expect(fetch('https://example.com/')).rejects.toThrow('fetch failed');
    const srv = createServer((_q, s) => s.end('pong'));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    try {
      const port = (srv.address() as AddressInfo).port;
      expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toBe('pong');
    } finally {
      srv.close();
    }
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('app.localhost')).toBe(true);
    expect(isLoopbackHost('example.com')).toBe(false);
  });
});
