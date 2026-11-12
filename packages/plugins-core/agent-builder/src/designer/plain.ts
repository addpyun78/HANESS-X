import { checkPlainKorean, isPlainKorean, plainTermReplace } from '@harness-x/approvals';
import type { AgentDraft, DraftQuestion } from '@harness-x/protocol';

/**
 * 쉬운 말(Part 1 H.6) 검사 — 설계 AI가 쓴 글이 사용자에게 보이기 전에 통과해야 한다.
 * 1) 용어 치환(H.7) 뒤 검사 2) 그래도 안 되면 재요청 오류 목록에 넣고 3) 마지막에는 안전한 기본 문장으로 바꾼다.
 */

/** 대표 구현 isPlainKorean(approvals)을 그대로 쓴다(T-102 C5-001). 바깥 이름은 그대로 둠 */
export const isPlain = isPlainKorean;

/** 치환해서 통과하면 그 글, 아니면 undefined */
export function toPlain(text: string, label = false): string | undefined {
  if (isPlain(text, label)) return text;
  const r = plainTermReplace(text);
  return isPlain(r, label) ? r : undefined;
}

export interface PlainIssue {
  path: string;
  text: string;
  problems: string[];
}

/** 초안에서 쉬운 말이 아닌 글 목록 (치환 뒤에도 안 되는 것만) */
export function draftPlainIssues(d: AgentDraft): PlainIssue[] {
  const out: PlainIssue[] = [];
  const check = (path: string, text: string, label = false) => {
    if (toPlain(text, label) !== undefined) return;
    const problems = checkPlainKorean(plainTermReplace(text), { label }).violations.map((v) => v.detail);
    out.push({ path, text, problems });
  };
  check('summary', d.summary);
  check('estimatedCostHint', d.estimatedCostHint);
  d.nodes.forEach((n, i) => check(`nodes[${i}].reason`, n.reason));
  d.gaps.forEach((g, i) => check(`gaps[${i}].need`, g.need, true));
  return out;
}

export const FALLBACK_REASON = '이 일에 맞는 담당이라 이렇게 정했어요.';
export const FALLBACK_NEED = '필요한 기능이 아직 목록에 없어요.';
export const FALLBACK_COST = '걸리는 시간과 비용은 시험 실행으로 알 수 있어요.';

export function fallbackSummary(d: Pick<AgentDraft, 'nodes'>): string {
  return [
    `이 에이전트는 ${d.nodes.length}단계로 일을 나눠서 해요.`,
    '각 단계는 맡은 AI가 차례로 처리해요.',
    '자세한 내용은 캔버스에서 볼 수 있어요.',
  ].join('\n');
}

/** 치환으로 고칠 수 있으면 고치고, 안 되면 기본 문장으로 바꾼다 (사용자에게 어려운 글이 나가지 않게) */
export function enforcePlainDraft(d: AgentDraft): AgentDraft {
  const lines = d.summary
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => toPlain(l))
    .filter((l): l is string => l !== undefined);
  return {
    ...d,
    summary: lines.length >= 3 ? lines.slice(0, 5).join('\n') : fallbackSummary(d),
    estimatedCostHint: toPlain(d.estimatedCostHint) ?? FALLBACK_COST,
    nodes: d.nodes.map((n) => ({ ...n, reason: toPlain(n.reason) ?? FALLBACK_REASON })),
    gaps: d.gaps.map((g) => ({ ...g, need: toPlain(g.need, true) ?? FALLBACK_NEED })),
  };
}

/** 질문: 글은 존댓말 문장, 선택지는 버튼 글(label). 고칠 수 없으면 그 질문/선택지를 뺀다 */
export function enforcePlainQuestions(qs: readonly DraftQuestion[]): DraftQuestion[] {
  const out: DraftQuestion[] = [];
  for (const q of qs) {
    const text = toPlain(q.text);
    const choices = q.choices.map((c) => toPlain(c, true)).filter((c): c is string => c !== undefined);
    if (text && choices.length >= 2) out.push({ ...q, text, choices });
  }
  return out;
}
