import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EventLog } from '../src/event-log.js';
import {
  isAutoEngine,
  pickRunEngine,
  readMainAi,
  resolveAutoEngine,
  resolveSessionAi,
  SESSION_AI_EVENT,
  SessionAiOverrides,
  writeMainAi,
} from '../src/main-ai.js';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'hx-main-ai-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('T-101 5C.3 메인 AI = settings.json main.engine/main.model', () => {
  it('읽기·쓰기 (중첩·평평한 키 모두 읽고, 다른 설정은 유지)', () => {
    const f = join(tmp(), 'settings.json');
    expect(readMainAi(f)).toBeUndefined();
    writeFileSync(f, JSON.stringify({ 'main.engine': 'codex', builder: { engine: '' } }));
    expect(readMainAi(f)).toEqual({ engine: 'codex' });
    writeMainAi({ engine: 'claude-code', model: 'sonnet' }, f);
    expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual({
      builder: { engine: '' },
      main: { engine: 'claude-code', model: 'sonnet' },
    });
  });

  it('설정이 "자동"(빈 값·auto·main)이면 메인 AI, 아니면 그 설정 — 새 세션 기본값도 메인', () => {
    const main = { engine: 'codex', model: 'gpt-5.5' };
    for (const v of ['', ' ', 'auto', 'main', undefined, null]) {
      expect(isAutoEngine(v)).toBe(true);
      expect(resolveAutoEngine(v, main)).toBe('codex');
    }
    expect(resolveAutoEngine('claude-code', main)).toBe('claude-code');
    expect(resolveSessionAi({ main })).toEqual({ ...main, from: 'main' });
    expect(pickRunEngine({ main: 'codex', available: ['claude-code', 'codex'] })).toBe('codex');
    expect(pickRunEngine({ agentDefault: 'auto', main: 'codex', available: ['claude-code', 'codex'] })).toBe(
      'codex',
    );
    expect(pickRunEngine({ agentDefault: 'claude-code', main: 'codex', available: ['claude-code'] })).toBe(
      'claude-code',
    );
    // 메인이 없어졌으면 첫 엔진
    expect(pickRunEngine({ main: 'agy', available: ['claude-code'] })).toBe('claude-code');
  });

  it('5C.3b 새 세션: 이 세션만 → 프로젝트 기본 → 메인 순', () => {
    const main = { engine: 'codex' };
    const project = { engine: 'claude-code', model: 'opus' };
    expect(resolveSessionAi({ main, project })).toEqual({ ...project, from: 'project' });
    expect(resolveSessionAi({ main, project, session: { engine: 'ollama' } })).toEqual({
      engine: 'ollama',
      from: 'session',
    });
    expect(resolveSessionAi({})).toEqual({ from: 'none' });
  });
});

describe('T-101 5C.4 실행 중 세션에서 바꾸면 다음 턴부터, 기록 남김 (리플레이)', () => {
  it('지금 턴은 그대로, 다음 턴 시작 때 새 AI — 이벤트 로그를 다시 읽으면 같은 상태', () => {
    const dir = tmp();
    const log = new EventLog({ root: join(dir, 'logs') });
    const o = new SessionAiOverrides(log);
    // 1턴 시작 때 정한 엔진 (바꾸기 전)
    const turn1 = o.forTurn('s1') ?? { engine: 'claude-code' };
    const rec = o.set('s1', { engine: 'codex', model: 'gpt-5.5' });
    expect(rec).toEqual({
      type: SESSION_AI_EVENT,
      sessionId: 's1',
      engine: 'codex',
      model: 'gpt-5.5',
      appliesFrom: 'next-turn',
    });
    expect(turn1).toEqual({ engine: 'claude-code' }); // 진행 중인 턴은 영향 없음
    expect(o.forTurn('s1')).toEqual({ engine: 'codex', model: 'gpt-5.5' });
    expect(o.forTurn('s2')).toBeUndefined();
    log.close();
    // 리플레이
    const again = new EventLog({ root: join(dir, 'logs') });
    const events = again.query({ type: SESSION_AI_EVENT });
    expect(events).toHaveLength(1);
    expect(SessionAiOverrides.fromEvents(events).forTurn('s1')).toEqual({
      engine: 'codex',
      model: 'gpt-5.5',
    });
    again.close();
  });
});

describe('T-101 5C.5 @엔진 수식어는 이번 실행만 (메인 불변)', () => {
  it('수식어가 있으면 그 엔진으로 실행하고 settings.json main은 그대로', () => {
    const f = join(tmp(), 'settings.json');
    writeMainAi({ engine: 'claude-code', model: 'sonnet' }, f);
    const before = readFileSync(f, 'utf8');
    const main = readMainAi(f)?.engine;
    expect(pickRunEngine({ modifier: 'codex', main, available: ['claude-code', 'codex'] })).toBe('codex');
    expect(pickRunEngine({ modifier: 'codex', agentDefault: 'antigravity', main, available: [] })).toBe(
      'codex',
    );
    // 다음 실행(수식어 없음)은 다시 메인
    expect(pickRunEngine({ main, available: ['claude-code', 'codex'] })).toBe('claude-code');
    expect(readFileSync(f, 'utf8')).toBe(before);
    expect(readMainAi(f)).toEqual({ engine: 'claude-code', model: 'sonnet' });
  });
});

describe('T-101 5C.3b 0-2 프로젝트 기본값과 연결 (GlobalDefaultsSource = 메인 AI)', () => {
  it('전체 기본값은 메인 AI, 프로젝트 기본 AI가 있으면 그것이 먼저 ("이 프로젝트 기본" 표시용 from)', async () => {
    const { mainAiSessionDefaults } = await import('../src/main-ai.js');
    const { resolveSessionDefaults } = await import('../src/projects/defaults.js');
    const main = { engine: 'codex', model: 'gpt-5.5' };
    const global = mainAiSessionDefaults(main, ['claude-code', 'codex']);
    expect(global).toEqual({ engine: 'codex', model: 'gpt-5.5' });
    expect(resolveSessionDefaults(undefined, global)).toMatchObject({
      engine: 'codex',
      model: 'gpt-5.5',
      from: { engine: 'global', model: 'global' },
    });
    expect(
      resolveSessionDefaults({ defaults: { engine: 'claude-code', model: 'opus' } }, global),
    ).toMatchObject({ engine: 'claude-code', model: 'opus', from: { engine: 'project', model: 'project' } });
    // 메인이 없거나 못 쓰면 첫 엔진 (모델은 비움)
    expect(mainAiSessionDefaults(undefined, ['claude-code'])).toEqual({ engine: 'claude-code' });
    expect(mainAiSessionDefaults(main, ['claude-code'])).toEqual({ engine: 'claude-code' });
    expect(mainAiSessionDefaults(undefined, [])).toEqual({});
  });
});
