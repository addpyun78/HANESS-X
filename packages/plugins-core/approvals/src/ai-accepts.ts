import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ApprovalCard, DifferenceKind } from './card.js';
import { dictionaryMatch, pairKey, type DictionaryFiles } from './dictionary.js';
import { buildProposalCard } from './templates.js';

/**
 * T-100 F.4 — 같은 쌍이 AI 판단으로 3회 인정되면 사전 등록을 "카드로 제안"한다.
 * 자동 등록은 하지 않는다: 사람이 제안 카드에서 "네, 사전에 넣어 주세요"를 눌러야 저장된다.
 */

export const AI_ACCEPTS_FILE = 'ai-accepts.json';
export const PROPOSE_AFTER = 3;

interface Entry {
  kind: string;
  expected: string;
  actual: string;
  count: number;
  proposed: boolean;
}

export interface AiAcceptInput {
  kind: DifferenceKind;
  expected: string;
  actual: string;
  itemId: string;
  sessionId?: string;
  judgeEngine?: string;
}

export interface AiAcceptResult {
  count: number;
  /** 이번에 처음 제안하게 되면 제안 카드 */
  proposal?: ApprovalCard;
}

export interface AiAcceptTrackerOptions {
  /** ai-accepts.json 위치 */
  file: string;
  /** 이미 사전에 있으면 제안하지 않는다 */
  dictionary?: DictionaryFiles;
  threshold?: number;
  now?: () => Date;
  idGen?: () => string;
}

export function createAiAcceptTracker(opts: AiAcceptTrackerOptions) {
  const threshold = opts.threshold ?? PROPOSE_AFTER;
  const read = (): Record<string, Entry> =>
    existsSync(opts.file) ? (JSON.parse(readFileSync(opts.file, 'utf8')) as Record<string, Entry>) : {};
  const write = (all: Record<string, Entry>) => {
    mkdirSync(dirname(opts.file), { recursive: true });
    writeFileSync(opts.file, JSON.stringify(all, null, 2) + '\n');
  };
  return {
    /** AI 판단으로 같은 걸로 인정된 쌍 1건 기록 */
    record(input: AiAcceptInput): AiAcceptResult {
      const all = read();
      const key = pairKey(input.kind, input.expected, input.actual);
      const e = all[key] ?? {
        kind: input.kind,
        expected: input.expected,
        actual: input.actual,
        count: 0,
        proposed: false,
      };
      e.count += 1;
      let proposal: ApprovalCard | undefined;
      if (
        e.count >= threshold &&
        !e.proposed &&
        !(opts.dictionary && dictionaryMatch(opts.dictionary, input))
      ) {
        e.proposed = true;
        proposal = buildProposalCard({
          itemId: input.itemId,
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          pairKind: input.kind,
          expected: input.expected,
          actual: input.actual,
          count: e.count,
          ...(input.judgeEngine ? { judgeEngine: input.judgeEngine } : {}),
          ...(opts.idGen ? { id: opts.idGen() } : {}),
          ...(opts.now ? { now: opts.now() } : {}),
        });
      }
      all[key] = e;
      write(all);
      return { count: e.count, ...(proposal ? { proposal } : {}) };
    },
    count(kind: string, expected: string, actual: string): number {
      return read()[pairKey(kind, expected, actual)]?.count ?? 0;
    },
  };
}
export type AiAcceptTracker = ReturnType<typeof createAiAcceptTracker>;
