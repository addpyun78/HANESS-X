import { AgentNameSchema, commandForName } from '@harness-x/protocol';
import type { SaveAgentRequest } from '../../api/client.js';
import type { BuilderGraph } from '../graph.js';
import { graphToPipeline } from './yaml.js';

/**
 * 46.3 저장: ~/.harness-x/agents/<이름>/agent.yaml + pipeline.yaml (PUT /api/agents/:name)
 * 이름을 쓰면 슬래시 명령(/이름)을 자동 제안한다. 사용자가 명령을 직접 고치면 그 값을 유지한다.
 */

export interface AgentMeta {
  /** 에이전트 이름 (소문자 kebab-case) */
  name: string;
  displayName: string;
  description?: string;
  icon?: string;
  /** /명령 (비우면 /이름) */
  command?: string;
  defaultEngine?: string;
  /** 파이프라인 시작 노드 (YAML에서 지정한 경우) */
  entry?: string;
}

/** 아무 글자 → 에이전트 이름 후보 (소문자 kebab-case, 영문자로 시작) */
export function toAgentName(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .replace(/-+$/g, '');
  return s || 'my-agent';
}

export const suggestCommand = (name: string) => commandForName(toAgentName(name));

export function validateAgentName(name: string): string | undefined {
  const r = AgentNameSchema.safeParse(name);
  return r.success ? undefined : (r.error.issues[0]?.message ?? '잘못된 이름');
}

export function buildSaveRequest(g: BuilderGraph, meta: AgentMeta, overwrite = false): SaveAgentRequest {
  const command = meta.command?.trim() || commandForName(meta.name);
  return {
    agent: {
      name: meta.name,
      displayName: meta.displayName.trim() || meta.name,
      ...(meta.description ? { description: meta.description } : {}),
      ...(meta.icon ? { icon: meta.icon } : {}),
      command,
      ...(meta.defaultEngine && meta.defaultEngine !== 'auto' ? { defaultEngine: meta.defaultEngine } : {}),
      pipeline: './pipeline.yaml',
    },
    pipeline: graphToPipeline(g, {
      name: meta.name,
      ...(meta.displayName ? { displayName: meta.displayName } : {}),
      ...(meta.entry ? { entry: meta.entry } : {}),
    }),
    ...(overwrite ? { overwrite: true } : {}),
  };
}

/** YAML 탭에서 바꾼 파이프라인 이름·표시 이름·entry를 에이전트 메타에 반영 (이름이 바뀌면 /명령도 다시 제안) */
export function mergePipelineMeta(
  cur: AgentMeta,
  m: { name: string; displayName?: string; entry?: string },
): AgentMeta {
  const next: AgentMeta = {
    name: m.name,
    displayName: m.displayName ?? cur.displayName,
    command: m.name !== cur.name ? suggestCommand(m.name) : (cur.command ?? suggestCommand(m.name)),
  };
  if (cur.description) next.description = cur.description;
  if (cur.icon) next.icon = cur.icon;
  if (cur.defaultEngine) next.defaultEngine = cur.defaultEngine;
  if (m.entry) next.entry = m.entry;
  return next;
}
