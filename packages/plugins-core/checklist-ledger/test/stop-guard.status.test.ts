import { join } from 'node:path';
import { EventLog, HookBus, PluginLoader, startApiServer } from '@harness-x/kernel';
import { TurnEndEventSchema } from '@harness-x/protocol';
import { describe, expect, it } from 'vitest';
import { ChecklistLedger } from '../src/ledger.js';
import {
  ChecklistStatusSchema,
  registerChecklistStatusRoute,
  workspaceLedgerResolver,
} from '../src/stop-guard.js';
import { item, tempDir } from './helpers.js';

describe('28.1 GET /api/checklist/:session/status', () => {
  it('남은 항목·다음 항목 지시문을 스키마대로 돌려준다 (토큰 필요, 없는 세션 404)', async () => {
    const { dir, cleanup } = tempDir();
    const ws = join(dir, 'ws');
    const ledger = new ChecklistLedger({ dir: join(ws, '.harness-x', 'sessions', 's1'), sessionId: 's1' });
    ledger.create([item('1'), item('2', { deps: ['1'] }), item('3')]);
    ledger.transition('1', 'doing');
    ledger.transition('1', 'verifying');
    ledger.transition('1', 'done');
    const log = new EventLog({ root: join(dir, 'logs') });
    const loader = new PluginLoader({ hooks: new HookBus(), log, roots: [], lockFile: join(dir, 'lock') });
    const server = await startApiServer({
      loader,
      log,
      port: 0,
      tokenFile: join(dir, 'token'),
      routes: (app) => registerChecklistStatusRoute(app, workspaceLedgerResolver(ws)),
    });
    try {
      const url = `${server.url}/api/checklist/s1/status`;
      expect((await fetch(url)).status).toBe(401);
      const auth = { authorization: `Bearer ${server.token}` };
      const res = await fetch(url, { headers: auth });
      expect(res.status).toBe(200);
      const body = ChecklistStatusSchema.parse(await res.json());
      expect(body).toMatchObject({
        sessionId: 's1',
        exists: true,
        total: 3,
        done: 1,
        remaining: 2,
        complete: false,
        remainingItems: [
          { id: '2', status: 'todo' },
          { id: '3', status: 'todo' },
        ],
        next: { id: '2', title: '항목 2 구현' },
      });
      expect(body.next?.instruction).toMatch(/^다음 항목 2: 항목 2 구현/);
      expect((await fetch(`${server.url}/api/checklist/nope/status`, { headers: auth })).status).toBe(404);
      expect((await fetch(`${server.url}/api/checklist/..%2F..%2Fx/status`, { headers: auth })).status).toBe(
        404,
      );
    } finally {
      await server.close();
      log.close();
      cleanup();
    }
  });

  it('turn_end(blocked)의 remaining·nextItemId·nextItemTitle은 공식 프로토콜 필드 (기존 이벤트도 통과)', () => {
    const base = { id: 'e1', ts: new Date().toISOString(), sessionId: 's1', type: 'turn_end' as const };
    expect(TurnEndEventSchema.parse({ ...base, reason: 'completed' })).toEqual({
      ...base,
      reason: 'completed',
    });
    const blocked = { ...base, reason: 'blocked', remaining: 2, nextItemId: '2', nextItemTitle: '항목 2' };
    expect(TurnEndEventSchema.parse(blocked)).toEqual(blocked);
    expect(() => TurnEndEventSchema.parse({ ...base, reason: 'blocked', remaining: -1 })).toThrow();
  });
});
