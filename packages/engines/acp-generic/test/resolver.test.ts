import { describe, expect, it } from 'vitest';
import { resolveEngine, type InstalledEngine } from '../src/index.js';

// 18.4 엔진 선택 우선순위 ACP → 헤드리스 → API: 설치 조합 4가지

const ACP: InstalledEngine = {
  name: 'claude-agent-acp',
  path: '/usr/bin/claude-agent-acp',
  location: 'linux',
  status: 'ok',
};
const CLI: InstalledEngine = { name: 'claude', path: '/usr/bin/claude', location: 'linux', status: 'ok' };

describe('resolveEngine (claude-code)', () => {
  it('① ACP + 헤드리스 + API 키 → ACP', () => {
    const r = resolveEngine({
      family: 'claude-code',
      installed: [CLI, ACP],
      auth: 'apiKey',
      hasApiKey: true,
    });
    expect(r).toMatchObject({
      route: 'acp',
      bin: 'claude-agent-acp',
      command: ACP.path,
      args: [],
      location: 'linux',
    });
  });

  it('② 헤드리스만 → 헤드리스', () => {
    const r = resolveEngine({ family: 'claude-code', installed: [CLI], auth: 'apiKey', hasApiKey: true });
    expect(r).toMatchObject({ route: 'headless', bin: 'claude', command: CLI.path });
    expect(r.skipped.map((s) => s.route)).toEqual(['acp']);
  });

  it('③ CLI 없음 + apiKey 모드·키 있음 → API', () => {
    const r = resolveEngine({ family: 'claude-code', installed: [], auth: 'apiKey', hasApiKey: true });
    expect(r).toMatchObject({ route: 'api', engineId: 'anthropic-api' });
    expect(r.skipped.map((s) => s.route)).toEqual(['acp', 'headless']);
  });

  it('④ CLI 없음 + 구독 모드(또는 키 없음) → none', () => {
    const sub = resolveEngine({ family: 'claude-code', installed: [] });
    expect(sub.route).toBe('none');
    expect(sub.skipped.at(-1)).toMatchObject({ route: 'api', reason: expect.stringContaining('구독') });
    const noKey = resolveEngine({ family: 'claude-code', installed: [], auth: 'apiKey', hasApiKey: false });
    expect(noKey.route).toBe('none');
  });
});

describe('resolveEngine (기타)', () => {
  it('ACP 어댑터 구 이름 claude-code-acp 도 인식', () => {
    const r = resolveEngine({
      family: 'claude-code',
      installed: [{ name: 'claude-code-acp', path: '/x/claude-code-acp' }],
    });
    expect(r).toMatchObject({ route: 'acp', bin: 'claude-code-acp' });
  });

  it('outdated ACP는 건너뛰고 헤드리스 (allowOutdated면 ACP)', () => {
    const installed = [{ ...ACP, status: 'outdated' as const }, CLI];
    expect(resolveEngine({ family: 'claude-code', installed }).route).toBe('headless');
    expect(resolveEngine({ family: 'claude-code', installed, allowOutdated: true }).route).toBe('acp');
  });

  it('codex: codex-acp → codex → openai-compat', () => {
    const acp = { name: 'codex-acp', path: '/b/codex-acp' };
    const cli = { name: 'codex', path: '/b/codex' };
    expect(resolveEngine({ family: 'codex', installed: [cli, acp] }).route).toBe('acp');
    expect(resolveEngine({ family: 'codex', installed: [cli] }).route).toBe('headless');
    expect(resolveEngine({ family: 'codex', installed: [], auth: 'apiKey', hasApiKey: true })).toMatchObject({
      route: 'api',
      engineId: 'openai-compat',
    });
  });

  it('gemini: 같은 바이너리를 --experimental-acp 로 ACP 실행', () => {
    const r = resolveEngine({ family: 'gemini', installed: [{ name: 'gemini', path: '/b/gemini' }] });
    expect(r).toMatchObject({ route: 'acp', command: '/b/gemini', args: ['--experimental-acp'] });
  });

  it('antigravity: ACP 후보 없음 → agy 헤드리스', () => {
    const r = resolveEngine({ family: 'antigravity', installed: [{ name: 'agy', path: '/b/agy' }] });
    expect(r).toMatchObject({ route: 'headless', bin: 'agy' });
  });
});
