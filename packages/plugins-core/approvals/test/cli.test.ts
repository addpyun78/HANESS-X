import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { ChecklistLedger } from '@harness-x/checklist-ledger';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { approvalsCli } from '../src/cli.js';
import { openSessionApprovals } from '../src/session.js';
import { buildCard } from '../src/templates.js';
import { PATH_INPUT, tempDir } from './helpers.js';

function io(input: string) {
  const inp = new PassThrough();
  const out = new PassThrough();
  let text = '';
  out.on('data', (d) => (text += String(d)));
  inp.end(input);
  return { input: inp, output: out, text: () => text };
}

describe('H.17 harness-x approvals — 카드를 글로 보여 주고 숫자로 승인', () => {
  let t: ReturnType<typeof tempDir>;
  beforeEach(() => {
    t = tempDir();
    const dir = join(t.dir, '.harness-x', 'sessions', 's1');
    mkdirSync(dir, { recursive: true });
    const ledger = new ChecklistLedger({ dir, sessionId: 's1' });
    ledger.create([
      {
        id: '1',
        title: '모바일 앱 폴더',
        artifactId: 'art.mobile-app',
        acceptance: [{ type: 'file_exists' }],
      },
      { id: '2', title: '웹 셸', artifactId: 'art.web', acceptance: [{ type: 'file_exists' }] },
    ]);
    const { store } = openSessionApprovals(t.dir, 's1', { remindDelaysMs: [] });
    store.add(buildCard({ ...PATH_INPUT, itemId: '1', id: 'cli-1' }));
    store.add(
      buildCard({ kind: 'text', itemId: '2', expected: '로그인 성공', actual: '로그인 됨', id: 'cli-2' }),
    );
  });
  afterEach(() => t.cleanup());

  it('CLI 승인 1회: 목록 → "1 1" 입력 → 같은 걸로 인정 반영', async () => {
    const s = io('1 1\n');
    const code = await approvalsCli(['--workspace', t.dir], s);
    expect(code).toBe(0);
    const out = s.text();
    expect(out).toContain('[1] ✋ 확인이 필요해요 (항목 1)');
    expect(out).toContain(
      '무슨 일이 있었나요? 계획에는 "하네스/모바일" 폴더에 만들기로 했어요. 그런데 AI가 "ai/mobile" 폴더에 만들었어요.',
    );
    expect(out).toContain('(확신 정도: 중간)');
    expect(out).toContain('AI 추천: 같은 걸로 인정 — 이유: 안에 든 파일과 테스트 결과가 같아요.');
    expect(out).toContain(
      '선택: 1) 같은 걸로 인정   2) 원래 자리로 다시 만들기   3) 잘 모르겠어요 — 안전하게 멈추기   4) 이 위치로 옮긴 걸 허락',
    );
    expect(out).toContain('[2] ✋ 확인이 필요해요 (항목 2)');
    expect(out).toContain(
      '1 항목에 "같은 걸로 인정" 선택을 반영했어요. 같은 걸로 인정하고 다음으로 넘어갈게요.',
    );

    const { store, ledger } = openSessionApprovals(t.dir, 's1', { remindDelaysMs: [] });
    expect(ledger?.item('1').status).toBe('done');
    expect(store.get('cli-1')).toMatchObject({ status: 'resolved', choice: 'accept', by: 'cli' });
    expect(store.records()).toHaveLength(1);

    // 남은 카드는 1장, 번호를 인자로 바로 고르기 (3 = 잘 모르겠어요)
    const s2 = io('');
    expect(await approvalsCli(['--workspace', t.dir, '1', '3'], s2)).toBe(0);
    expect(s2.text()).toContain('이 부분은 멈춰 두고 나머지를 먼저 진행할게요.');
    expect(ledger?.item('2').status).toBe('blocked');

    const s3 = io('');
    await approvalsCli(['--workspace', t.dir], s3);
    expect(s3.text()).toBe('확인이 필요한 카드가 없어요.\n');
  });

  it('잘못된 번호면 아무것도 바꾸지 않는다', async () => {
    const s = io('9 1\n');
    expect(await approvalsCli(['--workspace', t.dir], s)).toBe(1);
    expect(s.text()).toContain('번호를 다시 확인해 주세요.');
    const { store } = openSessionApprovals(t.dir, 's1', { remindDelaysMs: [] });
    expect(store.pending()).toHaveLength(2);
  });
});
