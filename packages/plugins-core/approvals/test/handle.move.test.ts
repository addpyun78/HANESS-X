import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLedgerHandler } from '../src/handlers.js';
import { createApprovalStore } from '../src/store.js';
import { buildCard } from '../src/templates.js';
import { PATH_INPUT, sessionFixture, tempDir } from './helpers.js';

describe('H.21 "이 위치로 옮긴 걸 허락" → manifest·참조 항목 일괄 갱신 (T-027 재사용)', () => {
  let t: ReturnType<typeof tempDir>;
  beforeEach(() => (t = tempDir()));
  afterEach(() => t.cleanup());

  it('참조 갱신', () => {
    const { ledger, manifest } = sessionFixture(t.dir);
    expect(manifest.read()?.artifacts['art.mobile-app']?.path).toBe('harness/mobile');
    const store = createApprovalStore({
      dir: t.dir,
      sessionId: 's1',
      remindDelaysMs: [],
      handler: createLedgerHandler({ ledger, manifest }),
    });
    const card = store.add(
      buildCard({ ...PATH_INPUT, itemId: '1', expected: 'harness/mobile', actual: 'ai/mobile' }),
    ).card;
    const r = store.resolve(card.id, 'allow-move');

    const m = manifest.read()!;
    expect(m.artifacts['art.mobile-app']?.path).toBe('ai/mobile');
    expect(m.artifacts['art.mobile-login']?.path).toBe('ai/mobile/login.kt');
    expect(m.artifacts['art.web']?.path).toBe('harness/web');
    // 옛 경로를 쓰던 항목 2의 acceptance도 새 경로로
    expect(ledger.item('2').acceptance).toEqual([
      { type: 'test', run: 'pnpm test ai/mobile/login', expectExit: 0 },
    ]);
    expect(r.outcome.moved).toMatchObject({
      moved: [
        { artifactId: 'art.mobile-app', from: 'harness/mobile', to: 'ai/mobile' },
        { artifactId: 'art.mobile-login', from: 'harness/mobile/login.kt', to: 'ai/mobile/login.kt' },
      ],
      updatedItems: ['1', '2'],
    });
    expect(ledger.item('1').status).toBe('done');
    expect(ledger.item('1').verdict).toMatchObject({ level: 5, verdict: 'relocated' });
    expect(ledger.item('1').evidence.at(-1)).toMatchObject({ level: 'human', choice: 'allow-move' });
  });
});
