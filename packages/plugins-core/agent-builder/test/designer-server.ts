import { join } from 'node:path';
import { EventLog, HumanGestureTokens, startApiServer } from '@harness-x/kernel';
import { AgentListResponseSchema, type AgentDraft } from '@harness-x/protocol';
import { registerBuilderDesigner } from '../src/designer/route.js';
import { AgentRegistry } from '../src/registry.js';
import { designerInventory, replayAsk, sampleDraft } from './designer-helpers.js';
import { setup } from './fixtures.js';

type Server = Awaited<ReturnType<typeof startApiServer>>;
const servers: Server[] = [];

export async function closeDesignerServers(): Promise<void> {
  for (const s of servers.splice(0)) await s.close();
}

/** 가짜 설계 엔진(리플레이) + 실제 API 서버 + 실제 레지스트리 + 클릭 토큰 저장소 */
export async function startDesignerServer(
  o: { replies?: (string | object)[]; ttlMs?: number; now?: () => number } = {},
) {
  const env = setup();
  env.copyHello();
  const loader = env.loader();
  await loader.loadAll();
  const registry = new AgentRegistry({ plugins: () => loader.plugins.values(), home: env.home });
  const gestures = new HumanGestureTokens({
    ...(o.ttlMs ? { ttlMs: o.ttlMs } : {}),
    ...(o.now ? { now: o.now } : {}),
  });
  const replay = replayAsk(o.replies ?? [sampleDraft()]);
  const saved: string[] = [];
  const server = await startApiServer({
    loader,
    log: new EventLog({ root: join(env.dir, 'api-logs') }),
    port: 0,
    tokenFile: join(env.home, 'run', 'token'),
    agents: () => registry.summaries(),
    agentsHome: env.home,
    gestures,
    routes: (app) => {
      registerBuilderDesigner(app, {
        home: env.home,
        inventory: async () => designerInventory(),
        session: () => ({ ask: replay.ask, engineId: 'claude-code' }),
        gestures,
        agents: () => registry.list(),
        onSaved: (s) => saved.push(s.name),
        savedBy: () => 'tester',
      });
    },
  });
  servers.push(server);
  const auth = { authorization: `Bearer ${server.token}` };
  const req = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const r = await fetch(server.url + path, {
      method,
      headers: { ...auth, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await r.text();
    return { status: r.status, body: (text ? JSON.parse(text) : undefined) as Record<string, unknown> };
  };
  const token = async () =>
    (await req('POST', '/api/gesture-tokens', { kind: 'save-agent' })).body.token as string;
  const design = async () =>
    (await req('POST', '/api/builder/design', { request: '임장노트 화면 디자인 검수', skipQuestions: true }))
      .body as { draftId: string; draft: AgentDraft };
  const list = async () =>
    AgentListResponseSchema.parse((await req('GET', '/api/agents')).body).agents.map((a) => a.name);
  return { env, server, registry, req, token, design, list, saved, replay };
}
