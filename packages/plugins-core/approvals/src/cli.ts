import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { parseArgs } from 'node:util';
import { CHOICE_LABELS, type ApprovalCard } from './card.js';
import { openSessionApprovals, sessionsWithCards } from './session.js';

/**
 * `harness-x approvals` (T-100 H.17) — 패널 없이도 같은 카드를 글로 보여 주고 숫자로 고른다.
 *   harness-x approvals [--workspace <폴더>] [--session <id>]          목록 + 번호 입력
 *   harness-x approvals [--workspace …] <카드 번호> <선택 번호> [자동]   바로 결정
 * "자동"(또는 r)을 붙이면 "다음부터 같은 경우는 자동으로 처리"를 켠다.
 */

export interface ApprovalsCliIo {
  input: Readable;
  output: Writable;
  /** 기본 process.cwd() */
  cwd?: string;
}

interface Entry {
  sessionId: string;
  card: ApprovalCard;
}

const HELP = `사용법: harness-x approvals [--workspace <폴더>] [--session <id>] [카드 번호 선택 번호 [자동]]
`;

/** 카드 한 장을 글로 */
export function formatCardText(card: ApprovalCard, n: number): string {
  const lines = [
    `[${n}] ✋ ${card.title} (항목 ${card.itemId})`,
    `  무슨 일이 있었나요? ${card.whatHappened}`,
    `  왜 제가 정하지 못했나요? ${card.whyAsking}`,
    `  (확신 정도: ${card.confidenceWord})`,
  ];
  if (card.recommendation)
    lines.push(`  AI 추천: ${CHOICE_LABELS[card.recommendation]} — 이유: ${card.recommendationReason}`);
  lines.push(`  선택: ${card.options.map((o, i) => `${i + 1}) ${o.label}`).join('   ')}`);
  return lines.join('\n');
}

function ask(io: ApprovalsCliIo, q: string): Promise<string> {
  const rl = createInterface({ input: io.input, terminal: false });
  io.output.write(q);
  return new Promise((res) => {
    let done = false;
    const finish = (v: string) => {
      if (done) return;
      done = true;
      rl.close();
      res(v);
    };
    rl.once('line', (l) => finish(l));
    rl.once('close', () => finish(''));
  });
}

export async function approvalsCli(argv: string[], io: ApprovalsCliIo): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      workspace: { type: 'string' },
      session: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    io.output.write(HELP);
    return 0;
  }
  const workspace = resolve(io.cwd ?? process.cwd(), values.workspace ?? '.');
  const opened = new Map<string, ReturnType<typeof openSessionApprovals>>();
  const open = (s: string) => {
    let o = opened.get(s);
    if (!o) opened.set(s, (o = openSessionApprovals(workspace, s, { remindDelaysMs: [] })));
    return o;
  };
  const entries: Entry[] = (values.session ? [values.session] : sessionsWithCards(workspace)).flatMap((s) =>
    open(s)
      .store.pending()
      .map((card) => ({ sessionId: s, card })),
  );
  if (entries.length === 0) {
    io.output.write('확인이 필요한 카드가 없어요.\n');
    return 0;
  }
  entries.forEach((e, i) => io.output.write(formatCardText(e.card, i + 1) + '\n\n'));

  const answer =
    positionals.length >= 2
      ? positionals.join(' ')
      : await ask(io, '카드 번호와 선택 번호를 띄어서 입력해 주세요 (예: 1 1): ');
  const [cardNo, choiceNo, flag] = answer.trim().split(/\s+/);
  if (!cardNo) {
    io.output.write('\n아무것도 고르지 않았어요.\n');
    return 0;
  }
  const entry = entries[Number(cardNo) - 1];
  const option = entry?.card.options[Number(choiceNo) - 1];
  if (!entry || !option) {
    io.output.write(`\n번호를 다시 확인해 주세요. (입력: ${answer.trim()})\n`);
    return 1;
  }
  const remember = flag === '자동' || flag === 'r';
  const r = open(entry.sessionId).store.resolve(entry.card.id, option.id, { remember, by: 'cli' });
  io.output.write(
    `\n${entry.card.itemId} 항목에 "${option.label}" 선택을 반영했어요.` +
      (typeof r.outcome.message === 'string' ? ` ${r.outcome.message}` : '') +
      '\n',
  );
  return 0;
}
