import { join } from 'node:path';
import { EventLog, HookBus, PluginLoader, startApiServer } from '@harness-x/kernel';
import { describe, expect, it } from 'vitest';
import { ChecklistLedger } from '../src/ledger.js';
import { ManifestStore } from '../src/manifest.js';
import { registerChecklistPlanRoutes, type ChecklistView } from '../src/plan-routes.js';
import { workspaceLedgerResolver } from '../src/stop-guard.js';
import { item, tempDir } from './helpers.js';

describe('T-036/36.5 POST /api/checklist/:session/lock', () => {
  it('린트 통과 → manifest Lock(manifest_lock 이벤트), 위반·이미 잠김·미등록 단어는 409', async () => {
    const { dir, cleanup } = tempDir('hx-plan-lock-');
    const ws = join(dir, 'ws');
    const sessions = join(ws, '.harness-x', 'sessions');
    // s1: 위반 없음 + manifest 초안 / s2: R1 위반 / s3: 초안 없음(body로 미등록 단어)
    const s1 = join(sessions, 's1');
    new ChecklistLedger({ dir: s1, sessionId: 's1' }).create([item('1', { artifactId: 'art.mobile-app' })]);
    new ManifestStore({ dir: s1 }).setDraft('art.mobile-app', {
      displayName: '하네스/모바일',
      path: 'harness/mobile',
      kind: 'dir',
    });
    new ChecklistLedger({ dir: join(sessions, 's2'), sessionId: 's2' }).create([
      item('1', { title: '로그인 폼 작성하고 테스트 추가' }),
    ]);
    new ChecklistLedger({ dir: join(sessions, 's3'), sessionId: 's3' }).create([item('1')]);

    const log = new EventLog({ root: join(dir, 'logs') });
    const seen: { type: string; sessionId: string }[] = [];
    const off = log.subscribe((r) => seen.push(r as unknown as { type: string; sessionId: string }));
    const loader = new PluginLoader({ hooks: new HookBus(), log, roots: [], lockFile: join(dir, 'lock') });
    const server = await startApiServer({
      loader,
      log,
      port: 0,
      tokenFile: join(dir, 'token'),
      routes: (app) => registerChecklistPlanRoutes(app, workspaceLedgerResolver(ws), { log }),
    });
    const auth = { authorization: `Bearer ${server.token}`, 'content-type': 'application/json' };
    const post = (s: string, body: unknown = {}) =>
      fetch(`${server.url}/api/checklist/${s}/lock`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify(body),
      });
    try {
      expect(
        (await fetch(`${server.url}/api/checklist/s1/lock`, { method: 'POST', body: '{}' })).status,
      ).toBe(401);

      // 승인 → Lock
      const r1 = await post('s1');
      expect(r1.status).toBe(200);
      expect(await r1.json()).toEqual({
        status: 'locked',
        revision: 1,
        artifacts: { 'art.mobile-app': 'harness/mobile' },
      });
      expect(new ManifestStore({ dir: s1 }).isLocked()).toBe(true);
      expect(seen).toContainEqual(expect.objectContaining({ type: 'manifest_lock', sessionId: 's1' }));
      const v = (await (
        await fetch(`${server.url}/api/checklist/s1`, { headers: auth })
      ).json()) as ChecklistView;
      expect(v.plan.locked).toBe(true);
      expect(v.plan.artifacts['art.mobile-app']?.path).toBe('harness/mobile');
      // 두 번째 승인은 거부
      const again = await post('s1');
      expect(again.status).toBe(409);
      expect(await again.json()).toEqual({ status: 'already_locked' });

      // 린트 위반이면 잠그지 않는다
      const r2 = await post('s2');
      expect(r2.status).toBe(409);
      const b2 = (await r2.json()) as { status: string; violations: { rule: string; itemId: string }[] };
      expect(b2.status).toBe('lint');
      expect(b2.violations).toContainEqual(expect.objectContaining({ rule: 'R1', itemId: '1' }));
      expect(new ManifestStore({ dir: join(sessions, 's2') }).isLocked()).toBe(false);

      // glossary에 없는 단어 → needs_approval (approval_request 이벤트)
      const r3 = await post('s3', {
        artifacts: [{ artifactId: 'art.pay', displayName: '결제', kind: 'dir' }],
      });
      expect(r3.status).toBe(409);
      expect(await r3.json()).toMatchObject({ status: 'needs_approval', unknownWords: ['결제'] });
      expect(seen).toContainEqual(expect.objectContaining({ type: 'approval_request', sessionId: 's3' }));
      // overrides로 다시 → Lock
      const r3b = await post('s3', {
        artifacts: [{ artifactId: 'art.pay', displayName: '결제', kind: 'dir' }],
        overrides: { 결제: 'payment' },
      });
      expect(await r3b.json()).toMatchObject({ status: 'locked', artifacts: { 'art.pay': 'payment' } });

      expect((await post('nope')).status).toBe(404);
    } finally {
      off();
      await server.close();
      log.close();
      cleanup();
    }
  });
});
