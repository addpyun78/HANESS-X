import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StageTreeStore, allStages, buildSkeleton, renderStageTreeMarkdown } from '../src/index.js';
import { FIXED_NOW, THREE, item, templates } from './stages-helpers.js';

let dir: string | undefined;
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

/** 스냅샷용 요약 (단계 id·상태·항목 id·출처) */
const shape = (t: ReturnType<typeof buildSkeleton>) =>
  allStages(t).map((s) => ({
    stageId: s.stageId,
    kind: s.kind,
    status: s.status,
    items: s.items.map((i) => `${i.id}:${s.itemMeta[i.id]?.origin}`),
  }));

describe('4B.1 실행 시작 순간의 단계 뼈대', () => {
  it('3단계 에이전트를 시작하면 3단계 뼈대 + 틀 항목이 모두 "예상"', () => {
    const t = buildSkeleton({
      sessionId: 's',
      agent: { name: 'three', pipeline: THREE },
      templates,
      now: FIXED_NOW,
    });
    expect(t.agent).toBe('three');
    expect(shape(t)).toMatchSnapshot();
    expect(t.stages.every((s) => s.status === 'expected')).toBe(true);
    expect(renderStageTreeMarkdown(t)).toMatchSnapshot();
  });

  it('에이전트가 없으면 단계 1개("작업")', () => {
    const t = buildSkeleton({ sessionId: 's', items: [item('1')], now: FIXED_NOW });
    expect(shape(t)).toEqual([{ stageId: 'task', kind: 'task', status: 'expected', items: ['1:ledger'] }]);
  });

  it('실행 전(에이전트를 고르기 전·지시를 보내기 전)에는 트리를 만들지 않는다 — start()만 만든다', () => {
    dir = mkdtempSync(join(tmpdir(), 'hx-skel-'));
    const store = new StageTreeStore({ dir, sessionId: 's', now: FIXED_NOW });
    expect(store.load()).toBeNull();
    expect(store.read()).toBeNull();
    const t = store.start({ agent: { name: 'three', pipeline: THREE }, templates });
    expect(t.stages.map((s) => s.stageId)).toEqual(['plan', 'build', 'test']);
    expect(store.read()).toEqual(t);
  });

  it('단계는 에이전트 파일에 적힌 노드만 (AI가 단계를 나누는 입력이 없다)', () => {
    const t = buildSkeleton({ sessionId: 's', agent: { name: 'three', pipeline: THREE }, now: FIXED_NOW });
    expect(t.stages.map((s) => s.nodeId)).toEqual(THREE.nodes.map((n) => n.id));
  });
});
