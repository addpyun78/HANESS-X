import { z } from 'zod';

/**
 * T-101 5B 모델 목록 — 입력창 오른쪽 아래 [엔진 · 모델 ▾] 버튼과 빌더 서랍 "엔진" 탭이 같은 목록을 쓴다.
 *   auth: subscription(구독 CLI) | api(API 키) | local(무료 로컬)
 *   status: ready | needs-login(로그인 필요) | unavailable(설치 안 됨·버전 확인 불가)
 */

export const MODEL_AUTHS = ['subscription', 'api', 'local'] as const;
export const MODEL_STATUSES = ['ready', 'needs-login', 'unavailable'] as const;
/** 목록 출처: 엔진이 준 목록 · 로컬 LLM 서버 목록 · 엔진 플러그인 기본 목록 · 사용자 추가 */
export const MODEL_SOURCES = ['engine', 'local-server', 'default', 'user'] as const;

export const ModelInputsSchema = z
  .object({
    image: z.boolean(),
    pdf: z.boolean(),
    audio: z.boolean(),
  })
  .strict();
export type ModelInputs = z.infer<typeof ModelInputsSchema>;

export const ModelOptionSchema = z
  .object({
    /** 하네스 엔진 id (claude-code, codex, antigravity, gemini, ollama …) */
    engineId: z.string().min(1),
    modelId: z.string().min(1),
    displayName: z.string().min(1),
    auth: z.enum(MODEL_AUTHS),
    inputs: ModelInputsSchema,
    status: z.enum(MODEL_STATUSES),
    /** 엔진 화면 이름 (묶음 제목) */
    engineLabel: z.string().min(1).optional(),
    source: z.enum(MODEL_SOURCES).optional(),
  })
  .strict();
export type ModelOption = z.infer<typeof ModelOptionSchema>;
export type ModelAuth = ModelOption['auth'];
export type ModelStatus = ModelOption['status'];

export const ModelsResponseSchema = z
  .object({
    models: z.array(ModelOptionSchema),
    /** 목록을 만든 스캔 시각 (캐시 기준) */
    scannedAt: z.string().nullable(),
  })
  .strict();
export type ModelsResponse = z.infer<typeof ModelsResponseSchema>;

/** 메인 AI: 시스템 기능(설정이 "자동"인 판정·검색·에이전트 설계 등)과 새 세션의 기본 엔진·모델 */
export const MainAiSchema = z
  .object({
    engine: z.string().min(1),
    model: z.string().min(1).optional(),
  })
  .strict();
export type MainAi = z.infer<typeof MainAiSchema>;

/** 노드·에이전트가 "메인 AI 따라가기"일 때의 엔진 값 (agent.yaml `engine: main`) */
export const MAIN_ENGINE_REF = 'main';

/** 엔진 스캐너 실행 파일 이름 → 하네스 엔진 id */
export const ENGINE_ID_BY_BIN: Readonly<Record<string, string>> = {
  claude: 'claude-code',
  codex: 'codex',
  agy: 'antigravity',
  gemini: 'gemini',
};
export const engineIdOfBin = (bin: string): string => ENGINE_ID_BY_BIN[bin] ?? bin;
