import { describe, expect, it } from 'vitest';
import { FORCE_JSON_INSTRUCTION, askOtherEngine, decideL5, pickOtherEngine } from '../src/escalate.js';
import { CASE, mockEngines } from './escalate-fixtures.js';

const confident = (kind: 'noul' | 'choice') =>
  kind === 'noul' ? '{"noul":0.96,"confidence":0.9}' : '{"choice":"equivalent","confidence":0.9}';

describe('27.1 L5 상위 검증: 작성 엔진과 다른 엔진에 같은 질문 (JSON 응답 강제)', () => {
  it('다른 engineId로 호출된다', async () => {
    const { factory, calls } = mockEngines(['claude-code', 'codex', 'ollama'], confident);
    const r = await askOtherEngine(CASE, { engines: factory });
    expect(r).toMatchObject({ engineId: 'codex', decision: 'accept', deviation: 'equivalent' });
    expect(calls.map((c) => c.engineId)).toEqual(['codex', 'codex']);
    expect(calls.every((c) => c.engineId !== CASE.writerEngineId)).toBe(true);
    // 같은 질문 2개, 도구 없음, JSON 강제 지시
    const ids = calls.map((c) => JSON.parse(c.req.messages[1]!.content as string).question.id);
    expect(ids).toEqual(['same_artifact', 'deviation_kind']);
    for (const c of calls) {
      expect(c.req.tools).toEqual([]);
      expect(c.req.messages[0]).toMatchObject({ role: 'system' });
      expect(c.req.messages[0]!.content).toContain(FORCE_JSON_INSTRUCTION);
      expect(JSON.parse(c.req.messages[1]!.content as string).state).toEqual({
        itemTitle: '모바일 앱 스캐폴드',
        expectedPath: 'harness/mobile',
        actualPath: 'ai/mobile',
        candidates: [],
        fileNames: ['mobile'],
        symbols: ['MainActivity'],
      });
    }
  });

  it('형식이 틀리면 한 번 더 요구, 울타리 JSON 허용', async () => {
    const { factory, calls } = mockEngines(['claude-code', 'codex'], (kind, _e, attempt) =>
      attempt === 0 ? '잘 모르겠지만 같아 보입니다' : '```json\n' + confident(kind) + '\n```',
    );
    expect((await askOtherEngine(CASE, { engines: factory })).decision).toBe('accept');
    expect(calls).toHaveLength(4);
  });

  it('불확실·실패·다른 엔진 없음·계속 비JSON', async () => {
    const unsure = mockEngines(['codex'], (k) =>
      k === 'noul' ? '{"noul":0.7,"confidence":0.5}' : '{"choice":"relocated-ok","confidence":0.5}',
    );
    expect((await askOtherEngine(CASE, { engines: unsure.factory })).decision).toBe('escalate');
    const no = mockEngines(['codex'], (k) =>
      k === 'noul' ? '{"noul":0.1,"confidence":0.9}' : '{"choice":"wrong-target","confidence":0.9}',
    );
    expect(await askOtherEngine(CASE, { engines: no.factory })).toMatchObject({
      decision: 'fail',
      deviation: 'wrong-target',
    });
    const alone = mockEngines(['claude-code'], confident);
    expect(await askOtherEngine(CASE, { engines: alone.factory })).toMatchObject({
      engineId: null,
      decision: 'escalate',
    });
    expect(alone.calls).toHaveLength(0);
    const prose = mockEngines(['codex'], () => 'no json');
    expect(await askOtherEngine(CASE, { engines: prose.factory })).toMatchObject({
      engineId: 'codex',
      decision: 'escalate',
    });
  });

  it('결정 규칙과 엔진 선택', () => {
    expect(pickOtherEngine(['a', 'b'], 'a')).toBe('b');
    expect(pickOtherEngine(['a', 'b'])).toBe('a');
    expect(decideL5(0.9, 'equivalent')).toBe('accept');
    expect(decideL5(0.8999, 'equivalent')).toBe('escalate');
    expect(decideL5(0.5999, 'equivalent')).toBe('fail');
  });
});
