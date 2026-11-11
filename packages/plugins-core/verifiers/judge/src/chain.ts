import { SessionCallBudget } from './budget.js';
import { JudgeCache, judgeCacheKey } from './cache.js';
import { aggregateAnswers, clampSamples, JUDGE_TIMEOUT_MS, sampleAnswers } from './confidence.js';
import { buildJudgePrompt } from './questions.js';
import { sanitizeJudgeInput } from './sanitize.js';
import { selectJudge, type JudgeSelectDeps, type JudgeSelection } from './select.js';
import { parseJudgeSettings, type JudgeSettings, type JudgeSettingsInput } from './settings.js';
import type { JudgeOutcome, JudgeRequest } from './types.js';

/**
 * 의미 판단 AI 체인 (T-100 P1-E)
 *   semantic off → 즉시 different
 *   캐시(E.12) → 세션 상한(E.13) → 판정기 선택(E.2) → 표본 n회 병렬(E.10) → 임계값(E.11)
 * judge()는 예외를 던지지 않는다. 판정할 수 없으면 verdict 'unavailable' (= 승인 카드로).
 */

export interface JudgeChainDeps extends JudgeSelectDeps {
  cache?: JudgeCache;
  budget?: SessionCallBudget;
  /** 판정 1건 시간 상한 (기본 60초) */
  timeoutMs?: number;
}

export interface JudgeChain {
  readonly settings: JudgeSettings;
  readonly cache: JudgeCache;
  readonly budget: SessionCallBudget;
  judge(req: JudgeRequest): Promise<JudgeOutcome>;
  /** 지금 판정한다면 어느 판정기를 쓸지 (호출 없음) */
  select(authorEngineId?: string): Promise<JudgeSelection>;
}

export function createJudgeChain(
  settingsInput: JudgeSettingsInput | JudgeSettings | { judge: JudgeSettingsInput } = {},
  deps: JudgeChainDeps,
): JudgeChain {
  const settings = parseJudgeSettings(settingsInput);
  const cache = deps.cache ?? new JudgeCache();
  const budget = deps.budget ?? new SessionCallBudget(settings.maxCallsPerSession);
  const samples = clampSamples(settings.samples);

  async function judgeUnsafe(req: JudgeRequest): Promise<JudgeOutcome> {
    if (settings.semantic === 'off') {
      return { verdict: 'different', confidence: 0, reason: 'semantic-off' };
    }

    const key = judgeCacheKey(req.kind, req.expected, req.actual);
    const hit = cache.get(key);
    if (hit) return hit;

    if (budget.remaining(req.sessionId) < samples) {
      return { verdict: 'unavailable', confidence: 0, reason: 'limit' };
    }

    const sel = await selectJudge(settings, deps, req.authorEngineId);
    if (sel.step === 4) return { verdict: 'unavailable', confidence: 0, reason: sel.reason };

    if (!budget.tryReserve(req.sessionId, samples)) {
      return { verdict: 'unavailable', confidence: 0, reason: 'limit' };
    }
    const prompt = buildJudgePrompt(sanitizeJudgeInput(req));
    const base = { engineId: sel.engineId, sameEngineJudge: sel.sameEngineJudge };
    const r = await sampleAnswers(sel.backend, prompt, samples, {
      timeoutMs: deps.timeoutMs ?? JUDGE_TIMEOUT_MS,
    });
    if (!r.ok) return { verdict: 'unavailable', confidence: 0, ...base, reason: r.reason };

    const agg = aggregateAnswers(r.answers);
    const outcome: JudgeOutcome = {
      verdict: agg.verdict,
      confidence: agg.confidence,
      ...base,
      samples: r.answers.length,
      ...(agg.differenceKind ? { differenceKind: agg.differenceKind } : {}),
      ...(agg.plainReason ? { plainReason: agg.plainReason } : {}),
      reason: `same_meaning yes ${r.answers.filter((a) => a.same_meaning === 'yes').length}/${r.answers.length} via ${sel.backend.id}`,
    };
    cache.set(key, outcome);
    return outcome;
  }

  return {
    settings,
    cache,
    budget,
    async judge(req) {
      try {
        return await judgeUnsafe(req);
      } catch (err) {
        return {
          verdict: 'unavailable',
          confidence: 0,
          reason: `error: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300),
        };
      }
    },
    select: (authorEngineId) => selectJudge(settings, deps, authorEngineId),
  };
}
