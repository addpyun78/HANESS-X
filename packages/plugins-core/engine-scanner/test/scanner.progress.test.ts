import { join } from 'node:path';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  diffEngines,
  EngineScanner,
  registerRescanRoute,
  RESCAN_INTERVAL_MS,
  RESCAN_ROUTE,
  SCAN_STATUS_ROUTE,
  STATUS_TIMEOUT_MS,
  writeEnginesCache,
  type EngineEntry,
  type EnginesCache,
  type ScanProgress,
} from '@harness-x/engine-scanner';
import { tempDir } from './helpers.js';

const entry = (name: string, extra: Partial<EngineEntry> = {}): EngineEntry => ({
  name,
  location: 'linux',
  path: `/bin/${name}`,
  version: '1.0.0',
  status: 'ok',
  ...extra,
});

const cacheOf = (names: string[], llms: string[] = []): EnginesCache => ({
  version: 1,
  scannedAt: '2026-11-01T00:00:00.000Z',
  platform: 'linux',
  engines: names.map((n) => entry(n)),
  localLlms: llms.map((n) => ({ name: n, baseUrl: 'http://127.0.0.1:11434', api: 'ollama', models: ['a'] })),
});

describe('T-101 5A 시작 시 자동 탐지 (스캐너)', () => {
  let t: ReturnType<typeof tempDir>;
  beforeEach(() => {
    t = tempDir();
  });
  afterEach(() => {
    vi.useRealTimers();
    t.cleanup();
  });

  it('5A.2 캐시가 있으면 스캔이 끝나기 전에 바로 보여 줄 수 있다 (start가 화면을 막지 않음)', async () => {
    const file = join(t.dir, 'engines.json');
    writeEnginesCache(cacheOf(['claude', 'codex'], ['ollama']), file);
    let release!: (v: EngineEntry[]) => void;
    const s = new EngineScanner({
      cacheFile: file,
      startupRetryMs: 0,
      scanEngines: () => new Promise((r) => (release = r)),
      probeLocalLlms: async () => [],
    });
    const started = s.start();
    // 스캔은 아직 진행 중 — 캐시는 이미 읽혀 있다
    expect(s.last?.engines.map((e) => e.name)).toEqual(['claude', 'codex']);
    expect(s.progress.state).toBe('scanning');
    const app = Fastify();
    registerRescanRoute(app, s);
    try {
      await app.ready();
      await app.inject({ method: 'GET', url: SCAN_STATUS_ROUTE }); // 첫 요청 준비(라우터 컴파일) 제외
      const t0 = performance.now();
      const res = await app.inject({ method: 'GET', url: SCAN_STATUS_ROUTE });
      expect(performance.now() - t0).toBeLessThan(500);
      expect((res.json() as ScanProgress).state).toBe('scanning');
    } finally {
      await app.close();
    }
    release([entry('claude')]);
    await started;
    s.stop();
    expect(s.progress.state).toBe('done');
  });

  it('5A.4 이전 캐시와 비교해 새로 생기거나 사라진 엔진을 알려 준다', async () => {
    expect(diffEngines(null, cacheOf(['claude']))).toEqual({ added: [], removed: [] });
    expect(diffEngines(cacheOf(['claude', 'agy']), cacheOf(['claude', 'codex'], ['ollama']))).toEqual({
      added: ['codex', 'ollama'],
      removed: ['agy'],
    });
    const file = join(t.dir, 'engines.json');
    writeEnginesCache(cacheOf(['claude']), file);
    const s = new EngineScanner({
      cacheFile: file,
      startupRetryMs: 0,
      scanEngines: async () => [entry('claude'), entry('codex')],
      probeLocalLlms: async () => [],
    });
    await s.start();
    s.stop();
    expect(s.progress).toMatchObject({ state: 'done', found: 2, added: ['codex'], removed: [] });
    // 변화 없는 재스캔
    await s.scan('manual');
    expect(s.progress).toMatchObject({ found: 2, added: [], removed: [] });
  });

  it('5A.5 느린 엔진 1개(로그인 확인이 끝나지 않음)가 전체를 막지 않는다 — 엔진별 5초 제한', async () => {
    vi.useFakeTimers();
    expect(STATUS_TIMEOUT_MS).toBe(5_000);
    const steps: ScanProgress[] = [];
    const s = new EngineScanner({
      cacheFile: join(t.dir, 'engines.json'),
      startupRetryMs: 0,
      scanEngines: async () => [entry('claude'), entry('codex'), entry('agy')],
      probeLocalLlms: async () => [
        { name: 'ollama', baseUrl: 'http://127.0.0.1:11434', api: 'ollama', models: ['a', 'b', 'c'] },
      ],
      loginStatus: (e) =>
        e.name === 'agy'
          ? new Promise(() => {}) // 영영 끝나지 않음
          : Promise.resolve(e.name === 'codex' ? 'loggedOut' : 'loggedIn'),
      onProgress: (p) => steps.push(p),
    });
    let done = false;
    const p = s.start().then((c) => {
      done = true;
      return c;
    });
    await vi.advanceTimersByTimeAsync(STATUS_TIMEOUT_MS - 1);
    expect(done).toBe(false);
    // 로컬 LLM은 이미 반영됨 (병렬)
    expect(s.progress.engines.find((e) => e.name === 'ollama')).toMatchObject({ state: 'ready', models: 3 });
    await vi.advanceTimersByTimeAsync(1);
    const cache = await p;
    s.stop();
    expect(done).toBe(true);
    expect(cache.engines.map((e) => [e.name, e.login])).toEqual([
      ['claude', 'loggedIn'],
      ['codex', 'loggedOut'],
      ['agy', 'unknown'],
    ]);
    const states = Object.fromEntries(s.progress.engines.map((e) => [e.name, e.state]));
    expect(states).toEqual({
      claude: 'ready',
      codex: 'needs-login',
      agy: 'ready',
      gemini: 'missing',
      ollama: 'ready',
    });
    expect(steps[0]?.engines.every((e) => e.state === 'checking')).toBe(true);
  });

  it('5A.9 재스캔 시점: 시작 · 30분마다 · 설치 완료 · 설정 [다시 찾기] (POST reason)', async () => {
    vi.useFakeTimers();
    const reasons: (string | undefined)[] = [];
    let prev: string | undefined;
    const s = new EngineScanner({
      cacheFile: join(t.dir, 'engines.json'),
      startupRetryMs: 0,
      scanEngines: async () => [entry('claude')],
      probeLocalLlms: async () => [],
      onProgress: (p) => {
        if (p.state === 'scanning' && prev !== 'scanning') reasons.push(p.reason);
        prev = p.state;
      },
    });
    await s.start();
    await vi.advanceTimersByTimeAsync(RESCAN_INTERVAL_MS);
    s.stop();
    vi.useRealTimers();
    const app = Fastify();
    registerRescanRoute(app, s);
    try {
      for (const reason of ['install', 'manual', 'bogus'])
        expect(
          (await app.inject({ method: 'POST', url: RESCAN_ROUTE, payload: { reason } })).statusCode,
        ).toBe(200);
    } finally {
      await app.close();
    }
    expect(reasons).toEqual(['startup', 'interval', 'install', 'manual', 'manual']);
  });
});
