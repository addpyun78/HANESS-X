// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BuilderPage } from '../src/builder/BuilderPage.js';
import { DEFAULT_CATALOG } from '../src/builder/catalog.js';
import {
  dryRunEvents,
  dryRunOrder,
  estimateCost,
  overlayFromEvents,
  totalCost,
} from '../src/builder/inspector/dryrun.js';
import { graphFromYaml } from '../src/builder/inspector/yaml.js';
import { mockReactFlowDom } from './flow-mock.js';

beforeAll(mockReactFlowDom);
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const DESIGN_QA = readFileSync(join(process.cwd(), 'examples/agents/design-qa/pipeline.yaml'), 'utf8');

describe('46.4 시험 실행 — 리플레이 오버레이', () => {
  it('드라이런 이벤트: 실행 순서대로 node_start → usage → node_end, 엔진별 추정 비용', () => {
    const r = graphFromYaml(DESIGN_QA);
    if (!r.ok) throw new Error('fixture');
    expect(dryRunOrder(r.pipeline)).toEqual(['plan', 'build', 'critic']);
    const ev = dryRunEvents(r.pipeline, '로그인 화면');
    expect(ev.filter((e) => e.type === 'node_start').map((e) => e.nodeId)).toEqual([
      'plan',
      'build',
      'critic',
    ]);
    const usage = ev.filter((e) => e.type === 'usage');
    expect(usage.map((u) => u.engineId)).toEqual(['claude-code', 'codex', 'antigravity']);
    expect(usage.every((u) => u.costUsd! > 0 && u.costEstimated)).toBe(true);
    expect(usage[0]!.costUsd).toBe(estimateCost('claude-code', usage[0]!.inputTokens!, 400));
  });

  it('오버레이: 진행 중 상태·누적 비용, nodeId 없는 usage는 현재 노드에', () => {
    const ids = ['a', 'b'];
    const mid = overlayFromEvents(
      [
        { type: 'node_start', nodeId: 'a' },
        { type: 'usage', costUsd: 0.01 },
      ],
      ids,
    );
    expect(mid).toMatchObject({
      a: { status: 'running', costUsd: 0.01, order: 1 },
      b: { status: 'pending', costUsd: 0 },
    });
    const end = overlayFromEvents(
      [
        { type: 'node_start', nodeId: 'a' },
        { type: 'usage', costUsd: 0.01 },
        { type: 'node_end', nodeId: 'a', status: 'completed' },
        { type: 'node_start', nodeId: 'b' },
        { type: 'usage', costUsd: 0.02 },
        { type: 'node_end', nodeId: 'b', status: 'incomplete' },
      ],
      ids,
    );
    expect(end.a!.status).toBe('completed');
    expect(end.b!.status).toBe('incomplete');
    expect(totalCost(end)).toBe(0.03);
  });

  it('화면: 시험 실행 → 캔버스 노드에 단계별 진행·비용 배지', () => {
    vi.useFakeTimers();
    const r = graphFromYaml(DESIGN_QA);
    if (!r.ok) throw new Error('fixture');
    const catalog = {
      ...DEFAULT_CATALOG,
      agents: [{ id: 'dqa', label: 'DQA', pipeline: r.pipeline }],
    };
    render(<BuilderPage route="/builder/new" catalog={catalog} dryRunStepMs={100} />);
    fireEvent.click(screen.getByText('기존 에이전트 복제'));
    fireEvent.click(screen.getByText('DQA'));
    fireEvent.click(screen.getByRole('tab', { name: '시험 실행' }));
    fireEvent.click(screen.getByText('시험 실행', { selector: 'button.hx-insp-btn' }));
    const badge = (id: string) =>
      document.querySelector(`.hx-node[data-node-id="${id}"] .hx-run-badge`)?.getAttribute('data-status');
    expect(badge('plan')).toBe('pending');
    act(() => vi.advanceTimersByTime(100)); // plan node_start
    expect(badge('plan')).toBe('running');
    expect(badge('build')).toBe('pending');
    act(() => vi.advanceTimersByTime(100 * 8)); // 끝까지 (이벤트 9개)
    expect(['plan', 'build', 'critic'].map(badge)).toEqual(['completed', 'completed', 'completed']);
    expect(screen.getByTestId('dryrun-total').textContent).toMatch(/\$0\.\d+/);
    fireEvent.click(screen.getByText('오버레이 지우기'));
    expect(badge('plan')).toBeUndefined();
  });
});
