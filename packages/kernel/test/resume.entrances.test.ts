import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterAll, describe, expect, it } from 'vitest';
import { parsePipeline } from '@harness-x/protocol';
import { registerResumeRoutes } from '../src/api/resume-routes.js';
import { EventLog } from '../src/event-log.js';
import { Dispatcher, type DispatchAgent, type DispatchRunInput } from '../src/dispatch.js';
import { resumeCli } from '../src/resume-cli.js';
import { createResumeService } from '../src/resume-service.js';
import { bootApi } from './api-fixtures.js';
import { tempDir } from './helpers.js';

const agent: DispatchAgent = {
  name: 'qa',
  command: '/qa',
  displayName: 'QA',
  pipeline: parsePipeline({ name: 'qa', nodes: [{ id: 'build', type: 'role' }], edges: [] }),
};

const tmp = tempDir('hx-entrances-');
afterAll(() => tmp.cleanup());

/** 멈춘 세션 하나 + 이어하기 API 서버 */
async function setup(name: string) {
  const log = new EventLog({ root: join(tmp.dir, name) });
  const runs: DispatchRunInput[] = [];
  const d = new Dispatcher({
    log,
    resolve: () => agent,
    run: async (i) => {
      runs.push(i);
      if (!i.resume) {
        await new Promise<void>((r) => i.signal.addEventListener('abort', () => r(), { once: true }));
        return { status: 'error' };
      }
      return { status: 'completed' };
    },
  });
  const pending: { id: string; title: string }[] = [];
  const api = await bootApi({
    routes: (app) =>
      registerResumeRoutes(app, {
        log,
        service: createResumeService({
          log,
          dispatcher: d,
          agentFor: () => agent,
          pendingApprovals: () => pending,
        }),
      }),
  });
  const s = d.dispatch({ agent: 'qa', prompt: '헤더 고쳐 줘' });
  await d.stopNow(s.sessionId);
  log.flush();
  return { api, d, runs, pending, sessionId: s.sessionId };
}

function io(answer = '') {
  const input = new PassThrough();
  const output = new PassThrough();
  let text = '';
  output.on('data', (c) => (text += String(c)));
  input.end(answer);
  return { io: { input, output }, text: () => text };
}

describe('2B.2 공통 API (모든 입구가 쓰는 길)', () => {
  it('POST check → POST resume 202, 이어서 실행, 없는 세션 404, 승인 카드 대기 409', async () => {
    const t = await setup('api');
    try {
      const post = (p: string, b: unknown = {}) => t.api.post(p, b, t.api.auth);
      const c = await post(`/api/resume/${t.sessionId}/check`);
      expect(c.status).toBe(200);
      expect(await c.json()).toMatchObject({ ok: true, issues: [] });
      expect((await post('/api/resume/nope/check')).status).toBe(404);
      t.pending.push({ id: 'a1', title: '파일을 지워도 될까요?' });
      const blocked = await post(`/api/resume/${t.sessionId}`);
      expect(blocked.status).toBe(409);
      expect(await blocked.json()).toMatchObject({ error: 'blocked', issues: [{ check: 'approvals' }] });
      t.pending.length = 0;
      const ok = await post(`/api/resume/${t.sessionId}`, { version: 'pinned' });
      expect(ok.status).toBe(202);
      expect(await ok.json()).toMatchObject({ sessionId: t.sessionId, mode: 'summary', version: 'pinned' });
      expect((await t.d.wait(t.sessionId)).status).toBe('completed');
      expect(t.runs.at(-1)!.resume).toEqual({ mode: 'summary' });
    } finally {
      await t.api.close();
    }
  });
});

describe('2B.2 입구 ⑤ CLI harness-x resume <id>', () => {
  it('켜진 서버에 점검 → 이어서 시작 (쉬운 말 출력)', async () => {
    const t = await setup('cli');
    try {
      const o = io();
      const code = await resumeCli(
        [t.sessionId, '--url', t.api.server.url, '--token-file', t.api.server.tokenFile],
        o.io,
      );
      expect(code).toBe(0);
      expect(o.text()).toBe('이어서 시작했어요 (지금까지 한 일 요약으로).\n');
      expect((await t.d.wait(t.sessionId)).status).toBe('completed');
    } finally {
      await t.api.close();
    }
  });

  it('확인할 것이 있으면 글로 보여 주고 y/n, 승인 카드가 있으면 멈춤(2), 없는 세션 1', async () => {
    const t = await setup('cli2');
    try {
      const args = [t.sessionId, '--url', t.api.server.url, '--token-file', t.api.server.tokenFile];
      t.pending.push({ id: 'a1', title: '파일을 지워도 될까요?' });
      const b = io();
      expect(await resumeCli(args, b.io)).toBe(2);
      expect(b.text()).toContain('1. 대답하지 않은 확인 카드가 있어요');
      expect(b.text()).toContain('- 파일을 지워도 될까요?');
      expect(b.text()).toContain('확인 카드에 먼저 대답해 주세요');
      const missing = io();
      expect(
        await resumeCli(
          ['nope', '--url', t.api.server.url, '--token-file', t.api.server.tokenFile],
          missing.io,
        ),
      ).toBe(1);
      expect(missing.text()).toBe('이어서 할 작업을 찾지 못했어요: nope\n');
      expect(t.runs).toHaveLength(1); // 이어서 실행하지 않음
      const off = io();
      expect(await resumeCli(['x', '--url', 'http://127.0.0.1:9', '--token-file', '/nope'], off.io)).toBe(1);
      expect(off.text()).toContain('서버에 연결하지 못했어요');
    } finally {
      await t.api.close();
    }
  });
});
