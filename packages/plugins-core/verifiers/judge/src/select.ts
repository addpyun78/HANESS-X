import type { SecretStore } from '@harness-x/kernel';
import {
  createEngineJudge,
  isJudgeCapableEngine,
  normalizeEngineId,
  type JudgeEngineInfo,
  type JudgeSpawn,
} from './engine.js';
import {
  createLocalJudge,
  LOCAL_JUDGE_ENGINE_ID,
  OLLAMA_DEFAULT_BASE_URL,
  pickLocalModel,
  probeOllama,
  type OllamaStatus,
} from './local.js';
import type { JudgeSettings } from './settings.js';
import type { JudgeBackend } from './types.js';

/**
 * E.2 판정기 선택 순서
 *   ① judge.engine (감지·로그인 OK) — 비어 있으면("자동") 메인 AI(T-101 5C.3 main.engine)
 *   ② 로컬 Ollama (기동 + 모델 있음)
 *   ③ 로그인된 구독 엔진 (E.7: 항목 작성 엔진과 다른 엔진 우선, 없으면 같은 엔진 + sameEngineJudge)
 *   ④ 없음 → 승인 카드(H)
 * semantic=off는 이 함수 전에 체인에서 즉시 different로 끝난다.
 */

export interface JudgeSelectDeps {
  /** T-101 5C.3 메인 AI 엔진 (judge.engine이 "자동"일 때 먼저 쓴다) */
  mainEngine?(): string | undefined;
  /** engine-scanner 탐지 결과 + 로그인/인증 모드 (주입) */
  listEngines(): Promise<readonly JudgeEngineInfo[]> | readonly JudgeEngineInfo[];
  /** 로컬 Ollama 상태 (기본: GET /api/tags) */
  probeOllama?(): Promise<OllamaStatus>;
  ollamaBaseUrl?: string;
  fetch?: typeof fetch;
  spawn?: JudgeSpawn;
  baseEnv?: NodeJS.ProcessEnv;
  secretStore?: SecretStore;
  /** 백엔드 생성 교체 (테스트·확장용) */
  createEngineJudge?(engine: JudgeEngineInfo, opts: { model?: string }): JudgeBackend;
  createLocalJudge?(opts: { model: string; timeoutMs: number; baseUrl: string }): JudgeBackend;
}

export type JudgeSelection =
  | {
      step: 1 | 2 | 3;
      backend: JudgeBackend;
      engineId: string;
      sameEngineJudge: boolean;
    }
  | { step: 4; reason: 'no-judge' };

function usable(e: JudgeEngineInfo): boolean {
  return e.detected && e.loggedIn && isJudgeCapableEngine(e);
}

export async function selectJudge(
  settings: JudgeSettings,
  deps: JudgeSelectDeps,
  authorEngineId?: string,
): Promise<JudgeSelection> {
  const author = normalizeEngineId(authorEngineId);
  let engines: readonly JudgeEngineInfo[] = [];
  try {
    engines = await deps.listEngines();
  } catch {
    engines = [];
  }
  const makeEngine = (e: JudgeEngineInfo, model?: string): JudgeBackend =>
    deps.createEngineJudge
      ? deps.createEngineJudge(e, { model })
      : createEngineJudge(e, {
          model,
          spawn: deps.spawn,
          baseEnv: deps.baseEnv,
          secretStore: deps.secretStore,
          fetch: deps.fetch,
        });

  // ① 사용자가 지정한 엔진 (같은 엔진이어도 그대로 쓰고 표시만)
  const wanted =
    normalizeEngineId(settings.engine) ||
    normalizeEngineId(
      (() => {
        try {
          return deps.mainEngine?.();
        } catch {
          return undefined;
        }
      })(),
    );
  if (wanted) {
    const e = engines.find((x) => normalizeEngineId(x.id) === wanted);
    if (e && usable(e)) {
      return {
        step: 1,
        backend: makeEngine(e, settings.model || undefined),
        engineId: wanted,
        sameEngineJudge: !!author && wanted === author,
      };
    }
  }

  // ② 로컬 Ollama
  const baseUrl = deps.ollamaBaseUrl ?? OLLAMA_DEFAULT_BASE_URL;
  let status: OllamaStatus;
  try {
    status = deps.probeOllama ? await deps.probeOllama() : await probeOllama({ baseUrl, fetch: deps.fetch });
  } catch {
    status = { running: false, models: [] };
  }
  const model = status.running ? pickLocalModel(settings.local.model, status.models) : undefined;
  if (model) {
    const o = { model, timeoutMs: settings.local.timeoutMs, baseUrl };
    return {
      step: 2,
      backend: deps.createLocalJudge
        ? deps.createLocalJudge(o)
        : createLocalJudge({ ...o, fetch: deps.fetch }),
      engineId: LOCAL_JUDGE_ENGINE_ID,
      sameEngineJudge: false,
    };
  }

  // ③ 로그인된 구독 엔진 — 작성 엔진과 다른 엔진 우선 (E.7)
  const subs = engines.filter((e) => usable(e) && e.authMode === 'subscription');
  const other = subs.find((e) => normalizeEngineId(e.id) !== author);
  const pick = other ?? subs[0];
  if (pick) {
    const id = normalizeEngineId(pick.id);
    return { step: 3, backend: makeEngine(pick), engineId: id, sameEngineJudge: !!author && id === author };
  }

  // ④ 승인 카드
  return { step: 4, reason: 'no-judge' };
}
