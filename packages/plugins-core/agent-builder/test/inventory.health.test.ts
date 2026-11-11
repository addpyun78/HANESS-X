import { describe, expect, it } from 'vitest';
import { engineHealth, pipelineHealth, pluginHealth, worstHealth } from '../src/inventory/health.js';
import { ASSET_HEALTH } from '../src/inventory/schema.js';

describe('P4-A.8 건강 상태 계산 (ready | needs-login | disabled | outdated)', () => {
  it('상태 4종', () => {
    expect(ASSET_HEALTH).toEqual(['ready', 'needs-login', 'disabled', 'outdated']);
  });

  it('엔진: 정상 / 로그아웃 / 미설치·사용자 끔 / 최소 버전 미달', () => {
    expect(engineHealth({ installed: true, status: 'ok', login: 'loggedIn' })).toBe('ready');
    expect(engineHealth({ installed: true, status: 'unknown', login: 'unknown' })).toBe('ready');
    expect(engineHealth({ installed: true, status: 'ok', login: 'loggedOut' })).toBe('needs-login');
    expect(engineHealth({ installed: false })).toBe('disabled');
    expect(engineHealth({ installed: true, login: 'loggedIn', userDisabled: true })).toBe('disabled');
    expect(engineHealth({ installed: true, status: 'outdated', login: 'loggedIn' })).toBe('outdated');
    // 겹치면 더 나쁜 쪽: needs-login > outdated
    expect(engineHealth({ installed: true, status: 'outdated', login: 'loggedOut' })).toBe('needs-login');
  });

  it('플러그인: active만 ready', () => {
    expect(pluginHealth({ state: 'active' })).toBe('ready');
    expect(pluginHealth({})).toBe('ready');
    expect(pluginHealth({ state: 'failed' })).toBe('disabled');
    expect(pluginHealth({ state: 'inactive' })).toBe('disabled');
  });

  it('우선순위: disabled > needs-login > outdated > ready', () => {
    expect(worstHealth()).toBe('ready');
    expect(worstHealth('ready', 'outdated')).toBe('outdated');
    expect(worstHealth('outdated', 'needs-login', 'ready')).toBe('needs-login');
    expect(worstHealth('needs-login', 'disabled')).toBe('disabled');
  });

  it('파이프라인: 노드 엔진 중 가장 나쁜 것, auto 무시, 없는 엔진은 disabled', () => {
    const engines = new Map([
      ['claude-code', 'ready' as const],
      ['codex', 'outdated' as const],
    ]);
    const node = (engine?: string) => ({
      id: 'n',
      type: 'role',
      skills: [],
      tools: [],
      ...(engine ? { engine } : {}),
    });
    expect(pipelineHealth([node('claude-code'), node('auto'), node()], engines)).toBe('ready');
    expect(pipelineHealth([node('claude-code'), node('codex')], engines)).toBe('outdated');
    expect(pipelineHealth([node('gemini')], engines)).toBe('disabled');
  });
});
