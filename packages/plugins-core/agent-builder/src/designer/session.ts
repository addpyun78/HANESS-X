import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildJudgeCliArgs,
  defaultJudgeSpawn,
  DEFAULT_ENGINE_COMMANDS,
  isJudgeCliEngine,
  judgeEngineEnv,
  normalizeEngineId,
  parseJudgeCliOutput,
  type JudgeEngineInfo,
  type JudgeSpawn,
} from '@harness-x/judge';
import { OpenAIChatClient } from '@harness-x/engine-openai-compat';
import type { SecretStore } from '@harness-x/kernel';
import type { DesignerPrompt } from './prompt.js';

/**
 * P4-C.2 설계 세션 — 판정기(@harness-x/judge E.5)와 같은 방식으로 엔진 어댑터를 재사용한다.
 *   - 새 빈 임시 폴더에서 1회 실행, 읽기 전용 권한 모드, 도구·MCP 없음
 *     claude -p --permission-mode plan --strict-mcp-config --tools ""
 *     codex exec --sandbox read-only --cd <빈 폴더>
 *     agy --mode plan -p
 *     API 엔진: /chat/completions, tools: []
 *   - 답에 도구 호출이 하나라도 있으면 그 답은 버린다 (설계 세션 도구 호출 0건)
 *   - 엔진 인증 모드를 따른다 (구독이면 API 키 환경변수 제거)
 */

/** 설계 AI 한 번 묻기 (도구 호출이 있었으면 undefined) */
export type DesignerAsk = (prompt: DesignerPrompt, signal?: AbortSignal) => Promise<string | undefined>;

export interface DesignerSessionOptions {
  model?: string;
  spawn?: JudgeSpawn;
  baseEnv?: NodeJS.ProcessEnv;
  secretStore?: SecretStore;
  fetch?: typeof fetch;
}

export interface DesignerSession {
  engineId: string;
  ask: DesignerAsk;
  /** 지금까지 버린 답의 도구 호출 수 (기록용) */
  readonly rejectedToolCalls: number;
}

const flatten = (p: DesignerPrompt) => `${p.system}\n\n${p.user}`;

export function createDesignerSession(
  engine: JudgeEngineInfo,
  opts: DesignerSessionOptions = {},
): DesignerSession {
  const engineId = normalizeEngineId(engine.id);
  let rejected = 0;

  if (engine.kind === 'api') {
    return {
      engineId,
      get rejectedToolCalls() {
        return rejected;
      },
      async ask(prompt, signal) {
        try {
          const apiKey =
            engine.authMode === 'apiKey' ? (opts.secretStore?.getApiKey(engineId) ?? undefined) : undefined;
          const client = new OpenAIChatClient({
            baseUrl: engine.api?.baseUrl ?? '',
            model: opts.model || engine.api?.model || '',
            apiKey,
            jsonMode: true,
            temperature: 0,
            ...(opts.fetch ? { fetch: opts.fetch } : {}),
          });
          const turn = await client.complete({
            messages: [
              { role: 'system', content: prompt.system },
              { role: 'user', content: prompt.user },
            ],
            tools: [],
            ...(signal ? { signal } : {}),
          });
          if (turn.toolCalls.length > 0) {
            rejected += turn.toolCalls.length;
            return undefined;
          }
          return turn.text || undefined;
        } catch {
          return undefined;
        }
      },
    };
  }

  if (!isJudgeCliEngine(engineId)) {
    return { engineId, rejectedToolCalls: 0, ask: () => Promise.resolve(undefined) };
  }
  const cli = engineId;
  const run = opts.spawn ?? defaultJudgeSpawn;
  return {
    engineId,
    get rejectedToolCalls() {
      return rejected;
    },
    async ask(prompt, signal) {
      let cwd: string | undefined;
      try {
        const env = judgeEngineEnv(engine, {
          ...(opts.baseEnv ? { baseEnv: opts.baseEnv } : {}),
          ...(opts.secretStore ? { secretStore: opts.secretStore } : {}),
        });
        cwd = mkdtempSync(join(tmpdir(), 'hx-designer-'));
        const args = buildJudgeCliArgs(cli, flatten(prompt), {
          ...(opts.model ? { model: opts.model } : {}),
          cwd,
        });
        const r = await run(engine.command ?? DEFAULT_ENGINE_COMMANDS[cli], args, {
          env,
          cwd,
          ...(signal ? { signal } : {}),
        });
        if (r.code !== 0) return undefined;
        const out = parseJudgeCliOutput(cli, r.stdout);
        if (out.toolCalls > 0) {
          rejected += out.toolCalls;
          return undefined;
        }
        return out.text;
      } catch {
        return undefined;
      } finally {
        if (cwd) rmSync(cwd, { recursive: true, force: true });
      }
    },
  };
}
