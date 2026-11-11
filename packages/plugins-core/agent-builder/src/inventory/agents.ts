import type { Pipeline } from '@harness-x/protocol';
import { loadPluginPipeline, type RegisteredAgent } from '../registry.js';
import { pipelineHealth, worstHealth } from './health.js';
import type { InventoryPluginSource } from './plugins.js';
import type { AgentAsset, AssetHealth, NodeSummary, PipelineAsset } from './schema.js';

/**
 * P4-A.6 기존 에이전트·파이프라인 수집: 이름·명령·노드 요약(역할명, 엔진, 스킬 id).
 * 에이전트 목록은 GET /api/agents와 같은 AgentRegistry에서 온다. 노드 지시문(prompt)·스키마 본문은 넣지 않는다.
 */

export function summarizeNodes(p: Pipeline): NodeSummary[] {
  return p.nodes.map((n) => {
    const r = n as { label?: string; engine?: string; skills?: string[]; tools?: string[] };
    return {
      id: n.id,
      type: n.type,
      ...(r.label ? { label: r.label } : {}),
      ...(r.engine ? { engine: r.engine } : {}),
      skills: [...(r.skills ?? [])],
      tools: [...(r.tools ?? [])],
    };
  });
}

export function collectAgents(
  agents: readonly RegisteredAgent[],
  engines: ReadonlyMap<string, AssetHealth> = new Map(),
): AgentAsset[] {
  return agents.map((a) => {
    const nodes = summarizeNodes(a.pipeline);
    const def = a.agent.defaultEngine;
    return {
      name: a.name,
      command: a.command,
      displayName: a.agent.displayName,
      ...(a.agent.description ? { description: a.agent.description } : {}),
      source: a.source,
      ...(a.pluginId ? { pluginId: a.pluginId } : {}),
      defaultEngine: def,
      nodes,
      health: worstHealth(
        pipelineHealth(nodes, engines),
        def && def !== 'auto' && engines.size > 0 ? (engines.get(def) ?? 'disabled') : 'ready',
      ),
    };
  });
}

/** 플러그인이 제공하는 파이프라인 (provides.pipeline) — 읽기 실패한 것은 건너뛴다 */
export function collectPipelines(
  plugins: Iterable<InventoryPluginSource>,
  engines: ReadonlyMap<string, AssetHealth> = new Map(),
): PipelineAsset[] {
  const out: PipelineAsset[] = [];
  for (const p of plugins) {
    for (const name of p.manifest.provides.pipeline ?? []) {
      let pipeline: Pipeline;
      try {
        pipeline = loadPluginPipeline(p, name);
      } catch {
        continue;
      }
      const nodes = summarizeNodes(pipeline);
      out.push({
        id: `${p.manifest.id}/${name}`,
        name,
        pluginId: p.manifest.id,
        nodes,
        health: worstHealth(
          !p.state || p.state === 'active' ? 'ready' : 'disabled',
          pipelineHealth(nodes, engines),
        ),
      });
    }
  }
  return out;
}
