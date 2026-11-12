import { describe, expect, it, vi } from 'vitest';
import {
  AUTO_REDO_MAX,
  autoResolveCard,
  buildCard,
  checkPlainKorean,
  createAutoCardHandler,
  DIFFERENCE_KINDS,
  type ApprovalCard,
} from '../src/index.js';
import { PATH_INPUT } from './helpers.js';

// T-101 3D.3 오토 판정 카드 자동 처리: redo만 자동(최대 2회), 그래도 안 맞으면 blocked + 확인 목록, accept 자동 0건

const cards: ApprovalCard[] = DIFFERENCE_KINDS.map((kind, i) =>
  buildCard({ ...PATH_INPUT, kind, id: `c-${kind}`, itemId: `i${i}` }),
);

describe('3D.3 자동 인정 0건', () => {
  it('redo가 있는 카드는 redo, 2회 뒤엔 blocked', () => {
    const path = cards[0]!;
    expect(path.options.map((o) => o.id)).toContain('accept');
    expect(path.recommendation).toBe('accept'); // 추천이 인정이어도
    expect(autoResolveCard(path, 0)).toEqual({ action: 'choose', choice: 'redo', attempt: 1 });
    expect(autoResolveCard(path, 1)).toEqual({ action: 'choose', choice: 'redo', attempt: 2 });
    expect(autoResolveCard(path, AUTO_REDO_MAX)).toMatchObject({ action: 'block' });
  });

  it('모든 종류 카드를 여러 번 받아도 같은 걸로 인정을 고른 횟수 0', async () => {
    const choose = vi.fn();
    const block = vi.fn();
    const handle = createAutoCardHandler({ choose, block });
    for (let round = 0; round < 5; round++) for (const c of cards) await handle(c);
    const chosen = choose.mock.calls.map((c) => c[1]);
    expect(chosen.filter((x) => x === 'accept')).toHaveLength(0);
    expect(chosen.every((x) => x === 'redo')).toBe(true);
    // 항목마다 redo 최대 2회
    const perItem = new Map<string, number>();
    for (const [card] of choose.mock.calls) perItem.set(card.itemId, (perItem.get(card.itemId) ?? 0) + 1);
    for (const n of perItem.values()) expect(n).toBeLessThanOrEqual(AUTO_REDO_MAX);
    // 나머지는 전부 blocked + 쉬운 말 이유
    expect(block).toHaveBeenCalled();
    for (const [, reason] of block.mock.calls) expect(checkPlainKorean(reason).ok, reason).toBe(true);
  });
});
