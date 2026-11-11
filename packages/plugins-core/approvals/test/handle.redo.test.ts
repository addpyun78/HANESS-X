import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { checklistStatus } from '@harness-x/checklist-ledger';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLedgerHandler, REDO_EVIDENCE } from '../src/handlers.js';
import { createApprovalStore } from '../src/store.js';
import { buildCard } from '../src/templates.js';
import { PATH_INPUT, sessionFixture, tempDir } from './helpers.js';

/**
 * 녹화된 엔진 턴 리플레이: 엔진은 받은 지시문에서 "정식 경로:" 줄을 읽어 그 자리에 파일을 만든다.
 * (지시문에 정식 경로가 없으면 지난번처럼 ai/mobile에 만든다)
 */
function replayEngineTurn(workspace: string, instruction: string): string {
  const m = /정식 경로: (\S+)/.exec(instruction);
  const target = m ? m[1]! : 'ai/mobile';
  const file = join(workspace, target, 'README.md');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, '# mobile\n');
  return target;
}

describe('H.19 "원래 자리로 다시 만들기" → 항목 doing, 다음 턴 지시문에 쉬운 말 사유 + 정식 경로', () => {
  let t: ReturnType<typeof tempDir>;
  beforeEach(() => (t = tempDir()));
  afterEach(() => t.cleanup());

  it('리플레이로 정식 경로에 다시 만든다', () => {
    const { ledger, manifest } = sessionFixture(t.dir);
    const store = createApprovalStore({
      dir: t.dir,
      sessionId: 's1',
      remindDelaysMs: [],
      handler: createLedgerHandler({ ledger, manifest }),
    });
    const card = store.add(
      buildCard({ ...PATH_INPUT, itemId: '1', expected: 'harness/mobile', actual: 'ai/mobile' }),
    ).card;
    const r = store.resolve(card.id, 'redo');
    expect(ledger.item('1').status).toBe('doing');
    expect(ledger.item('1').attempts).toBe(2);
    expect(ledger.item('1').evidence.at(-1)).toMatchObject({ kind: REDO_EVIDENCE, choice: 'redo' });
    expect(r.outcome.instruction).toBe(
      '사용자가 "ai/mobile"에 만든 것은 계획과 다르다고 했어요. 정식 경로에 다시 만들어 주세요.\n정식 경로: harness/mobile',
    );

    // 다음 턴 지시문(종료 차단·재주입 프롬프트)에 들어간다
    const st = checklistStatus(ledger);
    expect(st.next?.id).toBe('1');
    expect(st.next?.instruction.startsWith(r.outcome.instruction as string)).toBe(true);
    expect(st.next?.instruction).toContain('다음 항목 1: 모바일 앱 폴더');

    const ws = join(t.dir, 'ws');
    const made = replayEngineTurn(ws, st.next!.instruction);
    expect(made).toBe('harness/mobile');
    expect(existsSync(join(ws, 'harness/mobile/README.md'))).toBe(true);
    expect(existsSync(join(ws, 'ai/mobile'))).toBe(false);
  });

  it('텍스트 차이는 "나와야 하는 값"을 알려 준다', () => {
    const { ledger, manifest } = sessionFixture(t.dir);
    const store = createApprovalStore({
      dir: t.dir,
      remindDelaysMs: [],
      handler: createLedgerHandler({ ledger, manifest }),
    });
    const card = store.add(
      buildCard({ kind: 'text', itemId: '1', expected: '로그인 성공', actual: '오류', id: 'c-text' }),
    ).card;
    const r = store.resolve(card.id, 'redo');
    expect(r.outcome.instruction).toContain('나와야 하는 값: 로그인 성공');
  });
});
