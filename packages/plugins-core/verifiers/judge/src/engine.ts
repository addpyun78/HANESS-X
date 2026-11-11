import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AGY_MODES } from '@harness-x/engine-antigravity';
import { CLAUDE_PERMISSION_MODES } from '@harness-x/engine-claude-code';
import { CodexExecParser, codexSandbox } from '@harness-x/engine-codex';
import { OpenAIChatClient } from '@harness-x/engine-openai-compat';
import { buildEngineEnv, type SecretStore } from '@harness-x/kernel';
import { flattenPrompt, parseJudgeAnswer } from './questions.js';
import type { JudgeAnswer, JudgeBackend, JudgePrompt } from './types.js';

/**
 * E.5 엔진 판정기 (① judge.engine · ③ 구독 엔진 공용)
 *   - 엔진 어댑터의 권한 모드 표(읽기 전용)·파서를 재사용한다
 *   - 판정 전용 짧은 세션: 새 빈 임시 폴더에서 1회 실행, 이어하기·MCP 없음, 도구 사용 금지
 *     claude      -p --output-format json --permission-mode plan --tools "" --strict-mcp-config
 *     codex       exec --json --sandbox read-only --skip-git-repo-check --cd <빈 폴더>
 *     antigravity --mode plan -p <프롬프트>
 *     API 엔진    /chat/completions + response_format json_object, tools 없음
 *   - 답에 도구 호출이 하나라도 있으면 그 답은 버린다(undefined)
 * E.6 엔진의 구독/API 설정을 따른다: 구독 모드면 API 키 환경변수를 모두 제거(T-013 buildEngineEnv)
 */

export type JudgeCliEngineId = 'claude-code' | 'codex' | 'antigravity';

export const JUDGE_CLI_ENGINES: readonly JudgeCliEngineId[] = ['claude-code', 'codex', 'antigravity'];

/** 엔진 스캐너 이름(실행 파일) → 어댑터 id */
export const ENGINE_ID_ALIASES: Readonly<Record<string, string>> = {
  claude: 'claude-code',
  agy: 'antigravity',
};

export function normalizeEngineId(id: string | undefined): string {
  if (!id) return '';
  const k = id.trim().toLowerCase();
  return ENGINE_ID_ALIASES[k] ?? k;
}

export const DEFAULT_ENGINE_COMMANDS: Readonly<Record<JudgeCliEngineId, string>> = {
  'claude-code': 'claude',
  codex: 'codex',
  antigravity: 'agy',
};

/** 주입 받는 엔진 상태 (engine-scanner 탐지 결과 + 로그인/인증 모드) */
export interface JudgeEngineInfo {
  /** claude-code | codex | antigravity | openai-compat … (claude·agy 별칭 허용) */
  id: string;
  detected: boolean;
  loggedIn: boolean;
  authMode: 'subscription' | 'apiKey';
  /** 'api' = HTTP API 엔진 (openai-compat 계열) */
  kind?: 'cli' | 'api';
  /** CLI 실행 파일 경로 (스캐너가 찾은 것) */
  command?: string;
  /** API 엔진 접속 정보 */
  api?: { baseUrl: string; model?: string };
}

export interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type JudgeSpawn = (
  command: string,
  args: string[],
  opts: { env: NodeJS.ProcessEnv; cwd: string; signal?: AbortSignal },
) => Promise<SpawnResult>;

/** 기본 실행기: 셸 없이 실행, stdin 닫음, 신호 오면 종료. 예외 대신 code=null */
export const defaultJudgeSpawn: JudgeSpawn = (command, args, opts) =>
  new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const done = (code: number | null) => {
      if (settled) return;
      settled = true;
      resolve({ code, stdout, stderr });
    };
    try {
      const child = spawn(command, args, {
        cwd: opts.cwd,
        env: opts.env,
        signal: opts.signal,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
      child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
      child.on('error', () => done(null));
      child.on('close', (code) => done(code));
    } catch {
      done(null);
    }
  });

/** E.5 엔진별 판정 전용 실행 인자 (읽기 전용·도구 없음) */
export function buildJudgeCliArgs(
  engineId: JudgeCliEngineId,
  prompt: string,
  opts: { model?: string; cwd: string },
): string[] {
  switch (engineId) {
    case 'claude-code': {
      const args = [
        '-p',
        '--output-format',
        'json',
        '--permission-mode',
        CLAUDE_PERMISSION_MODES['read-only'],
      ];
      args.push('--strict-mcp-config', '--tools', '');
      if (opts.model) args.push('--model', opts.model);
      args.push('--', prompt);
      return args;
    }
    case 'codex': {
      const args = ['exec', '--json', '--sandbox', codexSandbox('read-only'), '--skip-git-repo-check'];
      args.push('--cd', opts.cwd);
      if (opts.model) args.push('--model', opts.model);
      args.push('--', prompt);
      return args;
    }
    case 'antigravity': {
      const args = ['--mode', AGY_MODES['read-only']];
      if (opts.model) args.push('--model', opts.model);
      args.push('-p', prompt);
      return args;
    }
  }
}

