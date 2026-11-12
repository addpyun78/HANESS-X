import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readStageTree, stageProgressLabels, stageRecap, stageTreeResolver } from '@harness-x/kernel';
import { afterEach, describe, expect, it } from 'vitest';
import { StageTreeStore, buildSkeleton, stageProgress, type StageTree } from '../src/index.js';
import { FIXED_NOW, THREE, item, templates } from './stages-helpers.js';
import { pictureTree } from './stages-sample.js';

let dir: string | undefined;
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

/** 커널은 checklist-ledger에 의존할 수 없어 stages.json을 직접 읽는다 — 진행률 규칙이 같은지 */
describe('4F.6·4F.8 커널 단계 진행 읽기 = checklist-ledger stageProgress', () => {
  const trees: [string, StageTree][] = [
    ['설계 그림(2/3 진행 중)', pictureTree()],
    [
      '3단계 뼈대(실행 직후)',
      buildSkeleton({ sessionId: 's', agent: { name: 'three', pipeline: THREE }, templates, now: FIXED_NOW }),
    ],
    ['단계 1개', buildSkeleton({ sessionId: 's', items: [item('1')], now: FIXED_NOW })],
  ];
  it.each(trees)('%s', (_n, t) => {
    const p = stageProgress(t);
    expect(stageProgressLabels(t)).toEqual({ short: p.short, resume: p.resumeLabel });
  });

  it('stages.json 파일에서 읽기 (세션 id → 파일)', () => {
    dir = mkdtempSync(join(tmpdir(), 'hx-parity-'));
    const sdir = join(dir, '.harness-x', 'sessions', 's1');
    new StageTreeStore({ dir: sdir, sessionId: 's1' }).write(pictureTree());
    const t = stageTreeResolver(dir)('s1')!;
    expect(stageProgressLabels(t).short).toBe('단계 2/3');
    expect(stageRecap(t)).toEqual([{ id: 'plan', title: 'plan: 화면 3개를 고치기로 했어요' }]);
    expect(stageTreeResolver(dir)('..')).toBeNull();
    expect(readStageTree(join(sdir, 'nope.json'))).toBeNull();
  });
});
