import { CLAUDE_CODE_INPUTS, claudeCodeEngine } from '@harness-x/engine-claude-code';
import { CODEX_INPUTS, codexEngine } from '@harness-x/engine-codex';
import { ANTIGRAVITY_INPUTS, antigravityEngine } from '@harness-x/engine-antigravity';
import { AcpEngine } from '@harness-x/engine-acp-generic';
import { anthropicEngine, deepseekEngine, geminiEngine, ollamaEngine } from '@harness-x/engine-openai-compat';
import { TEXT_ONLY_INPUTS, engineInputs, type EngineInputs } from '@harness-x/protocol';
import { describe, expect, it } from 'vitest';

describe('1D.1 엔진 어댑터 능력 inputs { image, pdf, audio, maxImageMB } — 엔진·모델별 값', () => {
  it('엔진별 값 (5번 모델 목록은 inputsFor(model)을 그대로 쓴다)', () => {
    const acp = new AcpEngine({ id: 'acp:x', displayName: 'X', command: 'x' });
    const table: [string, EngineInputs][] = [
      ['claude-code', engineInputs(claudeCodeEngine, 'sonnet')],
      ['codex', engineInputs(codexEngine, 'gpt-5-codex')],
      ['antigravity', engineInputs(antigravityEngine)],
      ['acp', engineInputs(acp)],
      ['anthropic', engineInputs(anthropicEngine(), 'claude-sonnet-4-5')],
      ['gemini', engineInputs(geminiEngine(), 'gemini-2.5-pro')],
      ['deepseek', engineInputs(deepseekEngine(), 'deepseek-chat')],
      ['ollama:llava', engineInputs(ollamaEngine(), 'llava')],
      ['ollama:qwen3', engineInputs(ollamaEngine(), 'qwen3')],
    ];
    expect(Object.fromEntries(table)).toEqual({
      'claude-code': { image: true, pdf: true, audio: false, maxImageMB: 5 },
      codex: { image: true, pdf: false, audio: false, maxImageMB: 20 },
      antigravity: { image: true, pdf: true, audio: false, maxImageMB: 7 },
      acp: TEXT_ONLY_INPUTS,
      anthropic: { image: true, pdf: true, audio: false, maxImageMB: 5 },
      gemini: { image: true, pdf: true, audio: true, maxImageMB: 20 },
      deepseek: TEXT_ONLY_INPUTS,
      'ollama:llava': { image: true, pdf: false, audio: false, maxImageMB: 10 },
      'ollama:qwen3': TEXT_ONLY_INPUTS,
    });
    expect(claudeCodeEngine.capabilities.inputs).toEqual(CLAUDE_CODE_INPUTS);
    expect(codexEngine.capabilities.inputs).toEqual(CODEX_INPUTS);
    expect(antigravityEngine.capabilities.inputs).toEqual(ANTIGRAVITY_INPUTS);
    // 능력을 모르는 어댑터는 글만 받는 AI로 본다
    expect(engineInputs({ capabilities: {} })).toEqual(TEXT_ONLY_INPUTS);
  });
});
