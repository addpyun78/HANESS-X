// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer } from '../src/composer/Composer.js';
import type { EngineScanApi } from '../src/engines/api.js';
import { NOTHING_FOUND } from '../src/engines/model.js';
import { REDUCED_MOTION_QUERY, ScanBubble } from '../src/engines/ScanBubble.js';
import { useEngines } from '../src/engines/useEngines.js';
import { enginesApi } from '../src/settings/Engines/api.js';
import { ENGINES } from './composer.helpers.js';
import { checkPlainAll } from './plain-check.js';
import { done, fakeScanApi, scanning } from './engines-fixtures.js';

const WEB_ROOT = join(process.cwd(), 'apps/web');

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function Screen({
  api,
  events = [],
  onOpenInstall,
}: {
  api: EngineScanApi;
  events?: { type: string }[];
  onOpenInstall?: () => void;
}) {
  const e = useEngines({ api, events, ...(onOpenInstall ? { onOpenInstall } : {}) });
  return (
    <>
      {e.bubble}
      <Composer engines={ENGINES} onSend={() => {}} modelPicker={e.button} ai={e.main.current} />
    </>
  );
}

describe('T-101 5A 시작 화면 가운데 말풍선', () => {
  it('5A.2 캐시가 있으면 첫 화면 0.5초 이내 렌더 — 스캔 중에도 입력창은 바로 쓸 수 있다', async () => {
    const api = fakeScanApi([scanning()]);
    const t0 = performance.now();
    render(<Screen api={api} />);
    // 입력창은 스캔을 기다리지 않는다
    expect((screen.getByLabelText('지시 입력') as HTMLTextAreaElement).disabled).toBe(false);
    await screen.findByLabelText('AI: claude-code · sonnet');
    expect(performance.now() - t0).toBeLessThan(500);
    expect(screen.getByRole('status').textContent).toContain('엔진을 찾고 있어요');
  });

  it('5A.3 말풍선: 움직이는 점 3개 + 엔진별 진행(✓ / 로그인 필요 / … / 없음), 클릭은 통과 (스냅샷)', () => {
    const { container } = render(<ScanBubble phase="scanning" progress={scanning()} reducedMotion={false} />);
    const bubble = screen.getByRole('status');
    expect(bubble.querySelectorAll('.hx-scan-dots > span')).toHaveLength(3);
    expect([...bubble.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      '✓ Claude Code',
      '로그인 필요 Codex',
      '… Antigravity',
      '없음 Gemini CLI',
      '✓ Ollama(3)',
    ]);
    const css = readFileSync(join(WEB_ROOT, 'src/engines/engines.css'), 'utf8');
    expect(css).toMatch(/\.hx-scan-layer \{[^}]*pointer-events: none;/);
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('5A.4 완료 → "엔진 N개를 찾았어요" 1.5초 뒤 사라짐, 바뀐 엔진은 "새로 찾은 엔진: …" 한 줄', async () => {
    vi.useFakeTimers();
    const api = fakeScanApi([scanning(), done({ added: ['ollama'], removed: ['agy'] })]);
    render(<Screen api={api} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole('status').textContent).toContain('엔진을 찾고 있어요');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('엔진 4개를 찾았어요');
    expect(status.textContent).toContain('새로 찾은 엔진: Ollama · 사라진 엔진: Antigravity');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1400);
    });
    expect(screen.queryByText('엔진 4개를 찾았어요')).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(screen.queryByText('엔진 4개를 찾았어요')).toBeNull();
  });

  it('5A.4 변화가 없으면 바뀐 엔진 줄이 없다, 이미 끝난 스캔(앱을 늦게 연 경우)은 말풍선을 띄우지 않는다', async () => {
    render(<ScanBubble phase="done" progress={done()} />);
    expect(screen.getByRole('status').textContent).toBe('엔진 4개를 찾았어요');
    cleanup();
    const api = fakeScanApi([done()]);
    render(<Screen api={api} />);
    await screen.findByLabelText('AI: claude-code · sonnet');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('5A.7 0개면 쉬운 말 카드 "쓸 수 있는 AI를 못 찾았어요" + [설치 관리에서 찾기] (스냅샷)', async () => {
    const onOpenInstall = vi.fn();
    const api = fakeScanApi([done({ found: 0, engines: [] })], {
      models: vi.fn(async () => ({ models: [], scannedAt: null })),
      mainAi: vi.fn(async () => ({ main: null })),
    });
    const { container } = render(<Screen api={api} onOpenInstall={onOpenInstall} />);
    const card = await screen.findByRole('alert');
    expect(card.textContent).toContain(NOTHING_FOUND);
    fireEvent.click(screen.getByRole('button', { name: '설치 관리에서 찾기' }));
    expect(onOpenInstall).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('AI: AI 고르기')).toBeTruthy();
    expect(card.outerHTML).toMatchSnapshot();
    const texts = [...container.querySelectorAll('.hx-scan-card p')].map((p) => p.textContent ?? '');
    expect(checkPlainAll(texts).violations).toEqual([]);
  });

  it('5A.8 prefers-reduced-motion이면 움직이는 점 없이 글자만 (+ CSS 미디어 쿼리)', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((q: string) => ({
        matches: q === REDUCED_MOTION_QUERY,
        media: q,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
    render(<ScanBubble phase="scanning" progress={scanning()} />);
    const bubble = screen.getByRole('status');
    expect(bubble.getAttribute('data-reduced')).toBe('true');
    expect(bubble.querySelectorAll('.hx-scan-dots > span')).toHaveLength(0);
    expect(bubble.textContent).toContain('엔진을 찾고 있어요');
    const css = readFileSync(join(WEB_ROOT, 'src/engines/engines.css'), 'utf8');
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.hx-scan-dots > span \{\s*animation: none;/,
    );
  });

  it('5A.9 설치 관리에서 설치 완료(tool_registered) → 다시 찾기(reason install), 설정 [다시 찾기] → reason manual', async () => {
    const api = fakeScanApi([done()]);
    const { rerender } = render(<Screen api={api} events={[]} />);
    await screen.findByLabelText('AI: claude-code · sonnet');
    expect(api.calls).not.toContain('rescan:install');
    rerender(<Screen api={api} events={[{ type: 'install_planned' }, { type: 'tool_registered' }]} />);
    await waitFor(() => expect(api.calls).toContain('rescan:install'));
    // 같은 이벤트로 다시 찾지 않는다
    rerender(<Screen api={api} events={[{ type: 'install_planned' }, { type: 'tool_registered' }]} />);
    expect(api.calls.filter((c) => c === 'rescan:install')).toHaveLength(1);

    // 설정 > 엔진 [다시 찾기]
    const request = vi.fn(async (_path: string, _init?: RequestInit) => ({}) as never);
    await enginesApi({ request }).rescan();
    expect(request).toHaveBeenCalledWith(
      '/api/engines/rescan',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ reason: 'manual' }) }),
    );
  });
});
