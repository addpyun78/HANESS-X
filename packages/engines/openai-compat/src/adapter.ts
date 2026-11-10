import { randomUUID } from 'node:crypto';
import { runAgentLoop, toEngineRun, type AgentTool, type HookBus, type ModelClient } from '@harness-x/kernel';
import type { EngineAdapter, EngineRun, EngineRunOptions, HarnessEvent } from '@harness-x/protocol';
import type { FetchLike } from './http.js';
import { autoToolModeClient, jsonFallbackClient } from './json-fallback.js';
import { OpenAIChatClient } from './openai.js';

/**
 * API 엔진 어댑터: 모델 API 클라이언트 + 하네스 자체 도구 루프(kernel runAgentLoop)
 * API 키는 EngineRunOptions.env에서만 읽는다 (secrets 모듈이 채운다).
 */

export type ApiProvider = 'openai-compat';

export interface ApiEngineConfig {
  /** 예: openai-compat:ollama */
  id: string;
  displayName: string;
  provider: ApiProvider;
  /** 공급자 API 기준 URL (기본값은 공급자별) */
  baseUrl?: string;
  /** opts.model이 없을 때 */
  defaultModel?: string;
  /** API 키를 꺼낼 env 변수 이름 */
  apiKeyEnv?: string;
  /** 키가 없으면 auth_required로 실패 (원격 유료 API) */
  requireApiKey?: boolean;
  /** 하네스 훅 버스 (tool.before/tool.after) */
  hooks?: HookBus;
  /** 기본 workspaceTools() */
  tools?: AgentTool[];
  system?: string;
  maxIterations?: number;
  fetch?: FetchLike;
  /** 도구 호출 방식: native(function calling), json(JSON 모드 폴백), auto(미지원 응답 시 json으로 전환, 기본) */
  toolMode?: 'native' | 'json' | 'auto';
}

export const DEFAULT_SYSTEM_PROMPT =
  'You are a coding agent working inside a workspace folder. Use the provided tools to inspect and change files. ' +
  'Paths are relative to the workspace root. When the task is done, answer with a short final message.';

export const OLLAMA_BASE_URL = 'http://127.0.0.1:11434/v1';

function makeClient(cfg: ApiEngineConfig, model: string, apiKey: string | undefined): ModelClient {
  const openai = (jsonMode: boolean) =>
    new OpenAIChatClient({
      baseUrl: cfg.baseUrl ?? OLLAMA_BASE_URL,
      model,
      ...(apiKey ? { apiKey } : {}),
      ...(cfg.fetch ? { fetch: cfg.fetch } : {}),
      ...(jsonMode ? { jsonMode } : {}),
    });
  const mode = cfg.toolMode ?? 'auto';
  if (mode === 'native') return openai(false);
  if (mode === 'json') return jsonFallbackClient(openai(true));
  return autoToolModeClient(openai(false), openai(true));
}

function failRun(opts: EngineRunOptions, engineId: string, code: string, message: string): EngineRun {
  const base = () => ({
    id: randomUUID(),
    ts: new Date().toISOString(),
    sessionId: opts.sessionId,
    engineId,
  });
  const evs: HarnessEvent[] = [
    { ...base(), type: 'error', code, message, retryable: false },
    { ...base(), type: 'turn_end', reason: 'error' },
  ];
  return toEngineRun(async function* () {
    yield* evs;
  });
}

export function createApiEngine(cfg: ApiEngineConfig): EngineAdapter {
  return {
    id: cfg.id,
    displayName: cfg.displayName,
    capabilities: { nativeStopHook: false, resume: false, mcp: false, interrupt: true },
    run(opts: EngineRunOptions): EngineRun {
      const model = opts.model ?? cfg.defaultModel;
      if (!model) return failRun(opts, cfg.id, 'invalid_request', `${cfg.id}: model이 지정되지 않았습니다`);
      const apiKey = cfg.apiKeyEnv ? opts.env?.[cfg.apiKeyEnv] : undefined;
      if (cfg.requireApiKey && !apiKey)
        return failRun(opts, cfg.id, 'auth_required', `${cfg.id}: ${cfg.apiKeyEnv ?? 'API 키'}가 필요합니다`);
      const client = makeClient(cfg, model, apiKey);
      return toEngineRun(
        (signal) =>
          runAgentLoop({
            client,
            sessionId: opts.sessionId,
            cwd: opts.cwd,
            prompt: opts.prompt,
            engineId: cfg.id,
            ...(opts.itemId ? { itemId: opts.itemId } : {}),
            system: cfg.system ?? DEFAULT_SYSTEM_PROMPT,
            ...(cfg.tools ? { tools: cfg.tools } : {}),
            ...(opts.permission ? { permission: opts.permission } : {}),
            ...(cfg.hooks ? { hooks: cfg.hooks } : {}),
            ...(cfg.maxIterations ? { maxIterations: cfg.maxIterations } : {}),
            signal,
          }),
        { signal: opts.signal },
      );
    },
  };
}

/** 로컬 Ollama (OpenAI 호환 /v1) */
export function ollamaEngine(extra: Partial<ApiEngineConfig> = {}): EngineAdapter {
  return createApiEngine({
    id: 'openai-compat:ollama',
    displayName: 'Ollama (로컬)',
    provider: 'openai-compat',
    baseUrl: OLLAMA_BASE_URL,
    ...extra,
  });
}
