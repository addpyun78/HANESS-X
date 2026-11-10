import { afterEach, describe, expect, it } from 'vitest';
import { PATH_CORRECTED_KIND } from '../src/index.js';
import { gateFixture, type GateFixture } from './helpers.js';

// 24.6 교정 내역을 evidence에 기록 — 항목 evidence에 path_corrected
describe('24.6 path_corrected evidence', () => {
  let f: GateFixture;
  afterEach(() => f.cleanup());

  it('같은 산출물 항목(진행 중 우선)에 path_corrected 증거 + checklist_change 이벤트', async () => {
    f = gateFixture();
    f.lockPlan();
    f.ledger.transition('1', 'doing');
    const r = await f.tool('Write', { file_path: '하네스/모바일/a.kt', content: '' }, { callId: 'call-7' });
    expect(r.decision).toBe('deny');
    const ev = f.ledger.item('1').evidence.filter((e) => e.kind === PATH_CORRECTED_KIND);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      kind: 'path_corrected',
      from: '하네스/모바일/a.kt',
      to: 'harness/mobile/a.kt',
      artifactId: 'art.mobile-app',
      tool: 'Write',
      level: 2,
      callId: 'call-7',
      summary: '하네스/모바일/a.kt → harness/mobile/a.kt',
    });
    expect(ev[0]!.ts).toBeTruthy();
    expect(f.ledger.item('1').status).toBe('doing'); // 상태는 바뀌지 않는다
    expect(f.ledger.item('2').evidence).toHaveLength(0);
  });

  it('ctx.itemId가 있으면 그 항목에 기록', async () => {
    f = gateFixture();
    f.lockPlan();
    await f.tool('Bash', { command: 'touch 모바일/x.kt' }, { itemId: '2' });
    // 모바일/x.kt 는 harness/mobile 과 매칭되지 않음 → 교정 아님
    expect(f.ledger.item('2').evidence).toHaveLength(0);
    await f.tool('Bash', { command: 'touch 하네스/모바일/x.kt' }, { itemId: '2' });
    expect(f.ledger.item('2').evidence.map((e) => e.kind)).toEqual(['path_corrected']);
  });
});
