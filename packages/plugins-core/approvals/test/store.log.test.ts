import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screenText } from '../src/card.js';
import { createApprovalStore, APPROVALS_LOG_FILE } from '../src/store.js';
import { buildCard } from '../src/templates.js';
import { NOW, PATH_INPUT, tempDir } from './helpers.js';

describe('H.24 approvals.jsonl — 결정 1건 = 기록 1건', () => {
  let t: ReturnType<typeof tempDir>;
  beforeEach(() => (t = tempDir()));
  afterEach(() => t.cleanup());

  it('(시각, 카드 id, 선택, remember, 화면 문구 원문)', () => {
    const store = createApprovalStore({ dir: t.dir, sessionId: 's1', remindDelaysMs: [], now: () => NOW });
    const a = store.add(buildCard(PATH_INPUT)).card;
    const b = store.add(buildCard({ ...PATH_INPUT, id: 'card-path-2', itemId: '4' })).card;
    store.resolve(a.id, 'accept', { remember: true });
    const lines = () => readFileSync(`${t.dir}/${APPROVALS_LOG_FILE}`, 'utf8').trim().split('\n');
    expect(lines()).toHaveLength(1);
    expect(JSON.parse(lines()[0]!)).toEqual({
      type: 'decision',
      ts: NOW.toISOString(),
      cardId: 'card-path-1',
      itemId: '3.2.2',
      kind: 'path',
      choice: 'accept',
      choiceLabel: '같은 걸로 인정',
      remember: true,
      by: 'human',
      text: screenText(a),
    });
    expect(JSON.parse(lines()[0]!).text).toContain('무슨 일이 있었나요? 계획에는 "하네스/모바일" 폴더에');
    store.resolve(b.id, 'stop');
    expect(lines()).toHaveLength(2);
    expect(JSON.parse(lines()[1]!)).toMatchObject({ cardId: 'card-path-2', choice: 'stop', remember: false });
    // 이미 처리된 카드는 다시 결정할 수 없고 기록도 늘지 않는다
    expect(() => store.resolve(b.id, 'accept')).toThrow(/이미 처리된/);
    expect(() => store.resolve(store.add(buildCard({ ...PATH_INPUT, id: 'x' })).card.id, 'register')).toThrow(
      /선택지가 아닙니다/,
    );
    expect(lines()).toHaveLength(2);
  });
});
