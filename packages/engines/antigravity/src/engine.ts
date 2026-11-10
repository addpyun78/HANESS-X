import { eventFactory, runLineProcess } from '@harness-x/kernel';
import type { EngineAdapter, EngineCapabilities, EngineRunOptions } from '@harness-x/protocol';
import { buildAgyArgs } from './args.js';
import { AgyStreamParser } from './parser.js';

export const ANTIGRAVITY_ENGINE_ID = 'antigravity';

/** 16.3 agy에는 네이티브 Stop 훅이 없다 → 체크리스트 엔진은 하네스 측 재주입 경로를 쓴다 */
export const ANTIGRAVITY_CAPABILITIES: EngineCapabilities = {
  nativeStopHook: false,
  resume: true,
  mcp: false,
  interrupt: true,
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
    run(opts: EngineRunOptions) {
      return runLineProcess({
        command: o.command ?? 'agy',
        args: [...(o.prefixArgs ?? []), ...buildAgyArgs(opts)],
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
