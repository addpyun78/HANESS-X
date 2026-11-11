import { describe, expect, it } from 'vitest';
import { selectAssistEngine } from '../src/assist.js';

const engines = [
  { id: 'claude-code', detected: true, loggedIn: true },
  { id: 'codex', detected: true, loggedIn: true },
];

describe('T-101 5C.3 도구 판단(assist)이 "자동"이면 메인 AI', () => {
  it('assist·judge 빈 값 → 메인 AI (세션 엔진보다 먼저)', () => {
    expect(
      selectAssistEngine(
        { assistEngine: '', judgeEngine: '', mainEngine: 'codex', sessionEngine: 'claude-code' },
        engines,
      ),
    ).toEqual({ engineId: 'codex', from: 'main' });
  });
  it('직접 정한 assist·judge가 먼저, 메인이 못 쓰는 엔진이면 세션 엔진', () => {
    expect(selectAssistEngine({ judgeEngine: 'claude-code', mainEngine: 'codex' }, engines)).toEqual({
      engineId: 'claude-code',
      from: 'judge',
    });
    expect(selectAssistEngine({ mainEngine: 'agy', sessionEngine: 'claude-code' }, engines)).toEqual({
      engineId: 'claude-code',
      from: 'session',
    });
  });
});
