import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentRegistry, PipelineRunner } from '@harness-x/agent-builder';
import {
  EventLog,
  HookBus,
  PluginLoader,
  TrustStore,
  defaultPluginRoots,
  runAgentLoop,
  type AgentTool,
} from '@harness-x/kernel';
import { ForgeBroker, createForge, forgePlugin } from '@harness-x/forge';
import type { HarnessEvent } from '@harness-x/protocol';
import { fakeEngine } from '../packages/plugins-core/agent-builder/test/runner-helpers.js';
import { KOTLIN_HOOK_OK, filesReply } from '../packages/plugins-core/forge/test/fixtures/kotlin-hook.js';
import { callTool, reply, scriptedModel, tempDir } from './helpers.js';

/**
 * T-064 64.5 Forge로 만든 훅이 다음 세션에서 동작 (유료 호출 없음)
 * 세션 1: /forge 파이프라인(가짜 엔진 + 카드 자동 응답)으로 "PR 전 Kotlin 린트 가드" 훅을 만들어 <home>/plugins/forge/에 설치.
 * 세션 2(다음 세션): 새 로더가 기본 루트(plugins/forge 포함)에서 찾아 미서명·격리(worker)로 활성화 →
 *   커널 도구 루프(대본 모델)가 `gh pr create`를 실행하려 하면 tool.before 훅이 ./gradlew ktlintCheck 실패를 보고 막는다.
 */

const REQ = 'PR 전에 Kotlin 린트 실패 시 막는 훅 만들어줘';
const gradlew = (code: number) =>
  `#!/bin/sh\necho "ktlint: Main.kt:1:1 Unexpected indentation" >&2\nexit ${code}\n`;

/** 셸 명령 도구 (실제로는 실행하지 않고 실행됐다고만 돌려준다) */
const ran: string[] = [];
const runCommand: AgentTool = {
  name: 'run_command',
  description: '셸 명령 실행',
  parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
  mutates: true,
  run: (input) => {
    const c = (input as { command: string }).command;
    ran.push(c);
    return { ran: c };
  },
};

async function collect(gen: AsyncGenerator<HarnessEvent>): Promise<HarnessEvent[]> {
  const out: HarnessEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe('64.5 Forge로 만든 훅이 다음 세션에서 동작', () => {
  it(
    '세션 1에서 Forge로 설치 → 세션 2의 새 로더·도구 루프에서 훅이 PR 생성을 막는다',
    { timeout: 300_000 },
    async () => {
      const t = tempDir('hx-e2e-forge-next-');
      const home = join(t.dir, 'home');
      try {
        // ── 세션 1: Forge ───────────────────────────────────────
        {
          const log = new EventLog({ root: join(t.dir, 'logs-1') });
          const broker = new ForgeBroker({ log });
          const off = broker.onCard((card) =>
            queueMicrotask(() =>
              broker.answer(card.approvalId, {
                value:
                  card.kind === 'forge_spec'
                    ? 'confirm'
                    : card.kind === 'forge_install'
                      ? 'install'
                      : (card.detail?.suggested as string | string[]),
              }),
            ),
          );
          const forge = createForge({ broker, log, home });
          const llm = fakeEngine('fake', (o) =>
            o.env?.HARNESS_X_NODE === 'scaffold' ? { text: filesReply(KOTLIN_HOOK_OK) } : { text: '' },
          );
          const pipeline = new AgentRegistry({ plugins: () => [forgePlugin()], home }).get(
            '/forge',
          )!.pipeline;
          const ws1 = join(t.dir, 'ws1');
          const res = await new PipelineRunner({
            workspace: ws1,
            sessionId: 'forge-1',
            log,
            ...forge.runnerOptions({
              sessionId: 'forge-1',
              request: REQ,
              workspace: ws1,
              engines: () => llm,
              defaultEngine: 'fake',
            }),
          }).run(pipeline, REQ);
          off();
          log.close();
          expect(res.status).toBe('completed');
          expect(forge.session('forge-1')!.installed).toMatchObject({
            dir: join(home, 'plugins', 'forge', 'pr-kotlin-guard'),
            trustLabel: '미서명·격리',
          });
        }

        // ── 세션 2: 새 프로세스처럼 처음부터 ─────────────────────
        const ws2 = join(t.dir, 'kotlin-app');
        mkdirSync(ws2, { recursive: true });
        writeFileSync(join(ws2, 'gradlew'), gradlew(1), { mode: 0o755 });
        const log = new EventLog({ root: join(t.dir, 'logs-2') });
        const hooks = new HookBus({ log });
        const loader = new PluginLoader({
          hooks,
          log,
          roots: defaultPluginRoots({ home, workspace: ws2 }),
          lockFile: join(home, 'plugins.lock'),
          sandbox: { trust: new TrustStore(join(home, 'trust.json')), workspace: ws2 },
          lifecycleTimeoutMs: 20_000,
        });
        try {
          expect(await loader.loadAll()).toEqual(['pr-kotlin-guard']);
          expect(loader.rejections).toEqual([]);
          expect(loader.plugins.get('pr-kotlin-guard')).toMatchObject({
            state: 'active',
            trust: 'unsigned-isolated',
            isolation: 'worker',
          });

          const session = async (sessionId: string, command: string) => {
            const { client } = scriptedModel((step) =>
              step === 0 ? callTool('run_command', { command }) : reply('끝'),
            );
            return collect(
              runAgentLoop({ client, sessionId, cwd: ws2, prompt: 'PR 올려 줘', tools: [runCommand], hooks }),
            );
          };

          // 린트 실패 → gh pr create 차단
          const blocked = await session('s2-blocked', 'gh pr create --fill');
          const r1 = blocked.find((e) => e.type === 'tool_result');
          expect(r1).toMatchObject({
            ok: false,
            output: { denied: true, decision: 'block', hookId: expect.stringContaining('pr-kotlin-guard') },
          });
          expect((r1 as { output: { reason: string } }).output.reason).toMatch(
            /Kotlin 린트 실패 \(\.\/gradlew ktlintCheck → 1\): ktlint: Main\.kt:1:1/,
          );
          expect(ran).toEqual([]);

          // 관계없는 명령은 통과
          await session('s2-ls', 'ls -la');
          expect(ran).toEqual(['ls -la']);

          // 린트를 고치면 PR 생성 허용
          writeFileSync(join(ws2, 'gradlew'), gradlew(0), { mode: 0o755 });
          const ok = await session('s2-ok', 'gh pr create --fill');
          expect(ok.find((e) => e.type === 'tool_result')).toMatchObject({ ok: true });
          expect(ran).toEqual(['ls -la', 'gh pr create --fill']);

          // 훅 실행 기록
          log.flush();
          const runs = log.query({ sessionId: 's2-blocked' }).filter((e) => e.type === 'hook_result');
          expect(runs.some((e) => e.pluginId === 'pr-kotlin-guard' && e.decision === 'block')).toBe(true);
        } finally {
          await loader.deactivate('pr-kotlin-guard', { force: true });
          log.close();
        }
      } finally {
        t.cleanup();
      }
    },
  );
});
