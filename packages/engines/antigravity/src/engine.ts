import { eventFactory, runLineProcess } from '@harness-x/kernel';
import {
  deliverToCli,
  type EngineAdapter,
  type EngineCapabilities,
  type EngineInputs,
  type EngineRunOptions,
} from '@harness-x/protocol';
import { buildAgyArgs } from './args.js';
import { AgyStreamParser } from './parser.js';

export const ANTIGRAVITY_ENGINE_ID = 'antigravity';

/** T-101 1D.1 agy(Gemini): 작업 폴더 안 그림·PDF 경로를 직접 읽는다, 그림 최대 7MB */
export const ANTIGRAVITY_INPUTS: EngineInputs = { image: true, pdf: true, audio: false, maxImageMB: 7 };

/** 16.3 agy에는 네이티브 Stop 훅이 없다 → 체크리스트 엔진은 하네스 측 재주입 경로를 쓴다 */
export const ANTIGRAVITY_CAPABILITIES: EngineCapabilities = {
  nativeStopHook: false,
  resume: true,
  mcp: false,
  interrupt: true,
  inputs: ANTIGRAVITY_INPUTS,
};

export interface AntigravityEngineOptions {
  /** 실행 파일 (기본 agy) */
  command?: string;
  prefixArgs?: string[];
  killGraceMs?: number;
}

/**
 * antigravity 어댑터: 공식 agy 바이너리를 수정 없이 `-p` 자식 프로세스로 실행한다.
 * 인증은 opts.env(없으면 process.env) 그대로, 로그인은 사용자가 터미널에서 직접 한다.
 */
export function createAntigravityEngine(o: AntigravityEngineOptions = {}): EngineAdapter {
  return {
    id: ANTIGRAVITY_ENGINE_ID,
    displayName: 'Antigravity',
    capabilities: ANTIGRAVITY_CAPABILITIES,
    inputsFor: () => ANTIGRAVITY_INPUTS,
    run(opts: EngineRunOptions) {
      // 1D.3 첨부: 프롬프트에 목록 (agy는 그림 옵션이 없어 경로로 읽게 한다)
      const { prompt } = deliverToCli(opts.prompt, opts.attachments, ANTIGRAVITY_INPUTS, {
        hint: '그림·PDF는 경로의 파일을 직접 열어 보세요.',
      });
      return runLineProcess({
        command: o.command ?? 'agy',
        args: [...(o.prefixArgs ?? []), ...buildAgyArgs({ ...opts, prompt })],
        cwd: opts.cwd,
        env: opts.env ?? process.env,
        signal: opts.signal,
        killGraceMs: o.killGraceMs,
        event: eventFactory({
          sessionId: opts.sessionId,
          engineId: ANTIGRAVITY_ENGINE_ID,
          itemId: opts.itemId,
        }),
        parser: new AgyStreamParser(),
      });
    },
  };
}

export const antigravityEngine = createAntigravityEngine();
