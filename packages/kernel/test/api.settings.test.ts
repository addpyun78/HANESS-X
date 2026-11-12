// @features F-002 F-009 F-010 F-012 F-013 F-014 F-017 F-022 F-032 F-033 F-034 F-037 F-039 F-040 F-041 F-044 F-045 F-046 F-049 F-050 F-053 F-055 F-057 F-061 F-064 F-065 F-067 F-071 F-072 F-076 F-078 F-081 F-082 F-083 F-084 F-091 F-094 F-096 F-098 F-101 F-103 F-107 F-112 F-113 F-114 F-115 F-116 F-117 F-128 F-132
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PluginConfigSource } from '../src/settings/plugins.js';
import type { ProjectSettingsIO } from '../src/settings/store.js';
import { bootApi } from './api-fixtures.js';
import { tempDir } from './helpers.js';

async function boot(extra: { plugins?: PluginConfigSource[]; project?: ProjectSettingsIO } = {}) {
  const tmp = tempDir('hx-settings-api-');
  const file = join(tmp.dir, 'settings.json');
  const kc = new Map<string, string>();
  const api = await bootApi({
    settings: {
      file,
      secrets: {
        get: (a) => kc.get(a) ?? null,
        set: (a, v) => void kc.set(a, v),
        delete: (a) => kc.delete(a),
      },
      engines: () => ({ codex: { mode: 'apiKey', fallback: [] } }),
      ...(extra.plugins ? { plugins: () => extra.plugins! } : {}),
      ...(extra.project ? { project: extra.project } : {}),
    },
  });
  const req = (method: string, path: string, body?: unknown) =>
    fetch(api.server.url + path, {
      method,
      headers: { ...api.auth, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }).then(async (r) => ({
      status: r.status,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 응답 모양을 자유롭게 확인
      body: (await r.json()) as Record<string, any>,
    }));
  const close = async () => {
    await api.close();
    tmp.cleanup();
  };
  return { req, close, file, kc };
}

describe('T-101 0-1 설정 API (/api/settings)', () => {
  it('GET: 그룹 13개 + 키 목록(JSON Schema·메타) + 현재 값, PUT 저장·잘못된 값 400 쉬운 말', async () => {
    const b = await boot();
    try {
      const g = await b.req('GET', '/api/settings');
      expect(g.status).toBe(200);
      expect(g.body.groups).toHaveLength(13);
      const samples = g.body.fields.find((f: { key: string }) => f.key === 'judge.samples');
      expect(samples).toMatchObject({
        widget: 'number',
        restartRequired: true,
        schema: { minimum: 1, maximum: 3 },
      });
      expect(g.body.values['judge.samples']).toMatchObject({ effective: 3, source: 'default' });
      expect(g.body.values.engines).toMatchObject({
        source: 'global',
        effective: { codex: { mode: 'apiKey' } },
      });

      const bad = await b.req('PUT', '/api/settings', { key: 'judge.samples', value: 5 });
      expect(bad).toEqual({
        status: 400,
        body: { error: 'invalid_value', key: 'judge.samples', message: '3 이하로 넣어 주세요.' },
      });
      expect(existsSync(b.file)).toBe(false);

      const ok = await b.req('PUT', '/api/settings', { key: 'judge.samples', value: 2 });
      expect(ok.body).toMatchObject({
        ok: true,
        restartRequired: true,
        notice: '다시 시작하면 적용돼요.',
        state: { effective: 2 },
      });
      expect(JSON.parse(readFileSync(b.file, 'utf8'))).toEqual({ judge: { samples: 2 } });

      const eng = await b.req('PUT', '/api/settings', { key: 'engines', value: {} });
      expect(eng.body.message).toBe('엔진 화면에서 바꿔 주세요.');
      expect((await b.req('GET', '/api/settings/schema')).body.$id).toContain('settings');
    } finally {
      await b.close();
    }
  });

  it('되돌리기 · 키 입력기 (응답에 키 원문 없음)', async () => {
    const b = await boot();
    try {
      await b.req('PUT', '/api/settings', { key: 'judge.samples', value: 2 });
      await b.req('PUT', '/api/settings', { key: 'tools.budget', value: 'any' });
      const r = await b.req('POST', '/api/settings/reset', { group: 'judge' });
      expect(r.body.reset).toEqual(['judge.samples']);
      expect(r.body.values['tools.budget'].effective).toBe('any');
      expect((await b.req('POST', '/api/settings/reset', { all: true })).body.reset).toEqual([
        'tools.budget',
      ]);
      expect((await b.req('POST', '/api/settings/reset', {})).status).toBe(400);

      const s = await b.req('PUT', '/api/settings/secret', {
        key: 'tools.braveKey',
        value: 'brave-1234567890',
      });
      expect(s.body).toEqual({ ok: true, key: 'tools.braveKey', masked: '••••7890' });
      expect(b.kc.get('brave-search')).toBe('brave-1234567890');
      const g = await b.req('GET', '/api/settings');
      expect(JSON.stringify(g.body)).not.toContain('brave-1234567890');
      expect(g.body.values['tools.braveKey'].masked).toBe('••••7890');
      expect((await b.req('DELETE', '/api/settings/secret?key=tools.braveKey')).body.deleted).toBe(true);
    } finally {
      await b.close();
    }
  });

  it('프로젝트 범위: ?project= 로 프로젝트 값이 전체 값을 덮는다 (주입된 프로젝트 설정 읽기/쓰기)', async () => {
    const data: Record<string, Record<string, unknown>> = {};
    const project: ProjectSettingsIO = {
      read: (id) => structuredClone(data[id] ?? {}),
      write: (id, v) => void (data[id] = v),
    };
    const b = await boot({
      project,
      plugins: [
        {
          id: 'sample',
          displayName: '샘플',
          configSchema: {
            type: 'object',
            properties: { level: { type: 'integer', minimum: 1, maximum: 5, default: 2, title: '단계' } },
          },
        },
      ],
    });
    try {
      // 플러그인 키는 global 전용 → 프로젝트 저장 거부
      const p = await b.req('PUT', '/api/settings', {
        key: 'plugins.sample.level',
        value: 3,
        scope: 'project',
        project: 'p1',
      });
      expect(p.body.message).toBe('이 설정은 전체에만 적용돼요.');
      expect(
        (await b.req('PUT', '/api/settings', { key: 'plugins.sample.level', value: 3 })).body.state.effective,
      ).toBe(3);
      expect(JSON.parse(readFileSync(b.file, 'utf8'))).toEqual({ plugins: { sample: { level: 3 } } });
      expect((await b.req('GET', '/api/settings?project=p1')).body.projectSettings).toBe(true);
    } finally {
      await b.close();
    }
  });
});
