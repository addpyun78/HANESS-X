import { join } from 'node:path';
import { EventLog, HookBus, PluginLoader, startApiServer } from '@harness-x/kernel';
import { describe, expect, it } from 'vitest';
import { ChecklistLedger } from '../src/ledger.js';
import { ManifestStore } from '../src/manifest.js';
import { registerChecklistPlanRoutes, type ChecklistView } from '../src/plan-routes.js';
import { workspaceLedgerResolver } from '../src/stop-guard.js';
import { item, tempDir } from './helpers.js';

async function serve(setup: (sessionDir: string) => void) {
  const { dir, cleanup } = tempDir('hx-plan-routes-');
  const ws = join(dir, 'ws');
  const sessionDir = join(ws, '.harness-x', 'sessions', 's1');
  setup(sessionDir);
  const log = new EventLog({ root: join(dir, 'logs') });
  const loader = new PluginLoader({ hooks: new HookBus(), log, roots: [], lockFile: join(dir, 'lock') });
  const server = await startApiServer({
    loader,
    log,
    port: 0,
    tokenFile: join(dir, 'token'),
    routes: (app) => registerChecklistPlanRoutes(app, workspaceLedgerResolver(ws), { log }),
  });
  const auth = { authorization: `Bearer ${server.token}` };
  return {
    sessionDir,
    log,
    url: server.url,
    get: (p: string) => fetch(server.url + p, { headers: auth }),
    post: (p: string, body: unknown = {}) =>
      fetch(server.url + p, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    async close() {
      await server.close();
      log.close();
      cleanup();
    },
  };
}

describe('T-036 GET /api/checklist/:session', () => {
  it('전체 항목(acceptance·evidence·verdict)·현재 항목·잠금 상태·린트를 돌려준다', async () => {
    const s = await serve((d) => {
      const ledger = new ChecklistLedger({ dir: d, sessionId: 's1' });
      ledger.create([item('1'), item('2', { deps: ['1'] })]);
      ledger.transition('1', 'doing');
      ledger.addEvidence('1', { kind: 'ladder_verdict', level: 2, confidence: 1, reason: '별칭' });
    });
    try {
      expect((await fetch(`${s.url}/api/checklist/s1`)).status).toBe(401);
      const res = await s.get('/api/checklist/s1');
      expect(res.status).toBe(200);
      const v = (await res.json()) as ChecklistView;
      expect(v.sessionId).toBe('s1');
      expect(v.currentItemId).toBe('1');
      expect(v.checklist.items.map((i) => [i.id, i.status])).toEqual([
        ['1', 'doing'],
        ['2', 'todo'],
      ]);
      expect(v.checklist.items[0]!.acceptance).toEqual([
        { type: 'test', run: 'pnpm test item-1', expectExit: 0 },
      ]);
      expect(v.checklist.items[0]!.evidence[0]).toMatchObject({ kind: 'ladder_verdict', level: 2 });
      expect(v.plan).toEqual({ locked: false, revision: 0, artifacts: {} });
      expect(v.lint.ok).toBe(true);
      expect((await s.get('/api/checklist/nope')).status).toBe(404);
    } finally {
      await s.close();
    }
  });

  it('manifest 초안이 있으면 plan.artifacts에 정식 경로 (아직 잠기지 않음)', async () => {
    const s = await serve((d) => {
      new ChecklistLedger({ dir: d, sessionId: 's1' }).create([item('1', { artifactId: 'art.mobile-app' })]);
      new ManifestStore({ dir: d }).setDraft('art.mobile-app', {
        displayName: '하네스/모바일',
        path: 'harness/mobile',
        kind: 'dir',
      });
    });
    try {
      const v = (await (await s.get('/api/checklist/s1')).json()) as ChecklistView;
      expect(v.plan).toMatchObject({
        locked: false,
        artifacts: { 'art.mobile-app': { path: 'harness/mobile', displayName: '하네스/모바일' } },
      });
    } finally {
      await s.close();
    }
  });
});
