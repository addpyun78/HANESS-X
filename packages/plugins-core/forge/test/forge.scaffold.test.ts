import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ChecklistLedger, checklistStatus } from '@harness-x/checklist-ledger';
import { PluginManifestSchema, type RoleNode } from '@harness-x/protocol';
import { fakeEngine, type FakeCall } from '../../agent-builder/test/runner-helpers.js';
import { Forge, SCAFFOLD_TEMPLATE } from '../src/engine.js';
import { ScaffoldPathError, checkWritablePath } from '../src/scaffold.js';
import { autoAnswer, collect, forgeEnv } from './helpers.js';
import { KOTLIN_HOOK_OK, filesReply } from './fixtures/kotlin-hook.js';

const REQ = 'PR 전에 Kotlin 린트 실패 시 막는 훅 만들어줘';

describe('51.4 scaffold 노드: spec으로 템플릿을 채우고 본문 작성', () => {
  let env: ReturnType<typeof forgeEnv>;
  afterEach(() => env.cleanup());

  it('템플릿(hook) 펼침 + 매니페스트는 spec 권한 + 엔진이 쓴 src/index.ts + 체크리스트 done', async () => {
    env = forgeEnv();
    const forge = new Forge({ broker: env.broker, log: env.log });
    const calls: FakeCall[] = [];
    const llm = fakeEngine(
      'fake',
      (o) =>
        o.env?.HARNESS_X_NODE === 'scaffold'
          ? { text: filesReply(KOTLIN_HOOK_OK, { 'harness-plugin.json': '{}' }) }
          : { text: '' },
      calls,
    );
    const auto = autoAnswer(env.broker, (c) =>
      c.detail?.questionId === 'example' ? { value: 'fail-blocks' } : undefined,
    );
    const opts = forge.runnerOptions({
      sessionId: 's-sc',
      request: REQ,
      workspace: env.workspace,
      engines: () => llm,
    });
    const ledgerDir = join(env.dir, 'ledger');
    new ChecklistLedger({ dir: ledgerDir, sessionId: 's-sc' }).create(
      opts.checklists({ id: 'scaffold' } as RoleNode, SCAFFOLD_TEMPLATE)!,
    );
    const node = (name: string) =>
      collect(
        opts.engines('fake').run({
          sessionId: 's-sc',
          prompt: '',
          cwd: env.workspace,
          env: { HARNESS_X_NODE: name, HARNESS_X_CHECKLIST_DIR: ledgerDir },
        }),
      );
    await node('interview');
    await node('spec');
    const events = await node('scaffold');
    auto.stop();

    const dir = forge.session('s-sc')!.pluginDir;
    for (const f of ['harness-plugin.json', 'package.json', 'tsconfig.json', 'src/index.ts'])
      expect(existsSync(join(dir, f)), f).toBe(true);
    const manifest = PluginManifestSchema.parse(
      JSON.parse(readFileSync(join(dir, 'harness-plugin.json'), 'utf8')),
    );
    expect(manifest).toMatchObject({
      id: 'pr-kotlin-guard',
      provides: { hook: ['pr-kotlin-guard'] },
      permissions: { fs: [], net: [], shell: true },
    });
    expect(readFileSync(join(dir, 'src/index.ts'), 'utf8')).toBe(KOTLIN_HOOK_OK);

    // 엔진 프롬프트에 spec과 템플릿 본문이 들어간다
    const prompt = calls.find((c) => c.node === 'scaffold')!.prompt;
    expect(prompt).toContain('"id": "pr-kotlin-guard"');
    expect(prompt).toContain('## 현재 src/index.ts');

    // 파일 이벤트: 템플릿 생성 + 본문 수정, 보호 파일은 거부(error)
    const changes = events
      .filter((e) => e.type === 'file_change')
      .map((e) => (e.type === 'file_change' ? e : null)!);
    expect(changes.some((c) => c.path.endsWith('src/index.ts') && c.change === 'modify')).toBe(true);
    expect(events.some((e) => e.type === 'error' && /하네스가 관리하는 파일/.test(e.message))).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', reason: 'completed' });
    expect(checklistStatus(new ChecklistLedger({ dir: ledgerDir, sessionId: 's-sc' }))).toMatchObject({
      complete: true,
    });
  });

  it('엔진이 쓸 수 있는 경로만 허용', () => {
    env = forgeEnv();
    expect(checkWritablePath('src/lint.ts')).toBe('src/lint.ts');
    expect(checkWritablePath('SKILL.md')).toBe('SKILL.md');
    for (const bad of ['../x.ts', '/etc/passwd', 'package.json', 'node_modules/a.js', 'src/../../x'])
      expect(() => checkWritablePath(bad), bad).toThrow(ScaffoldPathError);
  });
});
