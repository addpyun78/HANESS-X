import { join } from 'node:path';
import { ReviewList } from '@harness-x/kernel';
import { afterEach, describe, expect, it } from 'vitest';
import { AUTO_DENIED_EVIDENCE, autoPolicy, createAutoApprover } from '../src/index.js';
import { gateFixture, item, type GateFixture } from './helpers.js';

// T-101 3D.2 오토 권한 요청 자동 처리: 범위 안 자동 허용, 범위 밖 자동 거부 + 확인 목록 + 항목 blocked + 독립 항목 계속

let f: GateFixture | undefined;
afterEach(() => f?.cleanup());

describe('3D.2 범위 밖 요청', () => {
  it('정책 판단: 워크스페이스 밖만 거부', () => {
    expect(autoPolicy({ reason: '워크스페이스 밖' })).toBe('deny');
    expect(autoPolicy({ reason: 'manifest에 없는 경로' })).toBe('allow');
  });

  it('범위 안은 묻지 않고 허용, 범위 밖은 거부 + 확인 목록 + blocked, 독립 항목은 계속', async () => {
    const review = new ReviewList();
    // approve는 fixture 생성 후 ledger가 있어야 하므로 늦게 묶는다
    let approve: ReturnType<typeof createAutoApprover> = () => false;
    f = gateFixture({ approve: (a) => approve(a) });
    approve = createAutoApprover({ sessionId: 's1', review, ledger: f.ledger });
    f.ledger.create([
      item('1', { artifactId: 'art.mobile-app' }),
      item('2', { artifactId: 'art.readme' }),
      item('3', { artifactId: 'art.notes', deps: [] }),
    ]);
    const r = f.manifest.lock(
      [
        { artifactId: 'art.mobile-app', displayName: '하네스/모바일', kind: 'dir' },
        { artifactId: 'art.readme', displayName: 'docs/README.md', kind: 'file', path: 'docs/readme.md' },
        { artifactId: 'art.notes', displayName: 'notes.md', kind: 'file', path: 'notes.md' },
      ],
      { glossary: (await import('@harness-x/checklist-ledger')).loadDefaultGlossary() },
    );
    expect(r.status).toBe('locked');
    f.ledger.transition('1', 'doing');

    // 범위 안 (워크스페이스 안, 산출물 목록 밖) → 자동 허용, 확인 목록 없음
    expect((await f.tool('Write', { file_path: 'scratch/tmp.txt' }, { itemId: '1' })).decision).toBe('allow');
    expect(review.open()).toHaveLength(0);

    // 범위 밖 → 자동 거부
    const outside = join(f.ws, '..', 'elsewhere', 'x.txt');
    const out = await f.tool('Write', { file_path: outside }, { itemId: '1' });
    expect(out.decision).toBe('deny');
    expect(out.reason).toContain('사용자가 거부');
    const list = review.open('s1');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'permission', itemId: '1', actions: ['allow', 'deny'] });
    expect(list[0]!.reason).toContain('작업 폴더 밖');

    const c = f.ledger.get();
    const it1 = c.items.find((i) => i.id === '1')!;
    expect(it1.status).toBe('blocked');
    expect(it1.evidence.some((e) => e.kind === AUTO_DENIED_EVIDENCE)).toBe(true);
    // 독립 항목은 계속 진행 가능
    expect(f.ledger.currentItem()?.id).toBe('2');
  });
});
