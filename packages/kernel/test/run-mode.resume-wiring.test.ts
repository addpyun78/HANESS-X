// @features F-099
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parsePipeline, type RunMode } from '@harness-x/protocol';
import { registerResumeRoutes } from '../src/api/resume-routes.js';
import { EventLog } from '../src/event-log.js';
import { Dispatcher, type DispatchAgent } from '../src/dispatch.js';
import { createResumeService } from '../src/resume-service.js';
import { autoResumeFor } from '../src/run-mode/resume.js';
import { bootApi } from './api-fixtures.js';
import { tempDir } from './helpers.js';

// T-101 3E.6 이어하기(2번) 시 모드 유지, 이어하기 카드에서 변경 가능 — 재개 테스트 (2번 이어하기 API에 연결)

const agent: DispatchAgent = {
  name: 'qa',
  command: '/qa',
  displayName: 'QA',
  pipeline: parsePipeline({ name: 'qa', nodes: [{ id: 'build', type: 'role' }], edges: [] }),
};

const tmp = tempDir('hx-resume-mode-');
afterAll(() => tmp.cleanup());

async function setup(name: string, initial: RunMode) {
  const log = new EventLog({ root: join(tmp.dir, name) });
  const d = new Dispatcher({
    log,
    resolve: () => agent,
    run: async (i) => {
      if (!i.resume) {
        await new Promise<void>((r) => i.signal.addEventListener('abort', () => r(), { once: true }));
        return { status: 'error' };
      }
      return { status: 'completed' };
    },
  });
  const modes = new Map<string, RunMode>();
  const svc = createResumeService({
    log,
    dispatcher: d,
    agentFor: () => agent,
    sessionMode: (id) => modes.get(id),
    setSessionMode: (id, m) => void modes.set(id, m),
  });
  const api = await bootApi({ routes: (app) => registerResumeRoutes(app, { log, service: svc }) });
  const s = d.dispatch({ agent: 'qa', prompt: '헤더 고쳐 줘' });
  modes.set(s.sessionId, initial);
  await d.stopNow(s.sessionId);
  log.flush();
  const post = (b: unknown) => api.post(`/api/resume/${s.sessionId}`, b, api.auth);
  return { api, d, modes, svc, sessionId: s.sessionId, post };
}

describe('3E.6 재개', () => {
  it('카드에서 바꾸지 않으면 멈추기 전 모드(오토) 그대로', async () => {
    const t = await setup('keep', 'auto');
    try {
      const r = await t.post({});
      expect(r.status).toBe(202);
      expect(await r.json()).toMatchObject({ runMode: 'auto' });
      expect(t.modes.get(t.sessionId)).toBe('auto');
      expect((await t.d.wait(t.sessionId)).status).toBe('completed');
    } finally {
      await t.api.close();
    }
  });

  it('이어하기 카드에서 일반으로 바꾸면 세션 기록도 일반', async () => {
    const t = await setup('change', 'auto');
    try {
      const r = await t.post({ runMode: 'normal' });
      expect(await r.json()).toMatchObject({ runMode: 'normal' });
      expect(t.modes.get(t.sessionId)).toBe('normal');
    } finally {
      await t.api.close();
    }
  });

  it('모르는 값은 무시하고 유지', async () => {
    const t = await setup('bad', 'plan');
    try {
      expect(await (await t.post({ runMode: 'turbo' })).json()).toMatchObject({ runMode: 'plan' });
    } finally {
      await t.api.close();
    }
  });

  it('이어하기 서비스 autoResume: 실제 세션 모드로 2B.11 판단 (사용자 정지는 오토여도 사용자만)', async () => {
    const t = await setup('auto-decision', 'auto');
    try {
      expect(t.svc.autoResume(t.sessionId)?.action).toBe('wait-user');
      expect(t.svc.autoResume('nope')).toBeUndefined();
    } finally {
      await t.api.close();
    }
  });

  it('2B.11 자동 재개 규칙에 세션 모드 연결: 오류로 멈춘 오토만 바로, 일반·기록 없음은 카드', () => {
    const now = new Date('2026-11-12T00:00:00.000Z');
    expect(autoResumeFor({ reason: 'crash' }, { mode: 'auto' }, { now }).action).toBe('resume');
    expect(autoResumeFor({ reason: 'crash' }, { mode: 'normal' }, { now }).action).toBe('card');
    expect(autoResumeFor({ reason: 'crash' }, {}, { now }).action).toBe('card');
    expect(autoResumeFor({ reason: 'user' }, { mode: 'auto' }, { now }).action).toBe('wait-user');
  });
});
