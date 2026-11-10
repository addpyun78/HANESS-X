import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HookBus, PluginLoader, startApiServer } from '@harness-x/kernel';
import { ApprovalRequestEventSchema } from '@harness-x/protocol';
import { Forge } from '../src/engine.js';
import { MAX_QUESTIONS, inferFromRequest, nextQuestion } from '../src/interview.js';
import { registerForgeRoutes } from '../src/routes.js';
import { autoAnswer, collect, forgeEnv } from './helpers.js';

const REQ = 'PR 전에 Kotlin 린트 실패 시 막는 훅 만들어줘';

describe('51.2 인터뷰 노드: 최대 5문항, 선택지 버튼', () => {
  let env: ReturnType<typeof forgeEnv>;
  afterEach(() => env.cleanup());

  it('요청문에서 짐작: 훅 · tool.before · gh pr create · ./gradlew ktlintCheck · 셸', () => {
    env = forgeEnv();
    expect(inferFromRequest(REQ)).toMatchObject({
      kind: 'hook',
      hook: 'tool.before',
      match: 'gh pr create',
      command: './gradlew ktlintCheck',
      shell: true,
    });
    const q1 = nextQuestion(REQ, {})!;
    expect(q1).toMatchObject({ id: 'kind', index: 1, total: MAX_QUESTIONS, suggested: 'hook' });
    // 앞 답에 따라 뒤 질문 선택지가 바뀐다
    expect(nextQuestion(REQ, { kind: { value: 'skill' } })!.choices.map((c) => c.value)).toEqual([
      'manual',
      'node',
    ]);
  });

  it('질문 카드(approval_request forge_question) → 답 → forge_answer 이벤트, 5문항에서 끝', async () => {
    env = forgeEnv();
    const forge = new Forge({ broker: env.broker, log: env.log });
    const auto = autoAnswer(env.broker, (card) =>
      card.detail?.questionId === 'example'
        ? { value: 'fail-blocks', text: '린트 실패면 PR 생성 차단' }
        : undefined,
    );
    const opts = forge.runnerOptions({ sessionId: 's-iv', request: REQ, workspace: env.workspace });
    const run = opts.engines('forge').run({
      sessionId: 's-iv',
      prompt: '# 역할: 인터뷰',
      cwd: env.workspace,
      env: { HARNESS_X_NODE: 'interview' },
    });
    const events = await collect(run);
    auto.stop();

    const asks = events.filter((e) => e.type === 'approval_request');
    expect(asks).toHaveLength(MAX_QUESTIONS);
    for (const a of asks) ApprovalRequestEventSchema.parse(a);
    expect(asks.map((a) => (a.type === 'approval_request' ? a.detail?.questionId : ''))).toEqual([
      'kind',
      'trigger',
      'io',
      'permissions',
      'example',
    ]);
    const perm = asks[3]!;
    expect(perm).toMatchObject({
      kind: 'forge_question',
      options: ['none', 'fs:read', 'fs:write', 'shell', 'net'],
      detail: { multiple: true, suggested: ['shell'] },
    });
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', reason: 'completed' });

    // 답변 이벤트
    env.log.flush();
    const answers = env.log.query({ sessionId: 's-iv', type: 'forge_answer' });
    expect(answers.map((a) => [a.questionId, a.value])).toEqual([
      ['kind', 'hook'],
      ['trigger', 'tool.before'],
      ['io', 'command-decision'],
      ['permissions', ['shell']],
      ['example', 'fail-blocks'],
    ]);
    expect(answers[4]).toMatchObject({ text: '린트 실패면 PR 생성 차단', cardKind: 'forge_question' });
    expect(forge.session('s-iv')!.answers.permissions).toEqual({ value: ['shell'] });
  });

  it('POST /api/forge/answers/:id → forge_answer, 선택지 밖 값 400, 없는 카드 404', async () => {
    env = forgeEnv();
    const loader = new PluginLoader({
      hooks: new HookBus({ log: env.log }),
      log: env.log,
      roots: [],
      lockFile: join(env.home, 'plugins.lock'),
    });
    const server = await startApiServer({
      loader,
      log: env.log,
      port: 0,
      tokenFile: join(env.home, 'run', 'token'),
      routes: (app) => registerForgeRoutes(app, env.broker),
    });
    const post = (id: string, body: unknown) =>
      fetch(`${server.url}/api/forge/answers/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${server.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    try {
      const forge = new Forge({ broker: env.broker, log: env.log });
      const run = forge
        .runnerOptions({ sessionId: 's-http', request: REQ, workspace: env.workspace })
        .engines('forge')
        .run({ sessionId: 's-http', prompt: '', cwd: env.workspace, env: { HARNESS_X_NODE: 'interview' } });
      const it = run.events[Symbol.asyncIterator]();
      const first = (await it.next()).value!;
      expect(first).toMatchObject({
        type: 'approval_request',
        kind: 'forge_question',
        approvalId: 's-http:q1',
      });
      const pending = (await (
        await fetch(`${server.url}/api/forge/pending?sessionId=s-http`, {
          headers: { authorization: `Bearer ${server.token}` },
        })
      ).json()) as { cards: { approvalId: string }[] };
      expect(pending.cards.map((c) => c.approvalId)).toEqual(['s-http:q1']);

      expect((await post('s-http:q1', { value: 'nope' })).status).toBe(400);
      expect((await post('s-missing', { value: 'hook' })).status).toBe(404);
      const ok = await post('s-http:q1', { value: 'hook' });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ approvalId: 's-http:q1', answer: { value: 'hook' } });
      const second = (await it.next()).value!;
      expect(second).toMatchObject({ type: 'approval_request', approvalId: 's-http:q2' });
      env.log.flush();
      expect(env.log.query({ sessionId: 's-http', type: 'forge_answer' })).toHaveLength(1);
      await it.return?.(undefined);
    } finally {
      await server.close();
    }
  });
});
