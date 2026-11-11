import { checkPlainKorean } from '@harness-x/approvals';
import { nextInstruction } from '@harness-x/checklist-ledger';
import { afterEach, describe, expect, it } from 'vitest';
import {
  continueWithoutTool,
  isPurchaseWaiting,
  markPurchaseWaiting,
  PURCHASE_WAITING_SUMMARY,
  SKIPPED_SUMMARY,
  TOOL_SKIPPED,
  TOOL_UNAVAILABLE,
  UNAVAILABLE_TEMPLATE,
  waitForTool,
} from '../src/index.js';
import { cand, ledgerWith, NOW, tempHome } from './helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});
function ledger() {
  const t = tempHome();
  cleanups.push(t.cleanup);
  const l = ledgerWith(t.dir, [
    ['1', '폴더 만들기'],
    ['2', '동영상에서 소리 뽑기'],
    ['3', '소리 파일 정리', ['2']],
    ['4', '설명서 쓰기'],
  ]);
  l.transition('2', 'doing');
  return l;
}
const need = { capability: '동영상에서 소리 뽑기' };

describe('P3-C.6 [설치 없이 계속] → "도구 없이 진행" 기록 + AI 대체 지시, 불가능하면 blocked(쉬운 말)', () => {
  it('가능: 기다리던 항목이 doing으로, 다음 턴 지시문 앞에 대체 방법 지시', () => {
    const l = ledger();
    waitForTool(l, '2', need);
    expect(l.item('2').status).toBe('blocked');
    const r = continueWithoutTool(l, '2', need, { possible: true, alternative: '브라우저 변환 사이트 안내' });
    expect(r.status).toBe('doing');
    const it2 = l.item('2');
    expect(it2.status).toBe('doing');
    expect(it2.evidence.at(-1)).toMatchObject({ kind: TOOL_SKIPPED, summary: SKIPPED_SUMMARY });
    const instr = nextInstruction(it2, 3);
    expect(instr.startsWith('도구 없이 진행')).toBe(true);
    expect(instr).toContain('다른 방법');
  });

  it('불가능: 항목 blocked + 쉬운 말 이유 (어려운 말이면 템플릿)', () => {
    const l = ledger();
    const r = continueWithoutTool(l, '2', need, {
      possible: false,
      reason: '소리를 뽑으려면 꼭 프로그램이 있어야 해요.',
    });
    expect(r).toEqual({ status: 'blocked', reason: '소리를 뽑으려면 꼭 프로그램이 있어야 해요.' });
    expect(l.item('2').status).toBe('blocked');
    expect(l.item('2').evidence.at(-1)).toMatchObject({ kind: TOOL_UNAVAILABLE });
    const l2 = ledger();
    const r2 = continueWithoutTool(l2, '2', need, {
      possible: false,
      reason: 'ffmpeg binary not in PATH, codec API missing',
    });
    expect(r2).toEqual({ status: 'blocked', reason: UNAVAILABLE_TEMPLATE });
    expect(checkPlainKorean(UNAVAILABLE_TEMPLATE).ok).toBe(true);
  });
});

describe('P3-D.2 유료 선택 후 구매 필요 → "구매 대기", 다른 독립 항목은 계속', () => {
  it('구매 대기 항목은 멈추고, 의존 없는 항목이 다음으로 진행된다 (의존 항목은 대기)', () => {
    const l = ledger();
    l.transition('1', 'doing');
    l.transition('1', 'verifying');
    l.transition('1', 'done');
    const adobe = cand({
      name: 'Adobe Media Encoder',
      packageRepo: false,
      officialUrl: 'https://www.adobe.com',
      pricingPage: {
        url: 'https://www.adobe.com/pricing',
        tier: 'paid',
        note: '돈을 내야 쓸 수 있어요.',
        checkedAt: NOW.toISOString(),
      },
    });
    const next = markPurchaseWaiting(l, '2', adobe);
    const it2 = l.item('2');
    expect(it2.status).toBe('blocked');
    expect(isPurchaseWaiting(it2)).toBe(true);
    expect(it2.evidence.at(-1)).toMatchObject({
      summary: PURCHASE_WAITING_SUMMARY,
      tool: 'Adobe Media Encoder',
    });
    // 3은 2에 의존 → 건너뛰고 독립 항목 4가 다음
    expect(next?.id).toBe('4');
    l.transition('4', 'doing');
    l.transition('4', 'verifying');
    l.transition('4', 'done');
    expect(l.item('4').status).toBe('done');
    expect(l.item('3').status).toBe('todo');
    expect(l.item('2').status).toBe('blocked');
  });

  it('원장 resume은 blocked에서만 (일반 전이로는 blocked에서 못 나온다)', () => {
    const l = ledger();
    expect(() => l.resume('2')).toThrow(/doing → doing/);
    l.transition('2', 'blocked');
    expect(() => l.transition('2', 'doing')).toThrow();
    expect(l.resume('2').items.find((i) => i.id === '2')!.status).toBe('doing');
  });
});
