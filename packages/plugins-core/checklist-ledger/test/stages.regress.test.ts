import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ChecklistLedger,
  buildSlice,
  buildSkeleton,
  currentItemOf,
  getStage,
  lintChecklist,
  parseChecklist,
  stageChecklist,
} from '../src/index.js';
import { FIXED_NOW, THREE, item, templates } from './stages-helpers.js';

let dir: string | undefined;
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

/**
 * 4F.1 원자성 린터·비교기·판정 사다리·승인 카드는 하위 항목 단위로 그대로 적용.
 * 단계의 하위 항목은 기존 항목 스키마 그대로라서, stageChecklist()로 기존 함수에 그대로 넘긴다.
 * (기존 checklist-ledger 테스트 전체가 함께 통과하는 것이 회귀 검증)
 */
describe('4F.1 하위 항목 단위로 기존 기능 그대로', () => {
  const t = buildSkeleton({
    sessionId: 's',
    agent: { name: 'three', pipeline: THREE },
    templates,
    now: FIXED_NOW,
  });
  const s = getStage(t, 'build');

  it('단계 하위 항목 → 기존 체크리스트 문서 (스키마 통과)', () => {
    const c = stageChecklist(s, FIXED_NOW);
    expect(parseChecklist(c).items).toEqual(s.items);
  });

  it('원자성 린터 결과가 평평한 목록과 같다', () => {
    const bad = [...s.items, { ...s.items[0]!, id: 'x', title: '로그인 만들고 홈도 고치기' }];
    expect(lintChecklist(bad)).toEqual(lintChecklist(stageChecklist({ ...s, items: bad }).items));
    expect(lintChecklist(bad).violations.map((v) => v.itemId)).toEqual(['x']);
  });

  it('현재 항목·슬라이스 본문이 기존 함수 그대로', () => {
    const c = stageChecklist(s);
    expect(currentItemOf(c)?.id).toBe('build1');
    expect(buildSlice({ checklist: c }).itemId).toBe('build1');
  });

  it('단계 하위 항목을 그대로 원장에 넣어 판정(전이·증거)을 돌릴 수 있다', () => {
    dir = mkdtempSync(join(tmpdir(), 'hx-stage-reg-'));
    const ledger = new ChecklistLedger({ dir, sessionId: 's', now: FIXED_NOW });
    ledger.create(s.items.map((i) => item(i.id, { title: i.title })));
    ledger.transition('build1', 'doing');
    ledger.transition('build1', 'verifying', { evidence: { kind: 'test', summary: 'ok' } });
    ledger.transition('build1', 'done');
    expect(ledger.get().items.map((i) => i.status)).toEqual(['done', 'todo']);
  });
});
