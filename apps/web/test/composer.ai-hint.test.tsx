// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { checkPlainKorean } from './plain-check.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachmentHints } from '../src/composer/attachments.js';
import type { EngineOption } from '../src/composer/types.js';
import { Composer } from '../src/composer/Composer.js';

afterEach(cleanup);
beforeEach(() => {
  // jsdom에는 object URL이 없다
  URL.createObjectURL = vi.fn((f: Blob) => `blob:${(f as File).name}`);
  URL.revokeObjectURL = vi.fn();
});

const composer = () => document.querySelector('.hx-composer')!;
const file = (name: string, type: string, body = 'x') => new File([body], name, { type });
const drop = (...files: File[]) => fireEvent.drop(composer(), { dataTransfer: { files } });

describe('1E.5 지금 고른 AI 기준 안내 (모델 바꾸면 문구 변경)', () => {
  const WITH_INPUTS: EngineOption[] = [
    {
      id: 'claude-code',
      label: 'Claude Code',
      available: true,
      inputs: { image: true, pdf: true, audio: false, maxImageMB: 5 },
    },
    {
      id: 'ollama-qwen3',
      label: 'Ollama qwen3',
      available: true,
      inputs: { image: false, pdf: false, audio: false, maxImageMB: 0 },
    },
  ];
  it('그림을 못 보는 AI로 바꾸면 "글로 바꿔서 보낼게요"', () => {
    // 5C.1 이후 엔진은 오른쪽 아래 모델 버튼(메인 AI)이 고른다 → ai prop으로 바꾼다
    const props = { engines: WITH_INPUTS, onSend: () => {} };
    const r = render(<Composer {...props} ai={{ engine: 'claude-code' }} />);
    drop(file('화면.png', 'image/png'), file('기획.pdf', 'application/pdf'));
    expect(document.querySelector('.hx-attachment-hint')).toBeNull();
    r.rerender(<Composer {...props} ai={{ engine: 'ollama-qwen3', model: 'qwen3' }} />);
    const hint = document.querySelector('.hx-attachment-hint')!.textContent!;
    expect(hint).toContain('이 AI는 그림을 직접 못 봐요 → 글로 바꿔서 보낼게요.');
    expect(hint).toContain('이 AI는 PDF를 직접 못 읽어요 → 글로 바꿔서 보낼게요.');
    r.rerender(<Composer {...props} ai={{ engine: 'claude-code' }} />);
    expect(document.querySelector('.hx-attachment-hint')).toBeNull();
    for (const h of attachmentHints(
      [
        { name: 'a.png', mime: 'image/png' },
        { name: 'b.pdf', mime: 'application/pdf' },
        { name: 'c.mp3', mime: 'audio/mpeg' },
      ],
      WITH_INPUTS[1]!.inputs,
    ))
      expect(checkPlainKorean(h).ok, h).toBe(true);
  });
});
