// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EMPTY_FILTER, filterOptions, filterSessions, groupByProject } from '../src/shell/filter.js';
import { SessionNav } from '../src/shell/SessionNav.js';
import type { SessionSummary } from '../src/shell/types.js';

afterEach(cleanup);

const S: SessionSummary[] = [
  {
    id: 'a',
    title: 'A',
    status: 'running',
    project: 'harness-x',
    engineId: 'claude-code',
    updatedAt: '2026-11-10T03:00:00Z',
  },
  {
    id: 'b',
    title: 'B',
    status: 'done',
    project: 'blog',
    engineId: 'codex',
    updatedAt: '2026-11-10T05:00:00Z',
  },
  {
    id: 'c',
    title: 'C',
    status: 'done',
    project: 'harness-x',
    engineId: 'codex',
    updatedAt: '2026-11-10T04:00:00Z',
  },
  {
    id: 'd',
    title: 'D',
    status: 'blocked',
    project: 'blog',
    engineId: 'claude-code',
    updatedAt: '2026-11-10T01:00:00Z',
  },
];
const ids = (xs: SessionSummary[]) => xs.map((s) => s.id);

describe('세션 필터·프로젝트 그룹', () => {
  it('상태·프로젝트·엔진 필터 (조합 포함)', () => {
    expect(ids(filterSessions(S, EMPTY_FILTER))).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(filterSessions(S, { ...EMPTY_FILTER, status: 'done' }))).toEqual(['b', 'c']);
    expect(ids(filterSessions(S, { ...EMPTY_FILTER, project: 'blog' }))).toEqual(['b', 'd']);
    expect(ids(filterSessions(S, { ...EMPTY_FILTER, engine: 'codex' }))).toEqual(['b', 'c']);
    expect(ids(filterSessions(S, { status: 'done', project: 'harness-x', engine: 'codex' }))).toEqual(['c']);
    expect(filterSessions(S, { ...EMPTY_FILTER, status: 'error' })).toEqual([]);
  });

  it('프로젝트별 그룹: 최근 세션이 있는 프로젝트 먼저, 안에서는 최근 순', () => {
    const g = groupByProject(S);
    expect(g.map((x) => x.project)).toEqual(['blog', 'harness-x']);
    expect(g.map((x) => ids(x.sessions))).toEqual([
      ['b', 'd'],
      ['c', 'a'],
    ]);
  });

  it('필터 선택지', () => {
    expect(filterOptions(S)).toEqual({ projects: ['blog', 'harness-x'], engines: ['claude-code', 'codex'] });
  });

  it('UI: 엔진 필터를 고르면 목록이 줄어든다', () => {
    render(<SessionNav sessions={S} />);
    expect(screen.getAllByRole('heading').map((h) => h.textContent)).toEqual(['blog', 'harness-x']);
    fireEvent.change(screen.getByLabelText('엔진'), { target: { value: 'claude-code' } });
    fireEvent.change(screen.getByLabelText('상태'), { target: { value: 'blocked' } });
    expect(screen.getAllByRole('heading').map((h) => h.textContent)).toEqual(['blog']);
    expect(screen.getByText('D')).toBeTruthy();
    expect(screen.queryByText('A')).toBeNull();
  });
});
