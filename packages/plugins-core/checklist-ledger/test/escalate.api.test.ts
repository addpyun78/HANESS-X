import { join } from 'node:path';
import { EventLog, HookBus, PluginLoader, startApiServer, type ApiServer } from '@harness-x/kernel';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Escalator } from '../src/escalate.js';
import { ChecklistLedger } from '../src/ledger.js';
import { CASE } from './escalate-fixtures.js';
import { item, tempDir } from './helpers.js';

describe('27.3 API POST /api/approvals/:id {equivalent|move|fail}', () => {
  let t: ReturnType<typeof tempDir>;
  let log: EventLog;
  let server: ApiServer;
  let ledger: ChecklistLedger;
  let esc: Escalator;

  beforeEach(async () => {
    t = tempDir('hx-approvals-');
    log = new EventLog({ root: join(t.dir, 'logs') });
    ledger = new ChecklistLedger({ dir: t.dir, sessionId: 's1', log });
    ledger.create([item('1'), item('2'), item('3')]);
    for (const id of ['1', '2', '3']) {
      ledger.transition(id, 'doing');
      ledger.transition(id, 'verifying');
    }
    esc = new Escalator({ dir: t.dir, sessionId: 's1', log, ledger });
    const loader = new PluginLoader({
      hooks: new HookBus({ log }),
      log,
      roots: [],
      lockFile: join(t.dir, 'lock'),
    });
    server = await startApiServer({
      loader,
      log,
      port: 0,
      token: 'test-token',
      tokenFile: join(t.dir, 'run', 'token'),
      approvals: esc,
    });
  });

  afterEach(async () => {
    await server.close();
    log.close();
    t.cleanup();
  });

  const post = (id: string, body: unknown) =>
    fetch(`${server.url}/api/approvals/${id}`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  async function pending(itemId: string): Promise<string> {
    const out = await esc.escalate({ ...CASE, itemId });
    if (out.status !== 'pending') throw new Error('expected pending');
    return out.approvalId;
  }

  it('응답 후 항목 상태 변경: equivalent → done, move → done, fail → failed', async () => {
    const cases = [
      ['1', 'equivalent', 'done', 'equal'],
      ['2', 'move', 'done', 'relocated'],
      ['3', 'fail', 'failed', 'wrong'],
    ] as const;
    for (const [itemId, decision, status, verdict] of cases) {
      const id = await pending(itemId);
      expect(ledger.item(itemId).status).toBe('verifying');
      const res = await post(id, { decision });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { id: string; decision: string; result: { status: string } };
      expect(body).toMatchObject({ id, decision, result: { itemId, status } });
      const it2 = ledger.item(itemId);
      expect(it2.status).toBe(status);
      expect(it2.verdict).toMatchObject({ level: 5, verdict });
      expect(it2.evidence.at(-1)).toMatchObject({ kind: 'approval_resolution', approvalId: id, decision });
      expect(esc.approvals.get(id)).toMatchObject({ status: 'resolved', decision, by: 'api' });
    }
    // checklist_change 이벤트가 이벤트 로그에 남는다
    const changes = log.query({ sessionId: 's1', type: 'checklist_change' });
    expect(changes.some((e) => (e as { to?: string }).to === 'failed')).toBe(true);
  });

  it('오류: 인증·잘못된 결정·없는 id·중복 처리', async () => {
    const id = await pending('1');
    const noAuth = await fetch(`${server.url}/api/approvals/${id}`, { method: 'POST' });
    expect(noAuth.status).toBe(401);
    expect((await post(id, { decision: 'maybe' })).status).toBe(400);
    expect((await post(id, {})).status).toBe(400);
    expect((await post('nope', { decision: 'fail' })).status).toBe(404);
    expect((await post(id, { decision: 'fail' })).status).toBe(200);
    const again = await post(id, { decision: 'equivalent' });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: 'APPROVAL_RESOLVED' });
    expect(ledger.item('1').status).toBe('failed');
  });
});
