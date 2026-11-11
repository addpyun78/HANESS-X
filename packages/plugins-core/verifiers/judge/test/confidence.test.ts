import { describe, expect, it, vi } from 'vitest';
import {
  aggregateAnswers,
  clampSamples,
  JUDGE_MAX_SAMPLES,
  JUDGE_TIMEOUT_MS,
  modeRatio,
  sampleAnswers,
  yesRatio,
} from '../src/confidence.js';
import { buildJudgePrompt } from '../src/questions.js';
import { NO, scriptedBackend, YES } from './helpers.js';

const prompt = buildJudgePrompt({ kind: 'text', itemTitle: 't', expected: 'a', actual: 'b' });

describe('E.10 신뢰도 = 반복 일치율, 병렬 호출, 판정 1건 최대 3회·60초', () => {
  it('3/3 = 1.0, 2/3 = 0.67, 1/3 = 0.33', () => {
    expect(yesRatio([YES, YES, YES])).toBe(1);
    expect(yesRatio([YES, YES, NO])).toBeCloseTo(0.67, 2);
    expect(yesRatio([YES, NO, NO])).toBeCloseTo(0.33, 2);
    expect(yesRatio([])).toBe(0);
  });

  it('선택형은 최빈값 비율 — 분산(셋 다 다름) = 0.33', () => {
    expect(modeRatio(['equivalent', 'equivalent', 'missing'])).toEqual({ value: 'equivalent', ratio: 2 / 3 });
    const spread = modeRatio(['equivalent', 'formatting-only', 'missing']);
    expect(spread.ratio).toBeCloseTo(0.33, 2);
    const agg = aggregateAnswers([
      { ...YES, difference_kind: 'equivalent' },
      { ...YES, difference_kind: 'formatting-only' },
      { ...YES, difference_kind: 'missing' },
    ]);
    expect(agg.differenceKindRatio).toBeCloseTo(0.33, 2);
    expect(agg.confidence).toBe(1);
  });

  it('호출은 병렬 (3개가 동시에 진행 중)', async () => {
    let inFlight = 0;
    let peak = 0;
    const b = scriptedBackend([
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 20));
        inFlight--;
        return YES;
      },
    ]);
    const r = await sampleAnswers(b, prompt, 3);
    expect(r).toEqual({ ok: true, answers: [YES, YES, YES] });
    expect(peak).toBe(3);
    expect(b.calls).toBe(3);
  });

  it('표본 수 상한 3회: 5를 요청해도 3회만 호출', async () => {
    expect(JUDGE_MAX_SAMPLES).toBe(3);
    expect(clampSamples(5)).toBe(3);
    expect(clampSamples(0)).toBe(1);
    const b = scriptedBackend([YES]);
    await sampleAnswers(b, prompt, 5);
    expect(b.calls).toBe(3);
  });

  it('시간 상한(60초) 초과 → unavailable(timeout), 진행 중 호출은 취소 신호', async () => {
    expect(JUDGE_TIMEOUT_MS).toBe(60_000);
    vi.useFakeTimers();
    try {
      const signals: AbortSignal[] = [];
      const b = scriptedBackend([]);
      b.ask = (_p, signal) => {
        signals.push(signal!);
        return new Promise(() => {});
      };
      const pending = sampleAnswers(b, prompt, 3);
      await vi.advanceTimersByTimeAsync(JUDGE_TIMEOUT_MS);
      await expect(pending).resolves.toEqual({ ok: false, reason: 'timeout' });
      expect(signals.every((s) => s.aborted)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('표본 하나라도 답 불량 → unavailable(invalid-answer), 예외도 흡수', async () => {
    await expect(sampleAnswers(scriptedBackend([YES, undefined, YES]), prompt, 3)).resolves.toEqual({
      ok: false,
      reason: 'invalid-answer',
    });
    const thrower = scriptedBackend([() => Promise.reject(new Error('boom'))]);
    await expect(sampleAnswers(thrower, prompt, 2)).resolves.toEqual({ ok: false, reason: 'invalid-answer' });
  });
});
