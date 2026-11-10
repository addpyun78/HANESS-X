import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseAgentYaml, parsePipelineYaml } from '@harness-x/protocol';
import { bootApi } from './api-fixtures.js';
import { tempDir } from './helpers.js';

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

const put = (a: Api, name: string, body: unknown) =>
  fetch(a.server.url + `/api/agents/${name}`, {
    method: 'PUT',
    headers: { ...a.auth, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

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
});
