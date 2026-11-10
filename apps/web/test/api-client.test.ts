import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLog, HookBus, PluginLoader, startApiServer, type ApiServer } from '@harness-x/kernel';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiError, backoffDelay, HarnessApiClient, type ConnectionStatus } from '../src/api/client.js';
import type { HarnessEvent } from '@harness-x/protocol';

const TOKEN = 'test-token-0123456789';
const dirs: string[] = [];
const servers: ApiServer[] = [];
const logs: EventLog[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close().catch(() => {})));
  for (const l of logs.splice(0)) l.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function boot(port = 0) {
  const dir = mkdtempSync(join(tmpdir(), 'hx-web-api-'));
  dirs.push(dir);
  const log = new EventLog({ root: join(dir, 'logs') });
  logs.push(log);
  const loader = new PluginLoader({
    hooks: new HookBus({ log }),
    log,
    roots: [],
    lockFile: join(dir, 'plugins.lock'),
    requiredSlots: [],
  });
  const server = await startApiServer({ loader, log, port, token: TOKEN, tokenFile: join(dir, 'token') });
  servers.push(server);
  return { server, log };
}

const ev = (id: string, text: string): HarnessEvent => ({
  id,
  ts: new Date().toISOString(),
  sessionId: 's-web',
  type: 'assistant_text',
  text,
});

function waitFor(cond: () => boolean, ms = 20_000): Promise<void> {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    const tick = () => {
      if (cond()) return res();
      if (Date.now() - t0 > ms) return rej(new Error('timeout'));
      setTimeout(tick, 20);
    };
    tick();
  });
}

describe('API 클라이언트', () => {
  it('Authorization: Bearer 토큰으로 /api/plugins 호출, 틀린 토큰은 ApiError 401', async () => {
    const { server } = await boot();
    const ok = new HarnessApiClient({ baseUrl: server.url, token: TOKEN });
    expect(await ok.plugins()).toEqual({ plugins: [], rejected: [] });
    expect((await ok.health()).ok).toBe(true);
    const bad = new HarnessApiClient({ baseUrl: server.url, token: 'wrong' });
    const err = await bad.plugins().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
  });

  it('WebSocket ?token= URL', () => {
    const c = new HarnessApiClient({ baseUrl: 'http://127.0.0.1:3790/', token: 'a b' });
    expect(c.eventsUrl({ sessionId: 's1' })).toBe('ws://127.0.0.1:3790/ws/events?token=a+b&sessionId=s1');
  });

  it('백오프: 지수 증가·상한', () => {
    const mid = () => 0.5;
    expect([0, 1, 2, 3, 10].map((a) => backoffDelay(a, { initialMs: 100, maxMs: 1000 }, mid))).toEqual([
      100, 200, 400, 800, 1000,
    ]);
  });

  it('서버 재기동 후 자동 재연결하고 이벤트를 계속 받는다', async () => {
    const first = await boot();
    const port = first.server.port;
    const client = new HarnessApiClient({
      baseUrl: first.server.url,
      token: TOKEN,
      backoff: { initialMs: 50, maxMs: 300 },
    });
    const got: HarnessEvent[] = [];
    const statuses: ConnectionStatus[] = [];
    const stream = client.events({
      sessionId: 's-web',
      onEvent: (e) => got.push(e),
      onStatus: (s) => statuses.push(s),
    });

    await waitFor(() => stream.status === 'open');
    first.log.append(ev('e1', '첫 서버'));
    await waitFor(() => got.length === 1);

    await first.server.close();
    servers.splice(servers.indexOf(first.server), 1);
    await waitFor(() => stream.status === 'reconnecting');

    const second = await boot(port);
    await waitFor(() => stream.status === 'open' && stream.connects === 2);
    second.log.append(ev('e2', '재기동 후'));
    await waitFor(() => got.length === 2);

    expect(got.map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(statuses).toContain('reconnecting');
    expect(statuses.filter((s) => s === 'open')).toHaveLength(2);
    stream.close();
    expect(stream.status).toBe('closed');
  }, 90_000);
});
