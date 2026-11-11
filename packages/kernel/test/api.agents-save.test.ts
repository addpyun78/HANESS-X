import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseAgentYaml, parsePipelineYaml } from '@harness-x/protocol';
import { bootApi } from './api-fixtures.js';
import { tempDir } from './helpers.js';
import { HumanGestureTokens } from '../src/human-gesture-token.js';

type Api = Awaited<ReturnType<typeof bootApi>>;
let api: Api | undefined;
const prevHome = process.env.HARNESS_X_HOME;
const cleanups: (() => void)[] = [];
afterEach(async () => {
  cleanups.splice(0).forEach((f) => f());
  await api?.close();
  api = undefined;
  if (prevHome === undefined) delete process.env.HARNESS_X_HOME;
  else process.env.HARNESS_X_HOME = prevHome;
});

const PIPELINE = {
  name: 'my-qa',
  displayName: '내 QA',
  nodes: [
    { id: 'plan', type: 'role', engine: 'claude-code', checklistTemplate: 'plan' },
    { id: 'build', type: 'role', engine: 'codex' },
  ],
  edges: [{ from: 'plan', to: 'build' }],
};

/** P4-F.2 사람 클릭 토큰 (화면의 저장 클릭 때 받는 것) */
const gesture = async (a: Api, kind = 'save-agent') =>
  ((await (await a.post('/api/gesture-tokens', { kind }, a.auth)).json()) as { token: string }).token;

const putWith = (a: Api, name: string, body: unknown, token?: string) =>
  fetch(a.server.url + `/api/agents/${name}`, {
    method: 'PUT',
    headers: {
      ...a.auth,
      'content-type': 'application/json',
      ...(token ? { 'x-harness-gesture': token } : {}),
    },
    body: JSON.stringify(body),
  });

const put = async (a: Api, name: string, body: unknown) => putWith(a, name, body, await gesture(a));

describe('46.3 PUT /api/agents/:name — 빌더 저장', () => {
  it('<home>/agents/<이름>/agent.yaml + pipeline.yaml 생성, 명령은 /이름으로 자동', async () => {
    const tmp = tempDir('hx-agents-save-');
    cleanups.push(tmp.cleanup);
    const home = join(tmp.dir, 'home');
    api = await bootApi({ agentsHome: home });
    const res = await put(api, 'my-qa', {
      agent: { name: 'my-qa', displayName: '내 QA', icon: '🧪' },
      pipeline: PIPELINE,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { command: string; dir: string; files: string[]; created: boolean };
    expect(body).toMatchObject({ command: '/my-qa', created: true, dir: join(home, 'agents', 'my-qa') });
    const agentFile = join(home, 'agents', 'my-qa', 'agent.yaml');
    const pipelineFile = join(home, 'agents', 'my-qa', 'pipeline.yaml');
    expect(body.files).toEqual([agentFile, pipelineFile]);
    expect(parseAgentYaml(readFileSync(agentFile, 'utf8'))).toMatchObject({
      name: 'my-qa',
      command: '/my-qa',
      icon: '🧪',
      pipeline: './pipeline.yaml',
    });
    expect(parsePipelineYaml(readFileSync(pipelineFile, 'utf8')).nodes.map((n) => n.id)).toEqual([
      'plan',
      'build',
    ]);
    // 보낸 그대로 저장 (기본값을 채우지 않음)
    expect(readFileSync(pipelineFile, 'utf8')).not.toContain('permission');

    // 이미 있으면 409, overwrite면 200
    expect((await put(api, 'my-qa', { agent: { name: 'my-qa' }, pipeline: PIPELINE })).status).toBe(409);
    const over = await put(api, 'my-qa', {
      agent: { name: 'my-qa', displayName: '고친 QA', command: '/qa' },
      pipeline: PIPELINE,
      overwrite: true,
    });
    expect(over.status).toBe(200);
    expect(parseAgentYaml(readFileSync(agentFile, 'utf8'))).toMatchObject({
      displayName: '고친 QA',
      command: '/qa',
    });
  });

  it('HARNESS_X_HOME 존중 (agentsHome 미지정)', async () => {
    api = await bootApi();
    process.env.HARNESS_X_HOME = join(api.env.dir, 'env-home');
    const res = await put(api, 'envy', { agent: { displayName: 'E' }, pipeline: PIPELINE });
    expect(res.status).toBe(201);
    expect(existsSync(join(api.env.dir, 'env-home', 'agents', 'envy', 'agent.yaml'))).toBe(true);
  });

  it('이름 검증: kebab-case 아님 400, body 이름 불일치 400, 잘못된 파이프라인 400, 토큰 없으면 401', async () => {
    api = await bootApi({ agentsHome: '/nonexistent-should-not-write' });
    expect((await put(api, 'Bad_Name', { agent: {}, pipeline: PIPELINE })).status).toBe(400);
    const mismatch = await put(api, 'a-b', { agent: { name: 'other' }, pipeline: PIPELINE });
    expect(mismatch.status).toBe(400);
    expect(((await mismatch.json()) as { error: string }).error).toBe('name_mismatch');
    const bad = await put(api, 'a-b', {
      agent: {},
      pipeline: { name: 'x', nodes: [{ id: 'a', type: 'gate' }] },
    });
    expect(bad.status).toBe(400);
    const b = (await bad.json()) as { error: string; errors: string[] };
    expect(b.error).toBe('invalid_agent');
    expect(b.errors.join('\n')).toContain('onFail');
    const unauth = await fetch(api.server.url + '/api/agents/a-b', { method: 'PUT', body: '{}' });
    expect(unauth.status).toBe(401);
  });

  it('P4-F.2 보강: 사람 클릭 토큰 없음·재사용·만료·다른 종류 → 403, 파일 안 생김', async () => {
    const tmp = tempDir('hx-agents-gesture-');
    cleanups.push(tmp.cleanup);
    const home = join(tmp.dir, 'home');
    let now = Date.now();
    const gestures = new HumanGestureTokens({ now: () => now });
    api = await bootApi({ agentsHome: home, gestures });
    const body = { agent: { name: 'my-qa' }, pipeline: PIPELINE };
    const reason = async (r: Response) => {
      expect(r.status).toBe(403);
      return ((await r.json()) as { error: string; reason: string }).reason;
    };
    // 세션 토큰만 (예전 동작) → 403
    expect(await reason(await putWith(api, 'my-qa', body))).toBe('missing');
    expect(await reason(await putWith(api, 'my-qa', body, 'made-up'))).toBe('unknown');
    expect(await reason(await putWith(api, 'my-qa', body, await gesture(api, 'install')))).toBe('wrong_kind');
    const old = await gesture(api);
    now += 61_000;
    expect(await reason(await putWith(api, 'my-qa', body, old))).toBe('expired');
    expect(existsSync(join(home, 'agents', 'my-qa'))).toBe(false);
    // 정상 클릭 → 201, 같은 토큰 재사용 → 403
    const t = await gesture(api);
    expect((await putWith(api, 'my-qa', body, t)).status).toBe(201);
    expect(await reason(await putWith(api, 'my-qa', { ...body, overwrite: true }, t))).toBe('reused');
  });
});
