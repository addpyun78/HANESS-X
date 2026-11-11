import { checklistStatus } from '@harness-x/checklist-ledger';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkPlainKorean } from '../src/plain-korean.js';
import { createLedgerHandler, STOP_MESSAGE } from '../src/handlers.js';
import { createApprovalStore } from '../src/store.js';
import { buildCard } from '../src/templates.js';
import { PATH_INPUT, sessionFixture, tempDir } from './helpers.js';

describe('H.20 "잘 모르겠어요" → 그 항목만 blocked, 의존 항목 대기, 독립 항목 계속', () => {
  let t: ReturnType<typeof tempDir>;
  beforeEach(() => (t = tempDir()));
  afterEach(() => t.cleanup());

  it('독립 항목 진행', () => {
    const { ledger, manifest } = sessionFixture(t.dir);
    const store = createApprovalStore({
      dir: t.dir,
      sessionId: 's1',
      remindDelaysMs: [],
      handler: createLedgerHandler({ ledger, manifest }),
    });
    const card = store.add(buildCard({ ...PATH_INPUT, itemId: '1' })).card;
    const r = store.resolve(card.id, 'stop');
    expect(r.outcome).toEqual({ message: STOP_MESSAGE, status: 'blocked', waiting: ['2'], next: '3' });
    expect(STOP_MESSAGE).toBe('이 부분은 멈춰 두고 나머지를 먼저 진행할게요.');
    expect(checkPlainKorean(STOP_MESSAGE).ok).toBe(true);

    expect(ledger.item('1').status).toBe('blocked');
    expect(ledger.item('2').status).toBe('todo'); // 의존 항목은 그대로 대기
    // 다음 지시는 독립 항목 3
    expect(checklistStatus(ledger).next?.id).toBe('3');
    ledger.transition('3', 'doing');
    ledger.transition('3', 'verifying');
    ledger.transition('3', 'done');
    // 3이 끝나도 2는 1을 기다린다 (지시 대상 아님)
    expect(ledger.currentItem()).toBeNull();
    expect(ledger.item('2').status).toBe('todo');
  });
});
