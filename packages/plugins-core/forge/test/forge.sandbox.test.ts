import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentRegistry, PipelineRunner } from '@harness-x/agent-builder';
import { fakeEngine, type FakeCall } from '../../agent-builder/test/runner-helpers.js';
import { Forge } from '../src/engine.js';
import { forgePlugin } from '../src/index.js';
import { checkGate, runSandbox, testGate } from '../src/sandbox.js';
import {
  KOTLIN_HOOK_ALWAYS_ALLOW,
  KOTLIN_HOOK_OK,
  KOTLIN_HOOK_TYPE_ERROR,
  filesReply,
} from './fixtures/kotlin-hook.js';
import { KOTLIN_REQ, kotlinSpec, samplePlugin } from './fixtures/plugins.js';
import { autoAnswer, forgeEnv } from './helpers.js';

const forgePipeline = (home: string) =>
  new AgentRegistry({ plugins: () => [forgePlugin()], home }).get('/forge')!.pipeline;

describe('52.3 임시 워크스페이스에서 spec 예시로 실행, acceptance 확인', () => {
  let env: ReturnType<typeof forgeEnv> | undefined;
  afterEach(() => {
    env?.cleanup();
    env = undefined;
  });

  it(
    '올바른 훅: 예시 3개(린트 실패 → block, 성공 → allow, 관계없는 명령 → allow) 통과, 잘못된 훅은 실패',
    { timeout: 240_000 },
    async () => {
      const spec = kotlinSpec();
      const good = samplePlugin(spec, { 'src/index.ts': KOTLIN_HOOK_OK });
      const bad = samplePlugin(spec, { 'src/index.ts': KOTLIN_HOOK_ALWAYS_ALLOW });
      try {
        const r = await runSandbox(good.dir, spec);
        expect(r.build.emitted).toContain('dist/index.js');
        expect(r.results.map((x) => [x.name, x.ok, x.actual?.decision])).toEqual([
          ['린트 실패 → 차단', true, 'block'],
          ['린트 성공 → 허용', true, 'allow'],
          ['관계없는 명령 → 허용', true, 'allow'],
        ]);
        expect(r.results[0]!.actual!.reason).toMatch(/Kotlin 린트 실패 \(\.\/gradlew ktlintCheck → 1\)/);
        expect(r.ok).toBe(true);

        const b = await runSandbox(bad.dir, spec);
        expect(b.ok).toBe(false);
        expect(b.reasons).toEqual([
          expect.stringMatching(/^예시 '린트 실패 → 차단' 실패: 결정 allow \(기대 block\)/),
        ]);
      } finally {
        good.cleanup();
        bad.cleanup();
      }
    },
  );

  it(
    '루프 리플레이: 시험 실패 → scaffold로 되돌림(실패 사유 주입) → 타입 오류 → 다시 → 통과',
    { timeout: 300_000 },
    async () => {
      env = forgeEnv();
      const bodies = [KOTLIN_HOOK_ALWAYS_ALLOW, KOTLIN_HOOK_TYPE_ERROR, KOTLIN_HOOK_OK];
      const calls: FakeCall[] = [];
      let n = 0;
      const llm = fakeEngine(
        'fake',
        (o) =>
          o.env?.HARNESS_X_NODE === 'scaffold'
            ? { text: filesReply(bodies[Math.min(n++, 2)]!) }
            : { text: '' },
        calls,
      );
      const auto = autoAnswer(env.broker, (c) =>
        c.detail?.questionId === 'example' ? { value: 'fail-blocks' } : undefined,
      );
      const forge = new Forge({
        broker: env.broker,
        log: env.log,
        check: checkGate,
        test: (s) => testGate(s),
      });
      const runner = new PipelineRunner({
        workspace: env.workspace,
        sessionId: 's-loop',
        log: env.log,
        ...forge.runnerOptions({
          sessionId: 's-loop',
          request: KOTLIN_REQ,
          workspace: env.workspace,
          engines: () => llm,
          defaultEngine: 'fake',
        }),
      });
      const res = await runner.run(forgePipeline(env.home), KOTLIN_REQ);
      auto.stop();
      expect(res.status).toBe('completed');
      const s = forge.session('s-loop')!;
      expect(s.scaffoldRuns).toBe(3);
      expect(s.gates.map((g) => `${g.gate}#${g.attempt}:${g.ok ? 'ok' : 'fail'}`)).toEqual([
        'check#0:ok',
        'test#0:fail',
        'test#1:fail',
        'test#2:ok',
      ]);
      expect(s.gates[1]!.reasons[0]).toMatch(/결정 allow \(기대 block\)/);
      expect(s.gates[2]!.reasons[0]).toMatch(/\[typecheck\] src\/index\.ts:\d+:\d+ TS2322/);
      // 되돌린 scaffold 프롬프트에 실패 사유가 값으로 들어간다
      const scaffoldPrompts = calls.filter((c) => c.node === 'scaffold').map((c) => c.prompt);
      expect(scaffoldPrompts).toHaveLength(3);
      expect(scaffoldPrompts[1]).toContain('이전 시도가 검사·시험에 실패했다');
      expect(scaffoldPrompts[1]).toContain('결정 allow (기대 block)');
      expect(scaffoldPrompts[2]).toContain('TS2322');
      const testVisit = res.visits.find((v) => v.nodeId === 'test')!;
      expect(testVisit).toMatchObject({ status: 'completed', retries: 2 });
      env.log.flush();
      expect(env.log.query({ sessionId: 's-loop', type: 'forge_test' }).map((e) => e.ok)).toEqual([
        false,
        false,
        true,
      ]);
      expect(join(s.pluginDir)).toContain(join('.harness-x', 'forge', 's-loop'));
    },
  );

  it('계속 실패하면 scaffold 재작성 최대 3회 뒤 중단 (test gate failed)', { timeout: 300_000 }, async () => {
    env = forgeEnv();
    const calls: FakeCall[] = [];
    const llm = fakeEngine(
      'fake',
      (o) =>
        o.env?.HARNESS_X_NODE === 'scaffold' ? { text: filesReply(KOTLIN_HOOK_ALWAYS_ALLOW) } : { text: '' },
      calls,
    );
    const auto = autoAnswer(env.broker, (c) =>
      c.detail?.questionId === 'example' ? { value: 'fail-blocks' } : undefined,
    );
    const forge = new Forge({ broker: env.broker, log: env.log, check: checkGate, test: (s) => testGate(s) });
    const res = await new PipelineRunner({
      workspace: env.workspace,
      sessionId: 's-max',
      ...forge.runnerOptions({
        sessionId: 's-max',
        request: KOTLIN_REQ,
        workspace: env.workspace,
        engines: () => llm,
        defaultEngine: 'fake',
      }),
    }).run(forgePipeline(env.home), KOTLIN_REQ);
    auto.stop();
    expect(res).toMatchObject({ status: 'failed', haltedAt: 'test' });
    expect(forge.session('s-max')!.scaffoldRuns).toBe(4); // 처음 1 + 되돌림 3
    expect(calls.filter((c) => c.node === 'scaffold')).toHaveLength(4);
    expect(res.visits.some((v) => v.nodeId === 'install')).toBe(false);
  });
});
