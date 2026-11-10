import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeEngine, type FakeCall } from '../../agent-builder/test/runner-helpers.js';
import { Forge, forgeDir } from '../src/engine.js';
import { FORGE_SPEC_FILE, ForgeSpecSchema, validateForgeSpec } from '../src/spec.js';
import { autoAnswer, collect, forgeEnv } from './helpers.js';

const REQ = 'PR 전에 Kotlin 린트 실패 시 막는 훅 만들어줘';

function setup(env: ReturnType<typeof forgeEnv>, specText: string, spec: 'confirm' | 'cancel' = 'confirm') {
  const forge = new Forge({ broker: env.broker, log: env.log });
  const calls: FakeCall[] = [];
  const llm = fakeEngine('fake', () => ({ text: specText }), calls);
  const auto = autoAnswer(env.broker, (card) =>
    card.kind === 'forge_spec'
      ? { value: spec }
      : card.detail?.questionId === 'example'
        ? { value: 'fail-blocks' }
        : undefined,
  );
  const opts = forge.runnerOptions({
    sessionId: 's-spec',
    request: REQ,
    workspace: env.workspace,
    engines: (id) => (id === 'fake' ? llm : undefined),
  });
  const node = (name: string) =>
    collect(
      opts.engines('fake').run({
        sessionId: 's-spec',
        prompt: `# 역할: ${name}`,
        cwd: env.workspace,
        env: { HARNESS_X_NODE: name },
      }),
    );
  return { forge, calls, auto, node };
}

describe('51.3 forge-spec.json 생성 + 사용자 확인 카드', () => {
  let env: ReturnType<typeof forgeEnv>;
  afterEach(() => env.cleanup());

  it('인터뷰 답 → 초안 → 엔진이 다듬음 → 스키마 통과 → forge-spec.json + 확인 카드', async () => {
    env = forgeEnv();
    const refined =
      '다듬었습니다.\n```json\n' +
      JSON.stringify({
        displayName: 'PR 전 Kotlin 린트 가드',
        description: 'gh pr create 전에 ./gradlew ktlintCheck를 돌려 실패하면 막는다',
      }) +
      '\n```';
    const { forge, calls, auto, node } = setup(env, refined);
    await node('interview');
    const events = await node('spec');
    auto.stop();
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', reason: 'completed' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.prompt).toContain('"id": "pr-kotlin-guard"');

    const file = join(forgeDir(env.workspace, 's-spec'), FORGE_SPEC_FILE);
    expect(existsSync(file)).toBe(true);
    const spec = ForgeSpecSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    expect(spec).toMatchObject({
      id: 'pr-kotlin-guard',
      kind: 'hook',
      displayName: 'PR 전 Kotlin 린트 가드',
      trigger: { hook: 'tool.before', match: 'gh pr create' },
      permissions: { fs: [], net: [], shell: true },
      command: './gradlew ktlintCheck',
      request: REQ,
    });
    expect(spec.examples.map((e) => e.expect.decision)).toEqual(['block', 'allow', 'allow']);

    // 확인 카드: spec 전체를 싣고 확인/취소
    const card = auto.cards.find((c) => c.kind === 'forge_spec')!;
    expect(card).toMatchObject({ options: ['confirm', 'cancel'], detail: { file } });
    expect(validateForgeSpec(card.detail!.spec).ok).toBe(true);
    expect(events.some((e) => e.type === 'approval_request' && e.kind === 'forge_spec')).toBe(true);
    expect(forge.session('s-spec')!.spec?.id).toBe('pr-kotlin-guard');
  });

  it('엔진 spec이 스키마를 못 통과하면 초안을 쓴다 (파일은 항상 스키마 통과)', async () => {
    env = forgeEnv();
    const { forge, auto, node } = setup(env, '```json\n{"kind":"widget","examples":[]}\n```');
    await node('interview');
    await node('spec');
    auto.stop();
    const s = forge.session('s-spec')!;
    expect(s.specErrors?.join(' ')).toMatch(/kind/);
    const file = join(forgeDir(env.workspace, 's-spec'), FORGE_SPEC_FILE);
    expect(validateForgeSpec(JSON.parse(readFileSync(file, 'utf8')))).toMatchObject({ ok: true });
    expect(s.spec?.kind).toBe('hook');
  });

  it('확인 카드에서 취소 → 노드 실패(turn_end error), spec 미확정', async () => {
    env = forgeEnv();
    const { forge, auto, node } = setup(env, '', 'cancel');
    await node('interview');
    const events = await node('spec');
    auto.stop();
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', reason: 'error' });
    expect(forge.session('s-spec')!.spec).toBeUndefined();
  });
});
