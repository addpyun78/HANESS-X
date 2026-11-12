import { eventFactory, runLineProcess } from '@harness-x/kernel';
import {
  deliverToCli,
  type EngineAdapter,
  type EngineInputs,
  type EngineRun,
  type EngineRunOptions,
} from '@harness-x/protocol';
import { buildClaudeArgs } from './args.js';
import { ClaudeStreamParser } from './parser.js';

export const CLAUDE_CODE_ENGINE_ID = 'claude-code';

/**
 * T-101 1D.1 Claude Code 입력 능력: Read 도구로 그림·PDF를 직접 본다 (소리는 못 들음).
 * 그림은 API 한도(5MB)를 넘으면 축소본.
 */
export const CLAUDE_CODE_INPUTS: EngineInputs = { image: true, pdf: true, audio: false, maxImageMB: 5 };

/** 프롬프트 첨부 목록 앞에 붙이는 읽는 방법 */
export const CLAUDE_ATTACHMENT_HINT = '그림·PDF는 Read 도구로 경로를 열어 직접 보세요.';

export interface ClaudeCodeEngineOptions {
  /** 실행 파일 (기본 claude). 테스트에서는 node 등으로 교체 */
  command?: string;
  /** claude 인자 앞에 붙일 인자 (예: 더미 스크립트 경로) */
  prefixArgs?: string[];
  /** interrupt 시 SIGKILL까지 유예 (기본 1000ms) */
  killGraceMs?: number;
}

export interface ClaudeCodeRun extends EngineRun {
  /** system/init에서 본 도구·MCP 서버 목록 */
  initInfo(): { tools: string[]; mcpServers: { name: string; status: string }[] };
}

/**
 * claude-code 어댑터: 공식 claude 바이너리를 수정 없이 `-p` 자식 프로세스로 실행한다.
 * 인증은 opts.env(T-013 secrets가 만든 것)를 그대로 쓰고, 없으면 process.env. 토큰 파일은 읽지 않는다.
 */
export function createClaudeCodeEngine(o: ClaudeCodeEngineOptions = {}): Omit<EngineAdapter, 'run'> & {
  run(opts: EngineRunOptions): ClaudeCodeRun;
} {
  return {
    id: CLAUDE_CODE_ENGINE_ID,
    displayName: 'Claude Code',
    capabilities: {
      nativeStopHook: true,
      resume: true,
      mcp: true,
      interrupt: true,
      inputs: CLAUDE_CODE_INPUTS,
    },
    inputsFor: () => CLAUDE_CODE_INPUTS,
    run(opts: EngineRunOptions): ClaudeCodeRun {
      const parser = new ClaudeStreamParser();
      // 1D.3 첨부: 프롬프트에 목록(이름·종류·원본 경로·글 형태 경로)
      const { prompt } = deliverToCli(opts.prompt, opts.attachments, CLAUDE_CODE_INPUTS, {
        hint: CLAUDE_ATTACHMENT_HINT,
      });
      const args = buildClaudeArgs({ ...opts, prompt });
      const run = runLineProcess({
        command: o.command ?? 'claude',
        args: [...(o.prefixArgs ?? []), ...args],
        cwd: opts.cwd,
        env: opts.env ?? process.env,
        signal: opts.signal,
        killGraceMs: o.killGraceMs,
        event: eventFactory({
          sessionId: opts.sessionId,
          engineId: CLAUDE_CODE_ENGINE_ID,
          itemId: opts.itemId,
        }),
        parser,
      });
      return { ...run, initInfo: () => ({ tools: parser.initTools, mcpServers: parser.mcpServers }) };
    },
  };
}

export const claudeCodeEngine = createClaudeCodeEngine();
