import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EngineAdapter, HarnessEvent } from '@harness-x/protocol';
import { describe, expect, it } from 'vitest';
import { maskApiKey, PING_PROMPT, type EngineScanSnapshot } from '../src/api/engines-routes.js';
import { loadEnginesSettings } from '../src/engines-settings.js';
import { memoryBackend, SecretStore } from '../src/secrets.js';
import { bootApi } from './api-fixtures.js';
import { tempDir } from './helpers.js';

const SCAN: EngineScanSnapshot = {
  scannedAt: '2026-11-10T00:00:00.000Z',
  platform: 'win32',
  engines: [
    { name: 'codex', location: 'windows', path: 'C:\\bin\\codex.cmd', version: '0.80.0', status: 'ok' },
    { name: 'claude', location: 'wsl:Ubuntu', path: '/usr/bin/claude', version: '2.1.0', status: 'ok' },
  ],
  localLlms: [],
};

function mockAdapter(id: string, reply: string, delayMs = 5): EngineAdapter & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    id,
    displayName: id,
    prompts,
    capabilities: { nativeStopHook: false, resume: false, mcp: false, interrupt: true },
    run(o) {
      prompts.push(o.prompt);
      const base = { sessionId: o.sessionId, engineId: id, ts: new Date().toISOString() };
      async function* events(): AsyncGenerator<HarnessEvent> {
        await new Promise((r) => setTimeout(r, delayMs));
        yield { ...base, id: 'a1', type: 'assistant_text', text: reply };
        yield { ...base, id: 'a2', type: 'turn_end', reason: 'completed' };
      }
      return {
        events: events(),
        engineSessionId: () => undefined,
        interrupt: async () => {},
        done: Promise.resolve({ exitCode: 0 }),
      };
    },
  };
}

async function boot(extra: { rescan?: () => Promise<EngineScanSnapshot> } = {}) {
  const secrets = new SecretStore(memoryBackend());
  const codex = mockAdapter('codex', 'pong');
  const tmp = tempDir('hx-engines-');
  const settingsFile = join(tmp.dir, 'engines-settings.yaml');
  const api = await bootApi({
    engines: {
      secrets,
      settingsFile,
      scan: () => SCAN,
      loginStatus: async (engine) => ({
        engine,
        state: 'loggedIn',
        method: 'chatgpt',
        source: 'codex login status',
      }),
      adapters: () => [codex],
      ...extra,
    },
  });
  const req = (method: string, path: string, body?: unknown) =>
    fetch(api.server.url + path, {
      method,
      headers: { ...api.auth, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }).then(async (r) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> }));
  const close = async () => {
    await api.close();
    tmp.cleanup();
  };
  return { api: { ...api, close }, secrets, codex, req, settingsFile: () => settingsFile };
}

describe('T-038 엔진 설정 API', () => {
  it('GET /api/engines: 스캔 결과 + 설정 + 키 상태, 로그인 상태 라우트', async () => {
    const t = await boot();
    const r = await t.req('GET', '/api/engines');
    expect(r.status).toBe(200);
    expect(r.body.scan).toEqual(SCAN);
    expect(r.body.settings).toEqual({ engines: {} });
    expect((r.body.keys as Record<string, unknown>).codex).toBeNull();
    expect(r.body.adapters).toEqual([{ id: 'codex', displayName: 'codex' }]);
    const login = await t.req('GET', '/api/engines/codex/login');
    expect(login.body).toMatchObject({ engine: 'codex', state: 'loggedIn' });
    expect((await t.req('GET', '/api/engines/Bad..Id/login')).status).toBe(400);
    await t.api.close();
  });

  it('38.2 키 저장 → 키체인에만, 응답·목록은 마스킹 값만 (원문 미노출)', async () => {
    const t = await boot();
    const raw = 'sk-test-ABCDEFGHIJKLMNOP1234';
    const put = await t.req('PUT', '/api/engines/codex/key', { key: raw });
    expect(put.body).toEqual({ ok: true, engine: 'codex', key: { masked: '••••1234' } });
    expect(t.secrets.getApiKey('codex')).toBe(raw);
    const list = await t.req('GET', '/api/engines');
    expect((list.body.keys as Record<string, unknown>).codex).toEqual({ masked: '••••1234' });
    expect(JSON.stringify(list.body)).not.toContain(raw);
    expect(JSON.stringify(put.body)).not.toContain(raw);
    expect(existsSync(t.settingsFile()) ? readFileSync(t.settingsFile(), 'utf8') : '').not.toContain(raw);
    expect((await t.req('PUT', '/api/engines/codex/key', { key: ' ' })).status).toBe(400);
    const del = await t.req('DELETE', '/api/engines/codex/key');
    expect(del.body).toMatchObject({ deleted: true, key: null });
    expect(t.secrets.getApiKey('codex')).toBeNull();
    expect(maskApiKey('short')).toBe('••••');
    await t.api.close();
  });

  it('38.3 모드·기본 모델·폴백 → engines-settings.yaml 반영 (폴백 대상 자동 추가)', async () => {
    const t = await boot();
    const r = await t.req('PUT', '/api/engines/codex/settings', {
      mode: 'apiKey',
      model: 'gpt-5-codex',
      fallback: ['claude-code'],
    });
    expect(r.status).toBe(200);
    const file = loadEnginesSettings(t.settingsFile());
    expect(file.engines.codex).toEqual({ mode: 'apiKey', model: 'gpt-5-codex', fallback: ['claude-code'] });
    expect(file.engines['claude-code']).toEqual({ mode: 'subscription', fallback: [] });
    await t.req('PUT', '/api/engines/codex/settings', { model: null, fallback: [] });
    expect(loadEnginesSettings(t.settingsFile()).engines.codex).toEqual({ mode: 'apiKey', fallback: [] });
    expect((await t.req('PUT', '/api/engines/codex/settings', { mode: 'oauth' })).status).toBe(400);
    expect((await t.req('PUT', '/api/engines/codex/settings', { fallback: ['codex'] })).status).toBe(400);
    await t.api.close();
  });

  it('38.4 1턴 핑 (모킹 엔진): 결과·지연시간, 없는 엔진 404, apiKey 모드인데 키 없으면 실패', async () => {
    const t = await boot();
    const r = await t.req('POST', '/api/engines/codex/ping');
    expect(r.body).toMatchObject({ ok: true, engineId: 'codex', text: 'pong' });
    expect(typeof r.body.latencyMs).toBe('number');
    expect(t.codex.prompts).toEqual([PING_PROMPT]);
    expect((await t.req('POST', '/api/engines/antigravity/ping')).status).toBe(404);
    await t.req('PUT', '/api/engines/codex/settings', { mode: 'apiKey' });
    const noKey = await t.req('POST', '/api/engines/codex/ping');
    expect(noKey.body.ok).toBe(false);
    expect(String(noKey.body.error)).toContain('키체인');
    await t.api.close();
  });

  it('38.5 POST /api/engines/rescan → 새 스캔 결과', async () => {
    let n = 0;
    const t = await boot({ rescan: async () => ({ ...SCAN, scannedAt: `2026-11-10T00:00:0${++n}.000Z` }) });
    const r = await t.req('POST', '/api/engines/rescan');
    expect(r.body).toMatchObject({ ok: true, cache: { scannedAt: '2026-11-10T00:00:01.000Z' } });
    await t.api.close();
  });
});
