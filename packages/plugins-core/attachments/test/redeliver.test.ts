import { join } from 'node:path';
import { createClaudeCodeEngine } from '@harness-x/engine-claude-code';
import { createCodexEngine } from '@harness-x/engine-codex';
import { buildApiAttachmentInput, ollamaEngine } from '@harness-x/engine-openai-compat';
import { EnginesSettingsSchema, runChecklistWithFailover } from '@harness-x/kernel';
import { engineInputs, type EngineAdapter } from '@harness-x/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { FAKE_CLI, attachmentTrio, replayArgv } from './engine-trio.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

describe('1D.8 엔진이 바뀌면(폴백·재개) 첨부를 새 엔진 방식으로 자동 재전달', () => {
  it('claude 한도 → codex 폴백: 같은 첨부가 codex 방식(--image)으로 다시 간다', async () => {
    const t = await attachmentTrio();
    cleanups.push(t.cleanup);
    const engines: Record<string, Pick<EngineAdapter, 'run'>> = {
      'claude-code': createClaudeCodeEngine({ command: process.execPath, prefixArgs: [FAKE_CLI] }),
      codex: createCodexEngine({ command: process.execPath, prefixArgs: [FAKE_CLI], transport: 'exec' }),
    };
    const settings = EnginesSettingsSchema.parse({
      engines: {
        'claude-code': { mode: 'subscription', fallback: ['codex'] },
        codex: { mode: 'subscription' },
      },
    });
    let done = false;
    const argvs: Record<string, string[]> = {};
    const ledger = {
      currentItem: () => (done ? null : { id: '1', title: '첨부 정리' }),
      nextItems: () => [],
    };
    const r = await runChecklistWithFailover({
      ledger,
      start: { engineId: 'claude-code', mode: 'subscription' },
      route: { settings, hasApiKey: () => false },
      sleepUntil: async () => {},
      runItem: async ({ selection, prompt }) => {
        // 재개할 때도 세션 자산(첨부)을 그대로 넘긴다 → 어댑터가 자기 방식으로 고른다
        argvs[selection.engineId] = await replayArgv(
          engines[selection.engineId]!,
          { sessionId: 's', prompt, cwd: t.root, attachments: t.list },
          join(t.root, `${selection.engineId}.jsonl`),
        );
        if (selection.engineId === 'claude-code') return { status: 'quota_exceeded' };
        done = true;
        return { status: 'done' };
      },
    });
    expect(r.status).toBe('completed');
    expect(r.decisions[0]).toMatchObject({ action: 'fallback', to: { engineId: 'codex' } });
    const img = t.list[0]!.storedPath;
    expect(argvs['claude-code']).not.toContain('--image');
    expect(argvs['claude-code']!.at(-1)).toContain('Read 도구로');
    expect(argvs.codex!.slice(argvs.codex!.indexOf('--image'), argvs.codex!.indexOf('--image') + 2)).toEqual([
      '--image',
      img,
    ]);
    expect(argvs.codex!.at(-1)).toContain('## 첨부 파일');
  });

  it('로컬 LLM으로 바뀌면 그림을 볼 수 있는 모델인지에 따라 다시 고른다', async () => {
    const t = await attachmentTrio();
    cleanups.push(t.cleanup);
    const vision = buildApiAttachmentInput('p', t.list, engineInputs(ollamaEngine(), 'llava'));
    const text = buildApiAttachmentInput('p', t.list, engineInputs(ollamaEngine(), 'qwen3'));
    expect(vision.media.map((m) => m.kind)).toEqual(['image']);
    expect(text.media).toEqual([]);
    expect(text.prompt).toContain('이 AI는 그림을 직접 못 봐요');
  });
});
