import { describe, expect, it } from 'vitest';
import { CHOICE_LABELS, DIFFERENCE_KINDS } from '../src/card.js';
import { buildCard } from '../src/templates.js';
import { PATH_INPUT } from './helpers.js';

describe('H.4 선택지 문구 고정 (대응표)', () => {
  it('선택지 id ↔ 문구', () => {
    expect(CHOICE_LABELS).toMatchObject({
      accept: '같은 걸로 인정',
      redo: '원래 자리로 다시 만들기',
      stop: '잘 모르겠어요 — 안전하게 멈추기',
      'allow-move': '이 위치로 옮긴 걸 허락',
    });
  });

  it.each(DIFFERENCE_KINDS)('%s 카드의 버튼 (경로만 "이 위치로 옮긴 걸 허락" 추가)', (kind) => {
    const c = buildCard({ ...PATH_INPUT, kind });
    const labels = c.options.map((o) => o.label);
    expect(labels.slice(0, 3)).toEqual([
      '같은 걸로 인정',
      '원래 자리로 다시 만들기',
      '잘 모르겠어요 — 안전하게 멈추기',
    ]);
    expect(labels.includes('이 위치로 옮긴 걸 허락')).toBe(kind === 'path');
  });
});
