import { parsePipeline } from '@harness-x/protocol';
import { describe, expect, it } from 'vitest';
import { Dispatcher, type DispatchAgent } from '../src/dispatch.js';
import { resolveSessionDefaults } from '../src/projects/defaults.js';
import { SessionRegistry } from '../src/projects/session-registry.js';
import { nodeRunMode, resolveRunMode, type ModeInputs } from '../src/run-mode/resolve.js';

// T-101 3E.3 우선순위: 이번 실행 수식어 > 입력창 칩 > 에이전트 기본값 > 프로젝트 기본값(0B.40) > 전체 설정 기본값

const LEVELS = ['modifier', 'chip', 'agent', 'project', 'global'] as const;
const VALUE = { modifier: 'auto', chip: 'plan', agent: 'auto', project: 'plan', global: 'auto' } as const;

describe('3E.3 조합', () => {
  it('켜진 단계의 모든 조합(2^5)에서 가장 앞 단계가 이긴다', () => {
    for (let mask = 0; mask < 32; mask++) {
      const inputs: ModeInputs = {};
      for (const [i, k] of LEVELS.entries()) if (mask & (1 << i)) inputs[k] = VALUE[k];
      const first = LEVELS.find((_, i) => mask & (1 << i));
      const r = resolveRunMode(inputs);
      if (first) expect(r, `mask ${mask}`).toEqual({ mode: VALUE[first], from: first });
      else expect(r).toEqual({ mode: 'normal', from: 'fallback' });
    }
  });

  it('모르는 값은 건너뛴다', () => {
    expect(resolveRunMode({ modifier: 'turbo', chip: 'plan' })).toEqual({ mode: 'plan', from: 'chip' });
  });

  it('프로젝트 > 전체 (세션 기본값)', () => {
    expect(resolveSessionDefaults({ defaults: { mode: 'plan' } }, { mode: 'auto' }).mode).toBe('plan');
  });

  it('3E.2 노드별 runMode는 그 노드만', () => {
    expect(nodeRunMode('auto', { runMode: 'plan' })).toBe('plan');
    expect(nodeRunMode('auto', {})).toBe('auto');
  });
});

describe('3E.3 디스패치 → 세션 mode', () => {
  const agent = (defaultMode?: 'plan' | 'normal' | 'auto'): DispatchAgent => ({
    name: 'qa',
    command: '/qa',
    displayName: 'QA',
    ...(defaultMode ? { defaultMode } : {}),
    pipeline: parsePipeline({ name: 'qa', nodes: [{ id: 'a', type: 'role' }], edges: [] }),
  });
  const boot = (a: DispatchAgent, global?: string) => {
    const sessions = new SessionRegistry({ memory: true, defaults: () => (global ? { mode: global } : {}) });
    const d = new Dispatcher({
      resolve: () => a,
      run: () => new Promise(() => {}),
      sessions,
      engines: () => [],
    });
    const mode = (prompt: string, chip?: 'plan' | 'normal' | 'auto') =>
      sessions.get(d.dispatch({ agent: 'qa', prompt, ...(chip ? { mode: chip } : {}) }).sessionId)?.mode;
    return mode;
  };

  it('수식어 > 칩 > 에이전트 > 전체', () => {
    expect(boot(agent('plan'), 'auto')('!auto 해', 'normal')).toBe('auto');
    expect(boot(agent('plan'), 'auto')('해', 'normal')).toBe('normal');
    expect(boot(agent('plan'), 'auto')('해')).toBe('plan');
    expect(boot(agent(), 'auto')('해')).toBe('auto');
    expect(boot(agent())('해')).toBeUndefined(); // 기본값도 없으면 기록 없음 = 일반
  });
});
