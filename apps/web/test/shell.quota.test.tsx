// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import type { HarnessEvent } from '@harness-x/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { quotaLevel, TopBar } from '../src/shell/TopBar.js';
import { toQuotaMeters, useQuota, type QuotaSummary } from '../src/shell/useQuota.js';

afterEach(cleanup);

const sum = (
  engineId: string,
  ratio: number | undefined,
  extra: Partial<QuotaSummary> = {},
): QuotaSummary => ({
  engineId,
  totalTokens: 12_345,
  requests: 7,
  costUsd: 0.4567,
  costEstimated: false,
  level: 'ok',
  ...(ratio !== undefined ? { ratio } : {}),
  ...extra,
});

describe('60.2 상단 바 쿼터 미터', () => {
  it('엔진별 막대, 80% 노랑·95% 빨강, 툴팁에 토큰·요청·비용 (스냅샷)', () => {
    const meters = toQuotaMeters(
      [
        { id: 'claude-code', label: 'Claude' },
        { id: 'codex', label: 'Codex' },
        { id: 'antigravity', label: 'Antigravity' },
      ],
      [sum('claude-code', 0.79), sum('codex', 0.8, { costEstimated: true }), sum('openai-compat', 0.95)],
    );
    const { container } = render(<TopBar runState="idle" quotas={meters} />);
    const levels = [...container.querySelectorAll('.hx-quota')].map((e) => [
      e.getAttribute('data-engine'),
      e.getAttribute('data-level'),
    ]);
    expect(levels).toEqual([
      ['claude-code', 'ok'],
      ['codex', 'warning'],
      ['antigravity', 'unknown'],
      ['openai-compat', 'danger'],
    ]);
    expect(container.querySelector('[data-engine="codex"]')!.getAttribute('title')).toBe(
      'Codex: 80% · 토큰 12,345 · 요청 7 · 추정 $0.46',
    );
    expect(screen.getAllByRole('meter').map((m) => m.getAttribute('aria-valuenow'))).toEqual([
      '79',
      '80',
      null,
      '95',
    ]);
    expect(container.querySelector('.hx-quotas')!.innerHTML).toMatchSnapshot();
    expect([quotaLevel(0.949), quotaLevel(0.95), quotaLevel(undefined)]).toEqual([
      'warning',
      'danger',
      'unknown',
    ]);
  });

  it('useQuota: 시작 시 + usage 이벤트마다 /api/quota 다시 읽기', async () => {
    let n = 0;
    const client = {
      request: async <T,>(path: string) => {
        expect(path).toBe('/api/quota');
        n++;
        return { engines: [sum('codex', n === 1 ? 0.5 : 0.9)] } as T;
      },
    };
    const engines = [{ id: 'codex', label: 'Codex' }];
    const usage = {
      id: 'u1',
      ts: '2026-11-10T00:00:00.000Z',
      sessionId: 's',
      type: 'usage',
      inputTokens: 1,
      outputTokens: 1,
    } as HarnessEvent;
    const { result, rerender } = renderHook(({ events }) => useQuota(client, events, engines), {
      initialProps: { events: [] as HarnessEvent[] },
    });
    await act(async () => {});
    expect(result.current?.[0]?.ratio).toBe(0.5);
    rerender({ events: [usage] });
    await act(async () => {});
    expect(n).toBe(2);
    expect(result.current?.[0]?.ratio).toBe(0.9);
  });
});
