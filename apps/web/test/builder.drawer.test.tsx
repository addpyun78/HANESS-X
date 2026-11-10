// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BLOCK_MIME, DEFAULT_CATALOG, drawerBlocks, filterBlocks } from '../src/builder/catalog.js';
import { Drawer, readBlock } from '../src/builder/Drawer.js';

afterEach(cleanup);

const labels = () =>
  within(screen.getByRole('tabpanel'))
    .queryAllByText((_, el) => el?.classList.contains('hx-block__label') ?? false)
    .map((e) => e.textContent);

describe('44.4 블록 서랍 탭·검색', () => {
  it('filterBlocks: 이름·id·설명, 낱말 모두 포함', () => {
    const skills = drawerBlocks(DEFAULT_CATALOG, 'skill');
    expect(filterBlocks(skills, '').length).toBe(skills.length);
    expect(filterBlocks(skills, '디자인').map((b) => b.id)).toEqual([
      'design-brief',
      'frontend-design',
      'design-critique',
    ]);
    expect(filterBlocks(skills, 'A11Y').map((b) => b.id)).toEqual(['a11y-check']);
    expect(filterBlocks(skills, '디자인 비평').map((b) => b.id)).toEqual(['design-critique']);
    expect(filterBlocks(skills, '없는말')).toEqual([]);
  });

  it('탭 5개, 탭 전환과 검색 필터', () => {
    render(<Drawer catalog={DEFAULT_CATALOG} />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      '노드',
      '플러그인',
      '스킬',
      '엔진',
      '도구',
    ]);
    expect(labels()).toHaveLength(7); // 노드 7종
    fireEvent.change(screen.getByLabelText('블록 검색'), { target: { value: '게이트' } });
    expect(labels()).toEqual(['게이트']);

    fireEvent.click(screen.getByRole('tab', { name: '엔진' }));
    fireEvent.change(screen.getByLabelText('블록 검색'), { target: { value: 'co' } });
    expect(labels()).toEqual(['Claude Code', 'Codex']);
    fireEvent.change(screen.getByLabelText('블록 검색'), { target: { value: 'zzz' } });
    expect(screen.getByText('맞는 블록이 없습니다')).toBeTruthy();
  });

  it('블록을 끌면 dataTransfer에 종류·id', () => {
    render(<Drawer catalog={DEFAULT_CATALOG} initialTab="skill" />);
    const data: Record<string, string> = {};
    const dt = { setData: (k: string, v: string) => (data[k] = v), getData: (k: string) => data[k] ?? '' };
    fireEvent.dragStart(screen.getByText('접근성 검사'), { dataTransfer: dt });
    expect(JSON.parse(data[BLOCK_MIME]!)).toEqual({ kind: 'skill', id: 'a11y-check' });
    expect(readBlock(dt as unknown as DataTransfer)).toEqual({ kind: 'skill', id: 'a11y-check' });
    expect(readBlock({ getData: () => '{"kind":"x","id":"y"}' } as unknown as DataTransfer)).toBeUndefined();
  });
});
