import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCard, workspaceApprovals } from '@harness-x/approvals';
import { ChecklistLedger } from '@harness-x/checklist-ledger';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { LogRecord } from '../src/event-log.js';
import { bootApi } from './api-fixtures.js';

/** T-100 H.10 GET /api/approvals?status=pending · POST /api/approvals/:id {choice, remember} · WS 이벤트 */
describe('H.10 승인 카드 API', () => {
  let close = async () => {};
  afterEach(() => close());

  async function boot() {
    const sink: { log?: { append(e: LogRecord): unknown } } = {};
    const ws = mkdtempSync(join(tmpdir(), 'hx-approvals-api-'));
    const sessionId = 's-ap';
    const dir = join(ws, '.harness-x', 'sessions', sessionId);
    mkdirSync(dir, { recursive: true });
    const ledger = new ChecklistLedger({ dir, sessionId });
    ledger.create([
      {
        id: '1',
        title: '모바일 앱 폴더',
        artifactId: 'art.mobile-app',
        acceptance: [{ type: 'file_exists' }],
      },
      { id: '2', title: '웹 셸', artifactId: 'art.web', acceptance: [{ type: 'file_exists' }] },
    ]);
    const cards = workspaceApprovals(ws, {
      remindDelaysMs: [],
      log: { append: (e: never) => sink.log?.append(e) },
    });
    const api = await bootApi({ approvalCards: cards });
    sink.log = api.env.log;
    close = async () => {
      await api.close();
      rmSync(ws, { recursive: true, force: true });
    };
    const add = (id: string, itemId: string) =>
      cards.open(sessionId).store.add(
        buildCard({
          kind: 'path',
          itemId,
          expected: '하네스/모바일',
          actual: 'ai/mobile',
          confidence: 0.75,
          id,
        }),
      );
    return { api, add, ledger, sessionId };
  }

  it('GET 대기 목록 → POST {choice, remember} → 목록에서 빠지고 항목 반영', async () => {
    const { api, add, ledger } = await boot();
    add('c1', '1');
    add('c2', '2');
    const list = async (status = 'pending') =>
      (await (await api.get(`/api/approvals?status=${status}`, api.auth)).json()) as {
        approvals: { card: { id: string }; status: string; sessionId: string }[];
      };
    expect((await api.get('/api/approvals')).status).toBe(401);
    expect((await list()).approvals.map((a) => a.card.id)).toEqual(['c1', 'c2']);
    expect((await list()).approvals[0]?.sessionId).toBe('s-ap');

    const res = await api.post('/api/approvals/c1', { choice: 'stop', remember: false }, api.auth);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: 'c1',
      choice: 'stop',
      remember: false,
      result: { outcome: { message: '이 부분은 멈춰 두고 나머지를 먼저 진행할게요.', status: 'blocked' } },
    });
    expect(ledger.item('1').status).toBe('blocked');
    expect((await list()).approvals.map((a) => a.card.id)).toEqual(['c2']);
    expect((await list('resolved')).approvals.map((a) => a.card.id)).toEqual(['c1']);
    expect((await list('all')).approvals).toHaveLength(2);

    // 오류: 이미 처리 409, 없는 카드 404, 카드에 없는 선택 400, 잘못된 status 400
    expect((await api.post('/api/approvals/c1', { choice: 'accept' }, api.auth)).status).toBe(409);
    expect((await api.post('/api/approvals/nope', { choice: 'accept' }, api.auth)).status).toBe(404);
    expect((await api.post('/api/approvals/c2', { choice: 'register' }, api.auth)).status).toBe(400);
    expect((await api.get('/api/approvals?status=weird', api.auth)).status).toBe(400);
    // 이전 방식 {decision}은 L5 처리기가 없으면 404
    expect((await api.post('/api/approvals/c2', { decision: 'equivalent' }, api.auth)).status).toBe(404);

    // 방금 선택 취소
    const undo = await api.post('/api/approvals/undo', {}, api.auth);
    expect(undo.status).toBe(200);
    expect(ledger.item('1').status).toBe('todo');
    expect((await list()).approvals.map((a) => a.card.id)).toEqual(['c1', 'c2']);
    expect((await api.post('/api/approvals/undo', {}, api.auth)).status).toBe(409);
  });

  it('WebSocket으로 approval_request · approval_resolved', async () => {
    const { api, add, sessionId } = await boot();
    const wsUrl =
      api.server.url.replace('http', 'ws') + `/ws/events?token=${api.server.token}&sessionId=${sessionId}`;
    const sock = new WebSocket(wsUrl);
    const msgs: { type: string; approvalId?: string; choice?: string; detail?: { card?: { id: string } } }[] =
      [];
    await new Promise<void>((res, rej) => {
      sock.on('message', (d) => {
        const m = JSON.parse(String(d));
        msgs.push(m);
        if (m.type === 'hello') {
          add('w1', '1');
          void api.post('/api/approvals/w1', { choice: 'accept', remember: false }, api.auth);
        }
        if (m.type === 'approval_resolved') res();
      });
      sock.on('error', rej);
    });
    sock.close();
    const types = msgs.map((m) => m.type);
    expect(types[0]).toBe('hello');
    expect(types).toContain('approval_request');
    const req = msgs.find((m) => m.type === 'approval_request')!;
    expect(req).toMatchObject({ approvalId: 'w1', kind: 'approval.card', detail: { card: { id: 'w1' } } });
    expect(msgs.at(-1)).toMatchObject({ type: 'approval_resolved', approvalId: 'w1', choice: 'accept' });
  });
});
