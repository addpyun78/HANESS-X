import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { JsonRpcClient, JsonRpcError } from '../src/jsonrpc.js';

const FAKE = fileURLToPath(new URL('./fixtures/fake-codex.mjs', import.meta.url));

/** 클라이언트가 쓴 줄을 모으는 가짜 서버 */
function pipePair() {
  const toClient = new PassThrough();
  const fromClient = new PassThrough();
  const sent: Record<string, unknown>[] = [];
  let buf = '';
  fromClient.on('data', (d: Buffer) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      sent.push(JSON.parse(buf.slice(0, i)));
      buf = buf.slice(i + 1);
    }
  });
  const reply = (m: unknown) => toClient.write(JSON.stringify(m) + '\n');
  return { client: new JsonRpcClient(toClient, fromClient), sent, reply, toClient };
}

const tick = () => new Promise((r) => setTimeout(r, 10));

describe('15.1 app-server JSON-RPC 핸드셰이크', () => {
  it('initialize 요청 → 응답 → initialized 알림 순서', async () => {
    const { client, sent, reply } = pipePair();
    const p = client.initialize({ name: 'harness-x', title: 'HARNESS-X', version: '0.0.0' });
    await tick();
    expect(sent).toEqual([
      {
        method: 'initialize',
        id: 1,
        params: {
          clientInfo: { name: 'harness-x', title: 'HARNESS-X', version: '0.0.0' },
          capabilities: null,
        },
      },
    ]);
    reply({ id: 1, result: { userAgent: 'codex/0.155.1', platformOs: 'linux' } });
    await expect(p).resolves.toMatchObject({ userAgent: 'codex/0.155.1' });
    expect(sent[1]).toEqual({ method: 'initialized' });
    expect(sent).toHaveLength(2);
  });

  it('오류 응답은 JsonRpcError로 reject, 알림은 핸들러로', async () => {
    const { client, reply } = pipePair();
    const got: string[] = [];
    client.onNotification((n) => got.push(n.method));
    const p = client.request('thread/start', {});
    reply({ method: 'remoteControl/status/changed', params: { status: 'disabled' } });
    reply({ id: 1, error: { code: -32600, message: 'Not initialized' } });
    await expect(p).rejects.toBeInstanceOf(JsonRpcError);
    await expect(p).rejects.toMatchObject({ code: -32600, message: 'Not initialized' });
    expect(got).toEqual(['remoteControl/status/changed']);
  });

  it('서버 요청에는 onServerRequest 결과로 응답, 기본은 -32601', async () => {
    const { client, sent, reply } = pipePair();
    reply({ id: 7, method: 'item/tool/requestUserInput', params: {} });
    await tick();
    expect(sent.at(-1)).toMatchObject({ id: 7, error: { code: -32601 } });
    client.onServerRequest = () => ({ decision: 'decline' });
    reply({ id: 8, method: 'item/commandExecution/requestApproval', params: {} });
    await tick();
    expect(sent.at(-1)).toEqual({ id: 8, result: { decision: 'decline' } });
  });

  it('응답 시간 초과·연결 종료 시 대기 요청 reject', async () => {
    const { client, toClient } = pipePair();
    await expect(client.request('x', undefined, 30)).rejects.toThrow(/시간 초과/);
    const p = client.request('y');
    toClient.end();
    await expect(p).rejects.toThrow(/종료/);
  });

  it('실제 자식 프로세스(가짜 app-server)와 핸드셰이크 후 요청 성공', async () => {
    const child = spawn(process.execPath, [FAKE, 'app-server'], { stdio: ['pipe', 'pipe', 'inherit'] });
    try {
      const client = new JsonRpcClient(child.stdout, child.stdin);
      // 핸드셰이크 전 요청은 서버가 거부한다
      await expect(client.request('account/rateLimits/read')).rejects.toMatchObject({
        message: 'Not initialized',
      });
      const init = await client.initialize({ name: 'harness-x', title: null, version: '0.0.0' });
      expect(init).toMatchObject({ platformFamily: 'unix' });
      await expect(client.request('account/rateLimits/read')).resolves.toEqual({});
    } finally {
      child.kill();
    }
  });
});
