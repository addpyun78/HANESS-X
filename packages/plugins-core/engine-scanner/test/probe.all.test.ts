import { describe, expect, it } from 'vitest';
import { LOCAL_LLM_PROBES, PROBE_TIMEOUT_MS, probeLocalLlms } from '@harness-x/engine-scanner';
import { closedPort, mockJsonServer } from './mock-server.js';

describe('12.4 타임아웃 800ms·병렬 실행', () => {
  it('5종 프로브, 기본 타임아웃 800ms', () => {
    expect(LOCAL_LLM_PROBES.map((p) => `${p.name}:${p.port}`)).toEqual([
      'ollama:11434',
      'lmstudio:1234',
      'llamacpp:8080',
      'vllm:8000',
      'jan:1337',
    ]);
    expect(PROBE_TIMEOUT_MS).toBe(800);
  });

  it('전 포트 닫힘 상태에서 1초 이내 완료', async () => {
    const baseUrls: Record<string, string> = {};
    for (const p of LOCAL_LLM_PROBES) baseUrls[p.name] = `http://127.0.0.1:${await closedPort()}`;
    const t0 = performance.now();
    expect(await probeLocalLlms({ baseUrls })).toEqual([]);
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it('응답하지 않는(멈춘) 서버 5개도 병렬 800ms 타임아웃으로 1초 이내', async () => {
    const hung = await Promise.all(LOCAL_LLM_PROBES.map(() => mockJsonServer({}, { delayMs: 10_000 })));
    try {
      const baseUrls = Object.fromEntries(LOCAL_LLM_PROBES.map((p, i) => [p.name, hung[i]!.url]));
      const t0 = performance.now();
      expect(await probeLocalLlms({ baseUrls })).toEqual([]);
      const ms = performance.now() - t0;
      expect(ms).toBeGreaterThanOrEqual(PROBE_TIMEOUT_MS - 50);
      expect(ms).toBeLessThan(1000);
    } finally {
      await Promise.all(hung.map((s) => s.close()));
    }
  });

  it('열린 서버만 결과에 포함', async () => {
    const srv = await mockJsonServer({ '/api/tags': { models: [{ name: 'llama3.2' }] } });
    try {
      const baseUrls: Record<string, string> = { ollama: srv.url };
      for (const p of LOCAL_LLM_PROBES.slice(1)) baseUrls[p.name] = `http://127.0.0.1:${await closedPort()}`;
      expect(await probeLocalLlms({ baseUrls })).toEqual([
        { name: 'ollama', baseUrl: srv.url, api: 'ollama', models: ['llama3.2'] },
      ]);
    } finally {
      await srv.close();
    }
  });
});
