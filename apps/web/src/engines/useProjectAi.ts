import { useMemo, useRef, useState } from 'react';
import type { AiChoice } from './model.js';
import type { ProjectDefaults as ProjectAiSource } from './useMainAi.js';
import type { ProjectDefaults } from '../shell/projects/api.js';

/** 0-2 프로젝트 모양 (apps/web/src/shell/projects/api.ts ProjectView의 일부) */
export interface ProjectLike {
  id: string;
  defaults?: ProjectDefaults;
}

/**
 * T-101 5C.3b 프로젝트 기본 AI(0B.40 project.defaults.engine/model)를 모델 버튼에 연결.
 * [이 프로젝트 기본으로] → PATCH /api/projects/:id {defaults: {...기존, engine, model}}.
 * 저장 직후 목록이 다시 오기 전에도 바로 보이도록 고른 값을 기억해 둔다.
 */
export function useProjectAi(
  project: ProjectLike | undefined,
  patch: ((id: string, body: { defaults: ProjectDefaults }) => Promise<unknown>) | undefined,
): ProjectAiSource | undefined {
  const [, bump] = useState(0);
  const local = useRef(new Map<string, AiChoice>());
  return useMemo(() => {
    if (!project || !patch) return undefined;
    return {
      get: () => {
        const mine = local.current.get(project.id);
        if (mine) return mine;
        const e = project.defaults?.engine;
        return e
          ? { engine: e, ...(project.defaults?.model ? { model: project.defaults.model } : {}) }
          : undefined;
      },
      set: async (c: AiChoice) => {
        const defaults: ProjectDefaults = { ...(project.defaults ?? {}), engine: c.engine };
        if (c.model) defaults.model = c.model;
        else delete defaults.model;
        await patch(project.id, { defaults });
        local.current.set(project.id, c);
        bump((n) => n + 1);
      },
    };
  }, [project, patch]);
}
