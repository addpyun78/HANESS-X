/**
 * P3-A.5 필요 도구 판단 AI 선택: `assist.engine` → (빈 값·못 씀) `judge.engine` → 세션 엔진.
 * 판정기(@harness-x/judge selectJudge)와 같은 방식: 감지·로그인된 엔진만, 도구 없는 읽기 전용 짧은 세션으로 묻는다.
 * 실제 호출은 주입한 ask(engineId, 질문)로 한다 (예: judge의 createEngineJudge와 같은 CLI 플래그 — 도구 사용 금지).
 */

export interface AssistEngineInfo {
  id: string;
  detected: boolean;
  loggedIn: boolean;
}

export interface AssistSelectInput {
  assistEngine?: string;
  judgeEngine?: string;
  /** 지금 세션을 돌리는 엔진 */
  sessionEngine?: string;
}

export type AssistSelection =
  { engineId: string; from: 'assist' | 'judge' | 'session' } | { engineId: null; from: 'none' };

const ALIASES: Record<string, string> = { claude: 'claude-code', agy: 'antigravity' };
const norm = (id: string | undefined) => {
  const t = (id ?? '').trim().toLowerCase();
  return ALIASES[t] ?? t;
};

export function selectAssistEngine(
  input: AssistSelectInput,
  engines: readonly AssistEngineInfo[],
): AssistSelection {
  const usable = (id: string) => engines.some((e) => norm(e.id) === id && e.detected && e.loggedIn);
  const order: ['assist' | 'judge' | 'session', string | undefined][] = [
    ['assist', input.assistEngine],
    ['judge', input.judgeEngine],
    ['session', input.sessionEngine],
  ];
  for (const [from, raw] of order) {
    const id = norm(raw);
    if (id && usable(id)) return { engineId: id, from };
  }
  return { engineId: null, from: 'none' };
}

/** 선택된 엔진에게 한 번 묻기 (도구 없는 읽기 전용 세션). 실패하면 undefined */
export type AssistAsk = (
  engineId: string,
  question: { system: string; user: string },
) => Promise<string | undefined>;

export const NEED_QUESTION_SYSTEM =
  '너는 작업 항목을 보고 필요한 프로그램 능력을 판단한다. 도구를 쓰지 말고 JSON 한 줄만 답한다. ' +
  '형식: {"needsTool": true|false, "capability": "쉬운 한국어 능력 설명(30자 이내)", "why": "한 문장"}. ' +
  '코드·파일 내용·비밀은 절대 넣지 않는다.';

export interface InferredNeed {
  capability: string;
  why: string;
}

/** 항목 제목·설명(코드 아님)만 보내서 필요한 능력을 묻는다 */
export async function inferNeed(
  ask: AssistAsk,
  engineId: string,
  item: { title: string; description?: string },
): Promise<InferredNeed | undefined> {
  const user = `항목: ${item.title}${item.description ? `\n설명: ${item.description.slice(0, 300)}` : ''}`;
  const text = await ask(engineId, { system: NEED_QUESTION_SYSTEM, user }).catch(() => undefined);
  if (!text) return undefined;
  try {
    const m = /\{[\s\S]*\}/.exec(text);
    const j = JSON.parse(m ? m[0] : text) as { needsTool?: unknown; capability?: unknown; why?: unknown };
    if (j.needsTool !== true || typeof j.capability !== 'string' || !j.capability.trim()) return undefined;
    return { capability: j.capability.trim().slice(0, 80), why: typeof j.why === 'string' ? j.why : '' };
  } catch {
    return undefined;
  }
}
