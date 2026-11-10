import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ollamaEngine } from '@harness-x/engine-openai-compat';
import type { EngineAdapter, HarnessEvent } from '@harness-x/protocol';

/**
 * T-018 18.5 EPIC 1 게이트: 4개 엔진(Claude Code·Codex·Antigravity·로컬 LLM)에 같은 프롬프트를 동시에 실행하고
 * 세션별 HarnessEvent 타입 집합이 같은지 본다.
 * 실제 CLI·로그인·로컬 LLM이 필요하므로 기본 skip. 실행: HX_EPIC1_GATE=1 pnpm exec vitest run tests/epic1-gate.test.ts
 * TODO(T-014~T-016 병합 후): 아래 ENGINE_MODULES의 어댑터 생성 방식을 실제 export에 맞춘다.
 */

const ENGINE_MODULES = [
  '@harness-x/engine-claude-code',
  '@harness-x/engine-codex',
  '@harness-x/engine-antigravity',
] as const;

const PROMPT = 'Create a file named hello.txt containing the word hello, then reply DONE.';

function isAdapter(v: unknown): v is EngineAdapter {
  return typeof v === 'object' && v !== null && typeof (v as EngineAdapter).run === 'function';
}

/** 모듈에서 어댑터를 찾는다: EngineAdapter 인스턴스 export 또는 인자 없는 create*Engine/create*Adapter 팩토리 */
async function loadAdapter(name: string): Promise<EngineAdapter> {
  const mod = (await import(/* @vite-ignore */ name)) as Record<string, unknown>;
  for (const v of Object.values(mod)) if (isAdapter(v)) return v;
  for (const [k, v] of Object.entries(mod)) {
    if (typeof v === 'function' && /^create.*(Engine|Adapter)$/.test(k)) {
      const a: unknown = (v as () => unknown)();
      if (isAdapter(a)) return a;
    }
  }
  throw new Error(`${name}: EngineAdapter export를 찾지 못함`);
}

function localLlmAdapter(): EngineAdapter {
  return ollamaEngine({ defaultModel: process.env.HX_EPIC1_OLLAMA_MODEL ?? 'qwen2.5-coder' });
}

async function runOnce(adapter: EngineAdapter, sessionId: string): Promise<Set<HarnessEvent['type']>> {
  const cwd = mkdtempSync(join(tmpdir(), `hx-epic1-${sessionId}-`));
  try {
    const run = adapter.run({ sessionId, prompt: PROMPT, cwd });
    const types = new Set<HarnessEvent['type']>();
    for await (const e of run.events) types.add(e.type);
    await run.done;
    return types;
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

describe.skipIf(process.env.HX_EPIC1_GATE !== '1')('EPIC 1 게이트: 4개 엔진 같은 프롬프트', () => {
  it('4개 세션 이벤트 타입 집합 동일', async () => {
    const adapters = [...(await Promise.all(ENGINE_MODULES.map(loadAdapter))), localLlmAdapter()];
    const sets = await Promise.all(adapters.map((a, i) => runOnce(a, `epic1-${i}`)));
    const norm = sets.map((s) => [...s].sort());
    for (const s of norm.slice(1)) expect(s).toEqual(norm[0]);
    expect(norm[0]).toContain('turn_end');
  }, 600_000);
});
