import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelOptionSchema } from '@harness-x/protocol';
import { buildModelOptions, ModelCatalog, type ModelScanLike } from '../src/models.js';

const scan = (over: Partial<ModelScanLike> = {}): ModelScanLike => ({
  scannedAt: '2026-11-12T00:00:00.000Z',
  engines: [
    { name: 'claude', status: 'ok', version: '2.1.3', login: 'unknown' },
    { name: 'codex', status: 'ok', version: '0.46.0', login: 'loggedOut' },
    { name: 'agy', status: 'ok', version: '1.0.0' },
  ],
  localLlms: [
    { name: 'ollama', baseUrl: 'http://127.0.0.1:11434', api: 'ollama', models: ['llama3', 'llava:7b'] },
    { name: 'lmstudio', baseUrl: 'http://127.0.0.1:1234', api: 'openai', models: ['qwen2.5-7b'] },
  ],
  ...over,
});

describe('T-101 5B.2 모델 목록 출처 (엔진별)', () => {
  it('Ollama /api/tags · OpenAI 호환 /v1/models = 서버가 준 목록 [무료 로컬]', () => {
    const list = buildModelOptions(scan());
    const local = list.filter((m) => m.auth === 'local');
    expect(local.map((m) => [m.engineId, m.modelId, m.source])).toEqual([
      ['ollama', 'llama3', 'local-server'],
      ['ollama', 'llava:7b', 'local-server'],
      ['lmstudio', 'qwen2.5-7b', 'local-server'],
    ]);
    // 이름으로 이미지 가능 모델 표시
    expect(local.find((m) => m.modelId === 'llava:7b')?.inputs.image).toBe(true);
    expect(local.find((m) => m.modelId === 'llama3')?.inputs.image).toBe(false);
  });

  it('Codex: 엔진(app-server 모델 목록)이 주면 그것, 없으면 엔진 플러그인 기본 목록', () => {
    const withEngine = buildModelOptions(scan(), { engineModels: { codex: ['gpt-5.5-codex', 'gpt-5.5'] } });
    expect(withEngine.filter((m) => m.engineId === 'codex').map((m) => [m.modelId, m.source])).toEqual([
      ['gpt-5.5-codex', 'engine'],
      ['gpt-5.5', 'engine'],
    ]);
    const fallback = buildModelOptions(scan());
    expect(fallback.filter((m) => m.engineId === 'codex').map((m) => [m.modelId, m.source])).toEqual([
      ['default', 'default'],
    ]);
  });

  it('Claude Code·Antigravity: 기본 목록 + 사용자 추가 항목, 스캐너 이름은 하네스 엔진 id로', () => {
    const list = buildModelOptions(scan(), {
      userModels: [
        { engineId: 'claude-code', modelId: 'claude-opus-4-1', displayName: 'Opus 4.1' },
        { engineId: 'ollama', modelId: 'my-tuned' },
      ],
    });
    expect(list.filter((m) => m.engineId === 'claude-code').map((m) => [m.modelId, m.source])).toEqual([
      ['sonnet', 'default'],
      ['opus', 'default'],
      ['haiku', 'default'],
      ['claude-opus-4-1', 'user'],
    ]);
    expect(list.some((m) => m.engineId === 'antigravity' && m.modelId === 'default')).toBe(true);
    expect(list.find((m) => m.modelId === 'my-tuned')).toMatchObject({ auth: 'local', source: 'user' });
    for (const m of list) ModelOptionSchema.parse(m);
  });

  it('상태·인증: 로그아웃이면 needs-login, API 키 모드면 [API]이고 구독 로그인과 무관', () => {
    const list = buildModelOptions(scan(), {
      authMode: (id) => (id === 'claude-code' ? 'apiKey' : undefined),
    });
    expect(list.find((m) => m.engineId === 'codex')).toMatchObject({
      status: 'needs-login',
      auth: 'subscription',
    });
    expect(list.find((m) => m.engineId === 'claude-code')).toMatchObject({ status: 'ready', auth: 'api' });
    expect(list.find((m) => m.engineId === 'claude-code')?.inputs).toEqual({
      image: true,
      pdf: true,
      audio: false,
    });
    const broken = buildModelOptions(
      scan({
        engines: [{ name: 'gemini', status: 'unknown', version: null, error: '시간 초과' }],
        localLlms: [],
      }),
    );
    expect(broken.every((m) => m.status === 'unavailable')).toBe(true);
  });
});

describe('T-101 5B.3 모델 목록 캐시 — 재스캔 때 갱신', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('같은 스캔이면 다시 만들지 않고(엔진 목록 요청 1번), 스캔 시각이 바뀌면 갱신 + models.json 기록', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hx-models-'));
    dirs.push(dir);
    let current = scan();
    const listModels = vi.fn(async () => ['gpt-5.5-codex']);
    const cat = new ModelCatalog({
      scan: () => current,
      adapters: () => [{ id: 'codex', listModels }],
      cacheFile: join(dir, 'models.json'),
    });
    expect(cat.peek()).toBeNull();
    const a = await cat.get();
    const b = await cat.get();
    expect(b).toBe(a);
    expect(listModels).toHaveBeenCalledTimes(1);
    expect(a.models.some((m) => m.modelId === 'gpt-5.5-codex')).toBe(true);

    current = scan({ scannedAt: '2026-11-12T00:30:00.000Z', localLlms: [] });
    const c = await cat.get();
    expect(listModels).toHaveBeenCalledTimes(2);
    expect(c.scannedAt).toBe('2026-11-12T00:30:00.000Z');
    expect(c.models.some((m) => m.auth === 'local')).toBe(false);

    // 다음 시작: 파일 캐시로 바로 보여 준다 (엔진에 묻지 않음)
    const saved = JSON.parse(readFileSync(join(dir, 'models.json'), 'utf8')) as { scannedAt: string };
    expect(saved.scannedAt).toBe('2026-11-12T00:30:00.000Z');
    const next = new ModelCatalog({ scan: () => current, cacheFile: join(dir, 'models.json') });
    expect(next.peek()?.models).toEqual(c.models);
  });

  it('엔진 목록 요청이 느리면 제한 시간 뒤 기본 목록으로', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hx-models-'));
    dirs.push(dir);
    const cat = new ModelCatalog({
      scan: () => scan(),
      adapters: () => [{ id: 'codex', listModels: () => new Promise(() => {}) }],
      cacheFile: join(dir, 'models.json'),
      listTimeoutMs: 50,
    });
    const r = await cat.get();
    expect(r.models.filter((m) => m.engineId === 'codex').map((m) => m.modelId)).toEqual(['default']);
  });
});
