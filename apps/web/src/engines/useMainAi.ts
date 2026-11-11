import type { ModelOption } from '@harness-x/protocol';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EngineScanApi } from './api.js';
import { applyModelChoice, firstReady, type AiChoice, type ChoiceScope } from './model.js';

/** 프로젝트 기본 AI (0-2 프로젝트 기능이 주입 — 0B.40). 없으면 프로젝트 기본 없음 */
export interface ProjectDefaults {
  get(): AiChoice | undefined;
  set(c: AiChoice): Promise<unknown> | unknown;
}

export interface MainAiState {
  models: ModelOption[];
  main: AiChoice | undefined;
  /** 지금 입력창이 쓰는 AI: 이 세션만 → 프로젝트 기본 → 메인 → (메인 미지정이면) 준비된 첫 모델 */
  current: AiChoice | undefined;
  from: 'session' | 'project' | 'main' | 'none';
  choose(c: AiChoice, scope: ChoiceScope): Promise<void>;
  reload(): Promise<void>;
}

/**
 * 5C 메인 AI 상태: GET /api/models · /api/main-ai. 고른 범위대로 저장(5C.3b):
 * 모든 곳 기본 → PUT /api/main-ai, 이 프로젝트 기본 → projectDefaults.set, 이 세션만 → PUT /api/sessions/:id/ai
 */
export function useMainAi(
  api: EngineScanApi | undefined,
  opts: { sessionId?: string; project?: ProjectDefaults; generation?: number } = {},
): MainAiState {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [main, setMain] = useState<AiChoice>();
  const [session, setSession] = useState<Record<string, AiChoice>>({});
  const [projectVer, setProjectVer] = useState(0);
  const { sessionId, project, generation } = opts;

  const reload = useCallback(async () => {
    if (!api) return;
    const [m, a] = await Promise.all([
      api.models().catch(() => undefined),
      api.mainAi().catch(() => undefined),
    ]);
    if (m) setModels(m.models);
    if (a) setMain(a.main ?? undefined);
  }, [api]);

  useEffect(() => {
    void reload();
  }, [reload, generation]);

  const projectChoice = useMemo(
    () => project?.get(),
    // projectVer: 프로젝트 기본을 바꾼 뒤 다시 읽기
    [project, projectVer],
  );
  const sessionChoice = session[sessionId ?? ''];
  const picked = sessionChoice
    ? { c: sessionChoice, from: 'session' as const }
    : projectChoice
      ? { c: projectChoice, from: 'project' as const }
      : main
        ? { c: main, from: 'main' as const }
        : { c: firstReady(models), from: 'none' as const };

  const choose = useCallback(
    async (c: AiChoice, scope: ChoiceScope) => {
      if (!api) return;
      const done = await applyModelChoice(scope, c, {
        setMain: async (x) => {
          await api.setMainAi(x);
          setMain(x);
        },
        ...(project
          ? {
              setProjectDefault: async (x: AiChoice) => {
                await project.set(x);
                setProjectVer((v) => v + 1);
              },
            }
          : {}),
        setSession: async (x) => {
          if (sessionId) await api.setSessionAi(sessionId, x).catch(() => undefined);
          setSession((s) => ({ ...s, [sessionId ?? '']: x }));
        },
      });
      // 모든 곳 기본으로 바꾸면 이 세션만 고른 것은 지운다
      if (done === 'main')
        setSession((s) => {
          const n = { ...s };
          delete n[sessionId ?? ''];
          return n;
        });
    },
    [api, project, sessionId],
  );

  return { models, main, current: picked.c, from: picked.from, choose, reload };
}