export interface CliJudgeOutput {
  /** 엔진의 최종 답 텍스트 */
  text?: string;
  /** 도구 호출(시도 포함) 수 — 판정에서는 0이어야 한다 */
  toolCalls: number;
}

/** 엔진 출력 → 답 텍스트 + 도구 호출 수 */
export function parseJudgeCliOutput(engineId: JudgeCliEngineId, stdout: string): CliJudgeOutput {
  switch (engineId) {
    case 'claude-code': {
      // --output-format json: 마지막 줄이 { type: 'result', result, is_error, permission_denials, … }
      const lines = stdout.trim().split(/\r?\n/).reverse();
      for (const line of lines) {
        let o: Record<string, unknown>;
        try {
          o = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (o.type !== 'result') continue;
        const denials = Array.isArray(o.permission_denials) ? o.permission_denials.length : 0;
        const turns = typeof o.num_turns === 'number' ? o.num_turns : 1;
        const toolCalls = denials + Math.max(0, turns - 1);
        if (o.is_error === true || typeof o.result !== 'string') return { toolCalls };
        return { text: o.result, toolCalls };
      }
      return { toolCalls: 0 };
    }
    case 'codex': {
      const p = new CodexExecParser();
      let text: string | undefined;
      let toolCalls = 0;
      for (const line of stdout.split(/\r?\n/)) {
        for (const ev of p.line(line)) {
          if (ev.type === 'tool_call' || ev.type === 'file_change') toolCalls++;
          if (ev.type === 'assistant_text') text = ev.text;
        }
      }
      return { text, toolCalls };
    }
    case 'antigravity':
      // agy -p: 일반 텍스트 응답
      return { text: stdout.trim() || undefined, toolCalls: 0 };
  }
}

/** E.6 판정 자식 프로세스 env — 엔진 인증 모드를 따른다 (구독: 키 변수 전부 제거) */
export function judgeEngineEnv(
  engine: Pick<JudgeEngineInfo, 'id' | 'authMode'>,
  opts: { baseEnv?: NodeJS.ProcessEnv; secretStore?: SecretStore } = {},
): NodeJS.ProcessEnv {
  return buildEngineEnv({
    engineId: normalizeEngineId(engine.id),
    mode: engine.authMode,
    baseEnv: opts.baseEnv ?? process.env,
    store: opts.secretStore,
  });
}

export function isJudgeCliEngine(id: string): id is JudgeCliEngineId {
  return (JUDGE_CLI_ENGINES as readonly string[]).includes(id);
}

/** 판정에 쓸 수 있는 엔진인가 (CLI 3종 또는 접속 정보가 있는 API 엔진) */
export function isJudgeCapableEngine(e: JudgeEngineInfo): boolean {
  if (e.kind === 'api') return !!e.api?.baseUrl;
  return isJudgeCliEngine(normalizeEngineId(e.id));
}

export interface EngineJudgeOptions {
  model?: string;
  spawn?: JudgeSpawn;
  baseEnv?: NodeJS.ProcessEnv;
  secretStore?: SecretStore;
  fetch?: typeof fetch;
}

export function createEngineJudge(engine: JudgeEngineInfo, opts: EngineJudgeOptions = {}): JudgeBackend {
  const engineId = normalizeEngineId(engine.id);

  if (engine.kind === 'api') {
    return {
      id: `engine:${engineId}`,
      via: 'engine',
      engineId,
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
            fetch: opts.fetch,
          });
          const turn = await client.complete({
            messages: [
              { role: 'system', content: prompt.system },
              { role: 'user', content: prompt.user },
            ],
            tools: [],
            signal,
          });
          if (turn.toolCalls.length > 0) return undefined;
          return parseJudgeAnswer(turn.text, prompt.questions);
        } catch {
          return undefined;
        }
      },
    };
  }

  if (!isJudgeCliEngine(engineId)) {
    return { id: `engine:${engineId}`, via: 'engine', engineId, ask: () => Promise.resolve(undefined) };
  }
  const cli: JudgeCliEngineId = engineId;
  const run = opts.spawn ?? defaultJudgeSpawn;
  return {
    id: `engine:${cli}`,
    via: 'engine',
    engineId: cli,
    async ask(prompt: JudgePrompt, signal?: AbortSignal): Promise<JudgeAnswer | undefined> {
      let cwd: string | undefined;
      try {
        const env = judgeEngineEnv(engine, opts);
        cwd = mkdtempSync(join(tmpdir(), 'hx-judge-'));
        const args = buildJudgeCliArgs(cli, flattenPrompt(prompt), { model: opts.model, cwd });
        const r = await run(engine.command ?? DEFAULT_ENGINE_COMMANDS[cli], args, { env, cwd, signal });
        if (r.code !== 0) return undefined;
        const out = parseJudgeCliOutput(cli, r.stdout);
        if (out.toolCalls > 0 || !out.text) return undefined;
        return parseJudgeAnswer(out.text, prompt.questions);
      } catch {
        return undefined;
      } finally {
        if (cwd) rmSync(cwd, { recursive: true, force: true });
      }
    },
  };
}
