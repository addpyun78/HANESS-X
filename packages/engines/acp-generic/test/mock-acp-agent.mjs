#!/usr/bin/env node
// 테스트용 모킹 ACP 에이전트 (stdio ndjson JSON-RPC).
// 프롬프트 키워드로 동작을 고른다:
//   tool  → tool_call + tool_call_update(completed, diff)
//   perm  → session/request_permission 후 선택 결과를 텍스트로 답함
//   crash → 턴 도중 종료(exit 3)
//   slow  → session/cancel 이 올 때까지 대기 후 cancelled
// 세션 기록은 MOCK_ACP_STORE 폴더에 저장 → session/load 에서 재생(replay)한다.
// MOCK_ACP_NO_LOAD=1 이면 loadSession 능력을 광고하지 않는다.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';

const store = process.env.MOCK_ACP_STORE;
const sessions = new Map();
const cancels = new Map();

function save(id) {
  if (!store) return;
  mkdirSync(store, { recursive: true });
  writeFileSync(join(store, `${id}.json`), JSON.stringify(sessions.get(id)));
}

function load(id) {
  if (sessions.has(id)) return sessions.get(id);
  const f = store && join(store, `${id}.json`);
  if (!f || !existsSync(f)) return undefined;
  const s = JSON.parse(readFileSync(f, 'utf8'));
  sessions.set(id, s);
  return s;
}

const text = (t) => ({ type: 'text', text: t });

const app = acp
  .agent({ name: 'mock-acp-agent' })
  .onRequest(acp.methods.agent.initialize, () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: { loadSession: process.env.MOCK_ACP_NO_LOAD !== '1' },
    agentInfo: { name: 'mock-acp-agent', version: '1.0.0' },
  }))
  .onRequest(acp.methods.agent.session.new, ({ params }) => {
    const sessionId = `mock-${randomUUID()}`;
    sessions.set(sessionId, { cwd: params.cwd, mcp: params.mcpServers.length, history: [] });
    save(sessionId);
    return { sessionId };
  })
  .onRequest(acp.methods.agent.session.load, async ({ params, client }) => {
    const s = load(params.sessionId);
    if (!s) throw acp.RequestError.resourceNotFound(params.sessionId);
    for (const h of s.history) {
      await client.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId,
        update: { sessionUpdate: 'user_message_chunk', content: text(h.user) },
      });
      await client.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: text(h.agent) },
      });
    }
    return {};
  })
  .onNotification(acp.methods.agent.session.cancel, ({ params }) => {
    cancels.get(params.sessionId)?.();
  })
  .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
    const sessionId = params.sessionId;
    const s = load(sessionId);
    if (!s) throw acp.RequestError.resourceNotFound(sessionId);
    const prompt = params.prompt.map((b) => (b.type === 'text' ? b.text : '')).join('');
    const say = (t) =>
      client.notify(acp.methods.client.session.update, {
        sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: text(t) },
      });
    let reply = `echo: ${prompt} (history=${s.history.length})`;

    if (prompt.includes('crash')) process.exit(3);

    if (prompt.includes('slow')) {
      await say('working...');
      await new Promise((r) => cancels.set(sessionId, r));
      return { stopReason: 'cancelled' };
    }

    if (prompt.includes('tool')) {
      await client.notify(acp.methods.client.session.update, {
        sessionId,
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'call-1',
          title: 'Write a.txt',
          kind: 'edit',
          status: 'pending',
          rawInput: { path: 'a.txt', content: 'hi' },
        },
      });
      await client.notify(acp.methods.client.session.update, {
        sessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'call-1',
          status: 'completed',
          content: [{ type: 'diff', path: join(s.cwd, 'a.txt'), newText: 'hi' }],
          rawOutput: { written: true },
        },
      });
    }

    if (prompt.includes('perm')) {
      const res = await client.request(acp.methods.client.session.requestPermission, {
        sessionId,
        toolCall: {
          toolCallId: 'call-perm',
          title: 'Run rm -rf build',
          kind: 'execute',
          status: 'pending',
          rawInput: { command: 'rm -rf build' },
        },
        options: [
          { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
          { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
        ],
      });
      reply += ` permission=${res.outcome.outcome === 'selected' ? res.outcome.optionId : 'cancelled'}`;
    }

    const half = Math.ceil(reply.length / 2);
    await say(reply.slice(0, half));
    await say(reply.slice(half));
    s.history.push({ user: prompt, agent: reply });
    save(sessionId);
    return { stopReason: 'end_turn' };
  });

const conn = app.connect(acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
process.stdin.on('end', () => conn.close());
void conn.closed.then(() => process.exit(0));
