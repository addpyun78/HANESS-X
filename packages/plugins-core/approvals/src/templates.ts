import { randomUUID } from 'node:crypto';
import {
  CARD_TITLE,
  option,
  parseApprovalCard,
  type ApprovalCard,
  type ChoiceId,
  type DifferenceKind,
} from './card.js';
import { confidenceWord } from './confidence.js';
import { checkPlainKorean } from './plain-korean.js';

/**
 * 차이 종류 5종 한국어 템플릿 (T-100 H.2). AI가 문장을 만들지 않고 정해진 틀에 값만 끼운다.
 * 값은 큰따옴표로 감싸고 길면 줄인다 (원문은 technical에).
 */

export interface CardInput {
  kind: DifferenceKind;
  itemId: string;
  sessionId?: string;
  expected: string;
  actual: string;
  /** 비교 방법 종류 (없으면 kind) */
  comparator?: string;
  confidence?: number;
  judgeEngine?: string;
  /** AI 추천 선택지 */
  recommendation?: ChoiceId;
  /** AI의 plain_reason (H.5 — 쉬운 말 검사 통과 시에만 화면에) */
  plainReason?: string;
  id?: string;
  now?: Date;
}

const MAX_VALUE = 24;

/** 화면용 짧은 값: 첫 줄만, 길면 … */
export function shortValue(v: string, max = MAX_VALUE): string {
  const line = (v.split(/\r?\n/)[0] ?? '').trim().replace(/"/g, "'");
  const chars = [...line];
  const s = chars.length > max ? chars.slice(0, max - 1).join('') + '…' : line;
  return s.length ? s : '(빈 값)';
}

/** 받침: 0 없음, 1 있음(ㄹ 아님), 2 ㄹ — 숫자는 읽는 소리로 (일·삼·육·칠·팔·십 등) */
function finalOf(word: string): 0 | 1 | 2 {
  const ch = word.replace(/[\s.,!?…'")\]]+$/u, '').slice(-1);
  if (/\d/.test(ch)) return '013678'.includes(ch) ? ('178'.includes(ch) ? 2 : 1) : 0;
  const c = ch.charCodeAt(0);
  if (!(c >= 0xac00 && c <= 0xd7a3)) return 0;
  const jong = (c - 0xac00) % 28;
  return jong === 0 ? 0 : jong === 8 ? 2 : 1;
}
/** 을/를 */
const objParticle = (w: string) => (finalOf(w) ? '을' : '를');
/** 이라는/라는 */
const iraneun = (w: string) => (finalOf(w) ? '이라는' : '라는');
/** 으로/로 (ㄹ 받침은 로) */
const euro = (w: string) => (finalOf(w) === 1 ? '으로' : '로');
/** 과/와 */
const gwa = (w: string) => (finalOf(w) ? '과' : '와');
/** 이었는데/였는데 */
const ieonneunde = (w: string) => (finalOf(w) ? '이었는데' : '였는데');

function pathThing(p: string): string {
  const last = p.split(/[/\\]/).filter(Boolean).pop() ?? p;
  return /\.[A-Za-z0-9]{1,6}$/.test(last) ? '파일' : '폴더';
}

function texts(input: CardInput): { whatHappened: string; whyAsking: string } {
  const e = shortValue(input.expected);
  const a = shortValue(input.actual);
  switch (input.kind) {
    case 'path': {
      const thing = pathThing(input.expected);
      return {
        whatHappened: `계획에는 "${e}" ${thing}에 만들기로 했어요. 그런데 AI가 "${a}" ${thing}에 만들었어요.`,
        whyAsking: `두 이름이 같은 ${thing}${objParticle(thing)} 뜻하는지 확실하지 않아요.`,
      };
    }
    case 'text':
      return {
        whatHappened: `계획에는 "${e}"${iraneun(e)} 글이 나와야 했어요. 실제로는 "${a}"${iraneun(a)} 글이 나왔어요.`,
        whyAsking: '두 표현이 같은 뜻인지 확실하지 않아요.',
      };
    case 'number':
      return {
        whatHappened: `계획에는 "${e}"${iraneun(e)} 숫자가 나와야 했어요. 실제로는 "${a}"${iraneun(a)} 숫자가 나왔어요.`,
        whyAsking: '두 숫자가 같은 값을 뜻하는지 확실하지 않아요.',
      };
    case 'no-judge':
      return {
        whatHappened: `계획에는 "${e}"${ieonneunde(e)}, 실제로는 "${a}"${euro(a)} 나왔어요.`,
        whyAsking: '이 차이를 대신 판단해 줄 AI를 찾지 못했어요.',
      };
    case 'limit-exceeded':
      return {
        whatHappened: `계획에는 "${e}"${ieonneunde(e)}, 실제로는 "${a}"${euro(a)} 나왔어요.`,
        whyAsking: '이번 작업에서 AI에게 물어볼 수 있는 횟수를 다 썼어요.',
      };
  }
}

/** 선택지: 공통 3개 + 경로 차이면 "이 위치로 옮긴 걸 허락" */
export function optionsFor(kind: DifferenceKind): ChoiceId[] {
  return kind === 'path' ? ['accept', 'redo', 'stop', 'allow-move'] : ['accept', 'redo', 'stop'];
}

export function differenceText(expected: string, actual: string): string {
  return `- ${expected}\n+ ${actual}`;
}

/** H.2 템플릿으로 카드 만들기. H.5: 추천 이유가 쉬운 말 검사를 통과하지 못하면 추천을 뺀다 */
export function buildCard(input: CardInput): ApprovalCard {
  const t = texts(input);
  const choices = optionsFor(input.kind);
  const reasonOk =
    input.plainReason !== undefined && input.plainReason.trim() !== ''
      ? checkPlainKorean(input.plainReason).ok
      : false;
  const recommend =
    input.recommendation && reasonOk && choices.includes(input.recommendation)
      ? { recommendation: input.recommendation, recommendationReason: input.plainReason!.trim() }
      : {};
  return parseApprovalCard({
    id: input.id ?? randomUUID(),
    itemId: input.itemId,
    kind: input.kind,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    title: CARD_TITLE,
    whatHappened: t.whatHappened,
    whyAsking: t.whyAsking,
    confidenceWord: confidenceWord(input.confidence),
    ...recommend,
    options: choices.map(option),
    rememberable: true,
    technical: {
      itemId: input.itemId,
      expected: input.expected,
      actual: input.actual,
      difference: differenceText(input.expected, input.actual),
      comparator: input.comparator ?? input.kind,
      ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
      ...(input.judgeEngine ? { judgeEngine: input.judgeEngine } : {}),
      ...(input.plainReason && !reasonOk ? { rawReason: input.plainReason } : {}),
    },
    createdAt: (input.now ?? new Date()).toISOString(),
  });
}

export interface ProposalInput {
  itemId: string;
  sessionId?: string;
  /** 사전에 넣을 쌍의 종류 */
  pairKind: DifferenceKind;
  expected: string;
  actual: string;
  /** AI가 같은 걸로 인정한 횟수 */
  count: number;
  judgeEngine?: string;
  id?: string;
  now?: Date;
}

const COUNT_WORD = ['', '한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열'];

/** F.4 사전 등록 제안 카드 (자동 등록 금지 — 사람이 "네"를 눌러야 등록) */
export function buildProposalCard(input: ProposalInput): ApprovalCard {
  const e = shortValue(input.expected);
  const a = shortValue(input.actual);
  const times = COUNT_WORD[input.count] ? `${COUNT_WORD[input.count]} 번` : `${input.count}번`;
  return parseApprovalCard({
    id: input.id ?? randomUUID(),
    itemId: input.itemId,
    kind: 'dictionary-proposal',
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    title: CARD_TITLE,
    whatHappened: `AI가 "${e}"${gwa(e)} "${a}"${objParticle(a)} ${times} 같은 걸로 인정했어요.`,
    whyAsking: '다음부터 묻지 않도록 사전에 넣을지 정해 주세요.',
    confidenceWord: confidenceWord(undefined),
    options: [option('register'), option('skip')],
    rememberable: false,
    technical: {
      itemId: input.itemId,
      expected: input.expected,
      actual: input.actual,
      difference: differenceText(input.expected, input.actual),
      comparator: input.pairKind,
      ...(input.judgeEngine ? { judgeEngine: input.judgeEngine } : {}),
    },
    createdAt: (input.now ?? new Date()).toISOString(),
  });
}
