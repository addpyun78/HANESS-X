import { describe, expect, it } from 'vitest';
import { parseEnginesSettings } from '../src/engines-settings.js';
import type { ResumableSession } from '../src/resume.js';
import { checkBeforeResume } from '../src/resume-check.js';
import { fallbackTable, suggestEngines } from '../src/resume-engine.js';

const session: ResumableSession = {
  sessionId: 's1',
  projectId: 'p1',
  title: '/qa',
  agent: null,
  engineId: 'codex',
  progress: 0.3,
  paused: { reason: 'quota', at: new Date().toISOString(), by: 'quota-router' },
  startedAt: null,
};

const settings = parseEnginesSettings(`
engines:
  claude-code:
    mode: subscription
    fallback: codex
  codex:
    mode: subscription
    fallback: [claude-code, openai-compat]
  openai-compat:
    mode: apiKey
  antigravity:
    mode: apiKey
`);

describe('2B.5 AI 사용 가능 점검', () => {
  it('원래 엔진을 못 쓰면 폴백 순서대로 사용 가능한 것만 제안', () => {
    const fallback = fallbackTable(settings.engines);
    expect(fallback).toEqual({ 'claude-code': ['codex'], codex: ['claude-code', 'openai-compat'] });
    expect(
      suggestEngines('codex', { available: ['antigravity', 'openai-compat', 'claude-code'], fallback }),
    ).toEqual(['claude-code', 'openai-compat', 'antigravity']);
    // 폴백이 하나도 안 되면 다른 사용 가능 엔진
    expect(suggestEngines('codex', { available: ['antigravity'], fallback })).toEqual(['antigravity']);
    expect(suggestEngines('codex', { available: [], fallback })).toEqual([]);
  });

  it('메인 AI가 정해지면(5번 이후) 맨 앞', () => {
    const fallback = fallbackTable(settings.engines);
    expect(
      suggestEngines('codex', {
        available: ['claude-code', 'openai-compat', 'antigravity'],
        fallback,
        mainAi: 'antigravity',
      }),
    ).toEqual(['antigravity', 'claude-code', 'openai-compat']);
    // 메인 AI가 지금 쓸 수 없으면 건너뜀
    expect(
      suggestEngines('codex', { available: ['openai-compat'], fallback, mainAi: 'antigravity' }),
    ).toEqual(['openai-compat']);
  });

  it('점검기에 연결: 못 쓰면 카드, 쓸 수 있으면 통과', () => {
    const available = ['claude-code', 'openai-compat'];
    const deps = {
      engineAvailable: (id: string) => available.includes(id),
      engineSuggestions: (id: string) =>
        suggestEngines(id, { available, fallback: fallbackTable(settings.engines), mainAi: 'openai-compat' }),
    };
    const r = checkBeforeResume(session, deps);
    expect(r.issues.map((i) => i.check)).toEqual(['engine']);
    expect(r.issues[0]!.choices.map((c) => c.id)).toEqual([
      'engine:openai-compat',
      'engine:claude-code',
      'wait',
    ]);
    expect(r.issues[0]!.choices[0]!.label).toBe('내 컴퓨터 AI로 바꾸기');
    expect(checkBeforeResume({ ...session, engineId: 'claude-code' }, deps).ok).toBe(true);
  });
});
