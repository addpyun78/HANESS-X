import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/** 경로 → JSON 응답 표로 동작하는 모킹 HTTP 서버 (127.0.0.1, 임의 포트) */
export async function mockJsonServer(
  routes: Record<string, unknown>,
  opts: { delayMs?: number } = {},
): Promise<{ url: string; port: number; hits: string[]; close: () => Promise<void> }> {
  const hits: string[] = [];
  const server: Server = createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    const send = () => {
      const body = routes[req.url ?? ''];
      if (body === undefined) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    };
    if (opts.delayMs) setTimeout(send, opts.delayMs);
    else send();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    hits,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

/** 열었다 닫아서 확실히 닫힌 포트 하나를 얻는다 */
export async function closedPort(): Promise<number> {
  const s = await mockJsonServer({});
  await s.close();
  return s.port;
}
