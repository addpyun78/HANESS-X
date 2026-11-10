import { ApprovalRequestEventSchema, HarnessEventSchema } from '@harness-x/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import {
  APPROVAL_BUTTONS,
  ApprovalNotFoundError,
  Escalator,
  LadderApprovalDetailSchema,
  LadderApprovalRequestEventSchema,
} from '../src/escalate.js';
import { CASE, mockEngines } from './escalate-fixtures.js';
import { tempDir } from './helpers.js';

function sink() {
  const events: Record<string, unknown>[] = [];
  return { events, log: { append: (e: unknown) => events.push(e as Record<string, unknown>) } };
}

let n = 0;
const fixed = {
  now: () => new Date('2026-11-10T00:00:00.000Z'),
  idGen: () => `id-${++n}`,
};

describe('27.2 그래도 불확실하면 approval_request (예상 경로/실제 경로/근거/버튼 3개)', () => {
  let t = tempDir('hx-escalate-');
  afterEach(() => {
    t.cleanup();
    t = tempDir('hx-escalate-');
    n = 0;
  });

  it('다른 엔진도 불확실 → 승인 카드 이벤트 (스키마)', async () => {
    const { events, log } = sink();
    const engines = mockEngines(['claude-code', 'codex'], (k) =>
      k === 'noul' ? '{"noul":0.75,"confidence":0.6}' : '{"choice":"relocated-ok","confidence":0.6}',
    );
    const esc = new Escalator({ dir: t.dir, sessionId: 's1', log, engines: engines.factory, ...fixed });
    const out = await esc.escalate(CASE);
    expect(out.status).toBe('pending');
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    // 공통 이벤트 스키마·approval_request 스키마·L5 카드 스키마 모두 통과
    expect(HarnessEventSchema.parse(ev).type).toBe('approval_request');
    ApprovalRequestEventSchema.parse(ev);
    const card = LadderApprovalRequestEventSchema.parse(ev);
    expect(card).toMatchObject({
      type: 'approval_request',
      kind: 'ladder.l5',
      sessionId: 's1',
      itemId: '1',
      options: ['equivalent', 'move', 'fail'],
      detail: {
        itemId: '1',
        artifactId: 'art.mobile-app',
        expectedPath: 'harness/mobile',
        actualPath: 'ai/mobile',
        engine: { engineId: 'codex', decision: 'escalate' },
      },
    });
    expect(card.detail.reason).toContain('L4 불확실');
    expect(card.detail.reason).toContain('codex');
    expect(card.detail.buttons).toEqual([
      { id: 'equivalent', label: '동치 인정' },
      { id: 'move', label: '이동 승인' },
      { id: 'fail', label: '실패' },
    ]);
    expect(out.status === 'pending' && out.approvalId).toBe(card.approvalId);
    expect(esc.approvals.get(card.approvalId)).toMatchObject({ status: 'pending', case: CASE });
    expect(esc.approvals.pending()).toHaveLength(1);
  });

  it('엔진 없음 → 바로 승인 카드, 확신 있는 다른 엔진 → 카드 없이 결정', async () => {
    const a = sink();
    const out = await new Escalator({ dir: t.dir, sessionId: 's', log: a.log, ...fixed }).escalate(CASE);
    expect(out.status).toBe('pending');
    expect(LadderApprovalRequestEventSchema.parse(a.events[0]).detail.engine).toBeUndefined();

    const b = sink();
    const sure = mockEngines(['codex'], (k) =>
      k === 'noul' ? '{"noul":0.97,"confidence":0.9}' : '{"choice":"relocated-ok","confidence":0.9}',
    );
    const decided = await new Escalator({
      dir: t.dir,
      sessionId: 's',
      log: b.log,
      engines: sure.factory,
      ...fixed,
    }).escalate(CASE);
    expect(decided).toMatchObject({ status: 'decided', by: 'engine', engineId: 'codex', decision: 'move' });
    expect(b.events).toHaveLength(0);
  });

  it('카드 스키마: 버튼 3개(순서 고정)·필수 필드', () => {
    const detail = {
      itemId: '1',
      artifactId: 'art.x',
      expectedPath: 'a',
      actualPath: 'b',
      reason: 'r',
      buttons: APPROVAL_BUTTONS.map((b) => ({ ...b })),
    };
    expect(LadderApprovalDetailSchema.parse(detail)).toEqual(detail);
    expect(() =>
      LadderApprovalDetailSchema.parse({ ...detail, buttons: detail.buttons.slice(0, 2) }),
    ).toThrow();
    expect(() =>
      LadderApprovalDetailSchema.parse({ ...detail, buttons: [...detail.buttons].reverse() }),
    ).toThrow();
    const { actualPath: _a, ...noActual } = detail;
    expect(() => LadderApprovalDetailSchema.parse(noActual)).toThrow();
    expect(() => new Escalator({ dir: t.dir, sessionId: 's' }).approvals.get('nope')).toThrow(
      ApprovalNotFoundError,
    );
  });
});
