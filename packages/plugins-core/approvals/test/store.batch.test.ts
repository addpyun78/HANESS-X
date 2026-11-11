import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkPlainKorean } from '../src/plain-korean.js';
import { BATCH_MESSAGE, createApprovalStore } from '../src/store.js';
import { buildCard } from '../src/templates.js';
import { PATH_INPUT, tempDir } from './helpers.js';

describe('H.25 같은 종류 카드 5장 이상 → 묶음 제안', () => {
  let t: ReturnType<typeof tempDir>;
  beforeEach(() => (t = tempDir()));
  afterEach(() => t.cleanup());

  it('5장째에 "비슷한 확인이 반복돼요 — 한 번에 정할까요?"', () => {
    expect(BATCH_MESSAGE).toBe('비슷한 확인이 반복돼요 — 한 번에 정할까요?');
    expect(checkPlainKorean(BATCH_MESSAGE).ok).toBe(true);
    const store = createApprovalStore({ dir: t.dir, remindDelaysMs: [] });
    // 다른 종류는 세지 않는다
    store.add(buildCard({ ...PATH_INPUT, kind: 'text', id: 'other' }));
    for (let n = 1; n <= 4; n++)
      expect(store.add(buildCard({ ...PATH_INPUT, id: `p${n}` })).batch).toBeUndefined();
    const fifth = store.add(buildCard({ ...PATH_INPUT, id: 'p5' }));
    expect(fifth.batch).toEqual({
      kind: 'path',
      count: 5,
      cardIds: ['p1', 'p2', 'p3', 'p4', 'p5'],
      message: BATCH_MESSAGE,
    });
    expect(store.batchSuggestions().map((b) => b.kind)).toEqual(['path']);

    // 한 번에 정하기 → 같은 종류 5장만 처리, 기록 5건
    const res = store.resolveBatch('path', 'stop');
    expect(res).toHaveLength(5);
    expect(store.pending().map((c) => c.id)).toEqual(['other']);
    expect(store.records()).toHaveLength(5);
    expect(store.batchSuggestions()).toEqual([]);
  });
});
