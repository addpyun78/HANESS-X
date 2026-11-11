import type { ModelInputs, ModelOption } from '@harness-x/protocol';

/**
 * T-101 5 엔진 자동 탐지 · 모델 선택 — 화면 모델 (커널 /api/engines/scan-status · /api/models · /api/main-ai)
 */

export type EngineProgressState = 'checking' | 'ready' | 'needs-login' | 'missing';

/** engine-scanner progress.ts ScanProgress와 같은 모양 */
export interface ScanProgressView {
  state: 'idle' | 'scanning' | 'done';
  reason?: string;
  startedAt?: string;
  finishedAt?: string;
  engines: { name: string; label: string; state: EngineProgressState; models?: number }[];
  found: number;
  added: string[];
  removed: string[];
}

export interface AiChoice {
  engine: string;
  model?: string;
}

/** 5C.3b 다른 AI를 골랐을 때 적용 범위 — 기본은 "모든 곳 기본(메인)" */
export type ChoiceScope = 'main' | 'project' | 'session';
export const SCOPE_LABEL: Record<ChoiceScope, string> = {
  main: '모든 곳 기본(메인)으로',
  project: '이 프로젝트 기본으로',
  session: '이 세션만',
};

export const AUTH_BADGE: Record<ModelOption['auth'], string> = {
  subscription: '구독',
  api: 'API',
  local: '무료 로컬',
};

export interface ModelGroup {
  engineId: string;
  label: string;
  models: ModelOption[];
}

/** 5C.2 엔진별 묶음 (목록 순서 유지) */
export function groupModels(models: readonly ModelOption[]): ModelGroup[] {
  const out: ModelGroup[] = [];
  for (const m of models) {
    let g = out.find((x) => x.engineId === m.engineId);
    if (!g) {
      g = { engineId: m.engineId, label: m.engineLabel ?? m.engineId, models: [] };
      out.push(g);
    }
    g.models.push(m);
  }
  return out;
}

export const findModel = (models: readonly ModelOption[], c: AiChoice | undefined) =>
  c
    ? (models.find((m) => m.engineId === c.engine && (!c.model || m.modelId === c.model)) ??
      models.find((m) => m.engineId === c.engine))
    : undefined;

/** 버튼 글자: `claude-code · sonnet` (모델을 안 골랐으면 엔진 이름만) */
export function choiceLabel(c: AiChoice | undefined): string {
  if (!c) return 'AI 고르기';
  return c.model ? `${c.engine} · ${c.model}` : c.engine;
}

export type MainAiState = 'ok' | 'needs-login' | 'missing' | 'unset';

/** 5C.6 메인 AI를 지금 쓸 수 있나 (로그아웃·삭제 → 경고) */
export function mainAiStatus(main: AiChoice | undefined, models: readonly ModelOption[]): MainAiState {
  if (!main) return 'unset';
  const m = findModel(models, main);
  if (!m || m.status === 'unavailable') return 'missing';
  if (m.status === 'needs-login') return 'needs-login';
  return 'ok';
}

/** 메인 AI를 고르지 않았을 때 처음 쓸 것: 준비된 첫 모델 */
export function firstReady(models: readonly ModelOption[]): AiChoice | undefined {
  const m = models.find((x) => x.status === 'ready');
  return m ? { engine: m.engineId, model: m.modelId } : undefined;
}

/**
 * 5D.7a 메인 AI가 받을 수 있는 입력(이미지·PDF·소리). 첨부 안내 문구(1번)는 이 값을 기준으로 바꾼다.
 * 메인 AI가 없거나 목록에 없으면 undefined
 */
export function mainAiInputs(
  main: AiChoice | undefined,
  models: readonly ModelOption[],
): ModelInputs | undefined {
  return findModel(models, main)?.inputs;
}

/** 5C.3b 고른 범위대로 저장 */
export interface ChoiceTargets {
  setMain(c: AiChoice): Promise<unknown> | unknown;
  /** 프로젝트 기본 AI 저장 (0-2 프로젝트 기능이 주입). 없으면 "이 프로젝트 기본으로"를 보이지 않는다 */
  setProjectDefault?(c: AiChoice): Promise<unknown> | unknown;
  /** 이 세션만 (실행 중이면 다음 턴부터, 서버 기록) */
  setSession(c: AiChoice): Promise<unknown> | unknown;
}

export async function applyModelChoice(
  scope: ChoiceScope,
  c: AiChoice,
  t: ChoiceTargets,
): Promise<ChoiceScope> {
  if (scope === 'project' && t.setProjectDefault) {
    await t.setProjectDefault(c);
    return 'project';
  }
  if (scope === 'session') {
    await t.setSession(c);
    return 'session';
  }
  await t.setMain(c);
  return 'main';
}

/** 5D.1 빌더 서랍 "엔진" 탭: 같은 모델 목록을 엔진별 블록으로 (배지 포함) + 메인 AI 따라가기 */
export interface EngineBlock {
  id: string;
  label: string;
  description?: string;
}

export const MAIN_BLOCK: EngineBlock = {
  id: 'main',
  label: '메인 AI 따라가기',
  description: '메인 AI를 바꾸면 같이 바뀜',
};

export function engineBlocksFromModels(models: readonly ModelOption[]): EngineBlock[] {
  return [
    MAIN_BLOCK,
    ...groupModels(models).map((g) => {
      const badges = [...new Set(g.models.map((m) => AUTH_BADGE[m.auth]))].map((b) => `[${b}]`).join(' ');
      const login = g.models.every((m) => m.status === 'needs-login') ? ' · 로그인 필요' : '';
      return {
        id: g.engineId,
        label: g.label,
        description: `${badges} · 모델 ${g.models.length}개${login}`,
      };
    }),
  ];
}

/** 진행 상태 한 줄 글자 */
export function progressMark(state: EngineProgressState): string {
  if (state === 'ready') return '✓';
  if (state === 'checking') return '…';
  if (state === 'needs-login') return '로그인 필요';
  return '없음';
}

/** 5A.4 완료 문구 */
export function doneText(p: ScanProgressView): string {
  return `엔진 ${p.found}개를 찾았어요`;
}

export function changeText(p: ScanProgressView, label: (name: string) => string): string | undefined {
  const parts: string[] = [];
  if (p.added.length) parts.push(`새로 찾은 엔진: ${p.added.map(label).join(', ')}`);
  if (p.removed.length) parts.push(`사라진 엔진: ${p.removed.map(label).join(', ')}`);
  return parts.length ? parts.join(' · ') : undefined;
}

export const NOTHING_FOUND = '쓸 수 있는 AI를 못 찾았어요';
export const PICK_OTHER = '다른 AI를 골라 주세요';
