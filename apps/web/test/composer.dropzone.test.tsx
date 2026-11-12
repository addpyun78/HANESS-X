// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderComposer } from './composer.helpers.js';

afterEach(cleanup);
beforeEach(() => {
  // jsdom에는 object URL이 없다
  URL.createObjectURL = vi.fn((f: Blob) => `blob:${(f as File).name}`);
  URL.revokeObjectURL = vi.fn();
});

const composer = () => document.querySelector('.hx-composer')!;

describe('1E.1 입력창 전체가 놓기 영역, 끌고 오면 테두리 강조 + "여기에 놓으세요"', () => {
  it('끄는 동안만 안내가 보인다 (스냅샷은 사람 확인)', () => {
    renderComposer();
    expect(screen.queryByText('여기에 놓으세요')).toBeNull();
    fireEvent.dragOver(composer());
    expect(composer().hasAttribute('data-drag-over')).toBe(true);
    expect(screen.getByText('여기에 놓으세요')).toBeTruthy();
    fireEvent.dragLeave(composer());
    expect(screen.queryByText('여기에 놓으세요')).toBeNull();
  });
});
