// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { checkPlainKorean } from './plain-check.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachmentHints } from '../src/composer/attachments.js';
import type { EngineOption } from '../src/composer/types.js';
import { renderComposer } from './composer.helpers.js';

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
    renderComposer({ engines: WITH_INPUTS });
    drop(file('화면.png', 'image/png'), file('기획.pdf', 'application/pdf'));
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /엔진/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Ollama qwen3/ }));
    const hint = screen.getByRole('status').textContent!;
    expect(hint).toContain('이 AI는 그림을 직접 못 봐요 → 글로 바꿔서 보낼게요.');
    expect(hint).toContain('이 AI는 PDF를 직접 못 읽어요 → 글로 바꿔서 보낼게요.');
    fireEvent.click(screen.getByRole('button', { name: /엔진/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Claude Code/ }));
    expect(screen.queryByRole('status')).toBeNull();
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
