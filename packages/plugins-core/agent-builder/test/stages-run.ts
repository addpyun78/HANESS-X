import type { ChecklistItemInput, RunMode, StageTree } from '@harness-x/checklist-ledger';
import type { EngineRunOptions, Pipeline, PipelineNode } from '@harness-x/protocol';
import { PipelineRunner, StageTracker, type GateVerifier, type StageTrackerOptions } from '../src/index.js';
import {
  completeItems,
  fakeEngine,
  items,
  tmpWorkspace,
  type FakeCall,
  type FakeTurn,
} from './runner-helpers.js';

export const FIXED_NOW = () => new Date('2026-11-12T00:00:00.000Z');

/** role·gate 노드마다 틀 항목 2개 — 실행기 원장과 단계 트리 틀이 같은 id */
export const templates = (n: PipelineNode): ChecklistItemInput[] | undefined =>
  n.type === 'role' ? items(n.id, 2) : undefined;

/** 노드 출력 JSON 블록 */
export const json = (v: unknown) => '```json\n' + JSON.stringify(v) + '\n```';

export interface StageRunInput {
  pipeline: Pipeline;
  /** 노드 id → 턴마다 낼 출력 (k = 그 노드의 호출 번호) */
  outputs?: (node: string, k: number) => unknown;
  /** 엔진 id들 (노드 engine과 맞춘다, 기본 fake) */
  engines?: string[];
  mode?: RunMode;
  verify?: GateVerifier;
  resolveAgent?: (name: string) => Pipeline | undefined;
  tracker?: Partial<StageTrackerOptions>;
  /** 노드 체크리스트 (기본: role 노드마다 2개) */
  withChecklists?: boolean;
  /** 각 노드 턴 직후 트리 스냅샷 */
  onTurn?: (node: string, tree: StageTree) => void;
}

export async function runWithStages(i: StageRunInput) {
  const ws = tmpWorkspace();
  const calls: FakeCall[] = [];
  const counts = new Map<string, number>();
  const tracker = new StageTracker({
    sessionId: 'run-1',
    agent: { name: i.pipeline.name, pipeline: i.pipeline },
    ...(i.withChecklists === false ? {} : { templates }),
    ...(i.mode ? { mode: i.mode } : {}),
    ...(i.resolveAgent ? { resolveAgent: i.resolveAgent } : {}),
    now: FIXED_NOW,
    ...i.tracker,
  });
  const script = (o: EngineRunOptions): FakeTurn => {
    const node = o.env?.HARNESS_X_NODE ?? '?';
    const k = counts.get(node) ?? 0;
    counts.set(node, k + 1);
    const out = i.outputs?.(node, k) ?? { summary: '맡은 일을 마쳤어요.' };
    return {
      text: json(out),
      effect: (opts) => {
        completeItems(opts);
        i.onTurn?.(node, tracker.tree);
      },
    };
  };
  const engines = Object.fromEntries(
    (i.engines ?? ['fake']).map((id) => [id, fakeEngine(id, script, calls)]),
  );
  tracker.start();
  const runner = new PipelineRunner({
    engines,
    workspace: ws.dir,
    sessionId: 'run-1',
    ...(i.withChecklists === false ? {} : { checklists: (n: PipelineNode) => templates(n) }),
    ...(i.verify ? { verify: i.verify } : {}),
    ...(i.resolveAgent ? { resolveAgent: i.resolveAgent } : {}),
    stages: tracker.hooks(),
  });
  try {
    const r = await runner.run(i.pipeline, '화면을 고쳐 주세요');
    return { r, tracker, tree: tracker.tree, calls };
  } finally {
    ws.cleanup();
  }
}

/** 트리 요약: 단계 id → 상태 (깊이 우선) */
export function statuses(t: StageTree): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (l: StageTree['stages']) => {
    for (const s of l) {
      out[s.stageId] = s.status;
      walk(s.children);
    }
  };
  walk(t.stages);
  return out;
}
