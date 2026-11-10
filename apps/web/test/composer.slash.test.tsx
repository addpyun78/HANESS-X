// @vitest-environment jsdom
import type { AgentSummary } from '@harness-x/protocol';
import { AgentListResponseSchema } from '@harness-x/protocol';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HarnessApiClient } from '../src/api/client.js';
import { choseong, fuzzyFilter, fuzzyScore, toChoseong } from '../src/composer/fuzzy.js';
import { filterPalette, paletteItems, slashQuery } from '../src/composer/SlashPalette.js';
import { renderComposer } from './composer.helpers.js';

afterEach(cleanup);

export const AGENTS: AgentSummary[] = [
  {
    name: 'design-qa',
    command: '/design-qa',
    displayName: '디자인 QA',
    description: '계획 → 구현 → 비평',
    icon: '🎨',
    source: 'user',
    defaultEngine: 'claude-code',
    nodeCount: 3,
  },
  {
    name: 'hello',
    command: '/hello',
    displayName: '인사',
    description: '플러그인 단독 에이전트',
    source: 'plugin',
    pluginId: 'hello',
    defaultEngine: 'auto',
    nodeCount: 1,
  },
];
const SKILLS = [{ id: 'a11y-check', label: '접근성 검사', description: 'WCAG 점검' }];

const input = () => screen.getByLabelText('지시 입력') as HTMLTextAreaElement;
const type = (v: string) => fireEvent.change(input(), { target: { value: v } });
const palette = () => screen.queryByRole('listbox', { name: '명령 팔레트' });
const active = () => palette()?.querySelector('[aria-selected="true"]')?.textContent;

describe('47.1 / 입력 시 팔레트', () => {
  it('slashQuery: 맨 앞 /, 공백 전까지만', () => {
    expect(slashQuery('/')).toBe('');
    expect(slashQuery('/des')).toBe('des');
    expect(slashQuery('a/des')).toBeUndefined();
    expect(slashQuery('/design-qa 해줘')).toBeUndefined();
  });

  it('맨 앞 /이면 입력창 위 팝오버로 열리고, 지우면 닫힌다', () => {
    const { container } = renderComposer({ agents: AGENTS, skills: SKILLS });
    expect(palette()).toBeNull();
    type('x/');
    expect(palette()).toBeNull();
    type('/');
    const p = palette()!;
    expect(p).toBeTruthy();
    // 입력창보다 앞(위)에 놓인다
    const box = container.querySelector('.hx-composer')!;
    expect(box.firstElementChild).toBe(p);
    expect(input().getAttribute('aria-controls')).toBe('hx-slash-list');
    type('');
    expect(palette()).toBeNull();
  });

  it('GET /api/agents 클라이언트', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ agents: AGENTS })));
    const c = new HarnessApiClient({
      baseUrl: 'http://x',
      token: 't',
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    const r = await c.agents();
    expect(AgentListResponseSchema.parse(r).agents).toHaveLength(2);
    expect((fetch.mock.calls[0] as unknown[])[0]).toBe('http://x/api/agents');
  });
});

describe('47.2 그룹 (에이전트 / 플러그인 명령 / 스킬 / 내장 명령)', () => {
  it('그룹 순서·내용 (스냅샷)', () => {
    renderComposer({ agents: AGENTS, skills: SKILLS });
    type('/');
    const groups = within(palette()!).getAllByRole('group');
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual([
      '에이전트',
      '플러그인 명령',
      '스킬',
      '내장 명령',
    ]);
    expect(
      within(groups[3]!)
        .getAllByRole('option')
        .map((o) => o.querySelector('.hx-mono')?.textContent),
    ).toEqual(['/engines', '/checklist', '/resume']);
    expect(palette()!.outerHTML).toMatchSnapshot();
  });
});

describe('47.3 퍼지 검색 (한글 초성)', () => {
  it('초성 추출', () => {
    expect(choseong('디')).toBe('ㄷ');
    expect(choseong('a')).toBeUndefined();
    expect(toChoseong('디자인 QA')).toBe('ㄷㅈㅇ QA');
  });

  it('ㄷㅈㅇ → 디자인, 섞어 쓰기, 부분 순서열, 불일치', () => {
    expect(fuzzyScore('ㄷㅈㅇ', '디자인')).toBeDefined();
    expect(fuzzyScore('ㄷㅈ인', '디자인 QA')).toBeDefined();
    expect(fuzzyScore('디자', '디자인')).toBeDefined();
    expect(fuzzyScore('dqa', 'design-qa')).toBeDefined();
    expect(fuzzyScore('ㅂㅍ', '디자인')).toBeUndefined();
    expect(fuzzyScore('ㅈㄷ', '디자인')).toBeUndefined(); // 순서가 다르면 불일치
    // 연속·앞 일치가 더 높은 점수
    expect(fuzzyScore('des', 'design-qa')!).toBeGreaterThan(fuzzyScore('des', 'add-eslint')!);
    expect(fuzzyFilter(['접근성 검사', '디자인 비평', '디자인 QA'], 'ㄷㅈㅇ', (x) => [x])).toEqual([
      '디자인 비평',
      '디자인 QA',
    ]);
  });

  it('팔레트: 초성으로 에이전트 찾기, 그룹 순서 유지', () => {
    const items = paletteItems(AGENTS, SKILLS);
    expect(filterPalette(items, 'ㄷㅈㅇ').map((x) => x.command)).toEqual(['/design-qa']);
    expect(filterPalette(items, 'ㅈㄱ')[0]!.command).toBe('/a11y-check');
    expect(filterPalette(items, 'eng').map((x) => x.command)).toEqual(['/engines']);
    // 설명은 연속 일치만: '감지된 엔진' 설명이 ㄷㅈㅇ 순서열로 걸리지 않는다, ㅇㅈ(엔진)은 걸린다
    expect(filterPalette(items, 'ㅇㅈ').map((x) => x.command)).toContain('/engines');
    renderComposer({ agents: AGENTS, skills: SKILLS });
    type('/ㄷㅈㅇ');
    expect(within(palette()!).getAllByRole('option')).toHaveLength(1);
    type('/없음없음');
    expect(screen.getByText('맞는 명령이 없습니다')).toBeTruthy();
  });
});

describe('47.4 행: 아이콘·이름·설명·노드 수·기본 엔진', () => {
  it('에이전트 행 (스냅샷)', () => {
    renderComposer({ agents: AGENTS });
    type('/design');
    const row = within(palette()!).getAllByRole('option')[0]!;
    expect(row.querySelector('.hx-slash__icon')?.textContent).toBe('🎨');
    expect(row.querySelector('.hx-slash__name')?.textContent).toBe('/design-qa 디자인 QA');
    expect(row.querySelector('.hx-slash__desc')?.textContent).toBe('계획 → 구현 → 비평');
    expect(row.querySelector('.hx-slash__nodes')?.textContent).toBe('노드 3');
    expect(row.querySelector('.hx-slash__engine')?.textContent).toBe('claude-code');
    expect(row.outerHTML).toMatchSnapshot();
  });
});

describe('47.5 키보드: ↑↓ 이동, Enter/Tab 선택, Esc 닫기', () => {
  it('↑↓ 순환 이동, Esc 닫기 (다시 입력하면 열림)', () => {
    renderComposer({ agents: AGENTS, skills: SKILLS });
    type('/');
    expect(active()).toContain('/design-qa');
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(active()).toContain('/hello');
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(active()).toContain('/resume');
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(palette()).toBeNull();
    type('/e');
    expect(palette()).toBeTruthy();
  });

  it('Enter는 전송 대신 선택, Tab도 선택(내장 명령은 입력창에 채움)', () => {
    const { onSend } = renderComposer({ agents: AGENTS, skills: SKILLS });
    type('/hel');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
    expect(palette()).toBeNull();
    expect(screen.getByLabelText('에이전트 인사')).toBeTruthy();

    type('/checkl');
    fireEvent.keyDown(input(), { key: 'Tab' });
    expect(input().value).toBe('/checklist ');
    expect(palette()).toBeNull();
  });
});

describe('47.6 에이전트 칩 고정 (× 해제)', () => {
  it('선택 → 칩, 전송에 에이전트 포함, × 로 해제', () => {
    const { onSend, container } = renderComposer({ agents: AGENTS });
    type('/ㄷㅈ');
    fireEvent.click(within(palette()!).getAllByRole('option')[0]!);
    const chip = screen.getByLabelText('에이전트 디자인 QA');
    expect(chip.textContent).toContain('/design-qa');
    // 칩은 입력창 앞
    expect(chip.compareDocumentPosition(input()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(input().value).toBe('');

    type('홈 화면 점검');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({ text: '홈 화면 점검', agent: '/design-qa' }),
    );
    // 칩은 전송 후에도 고정
    expect(screen.getByLabelText('에이전트 디자인 QA')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('디자인 QA 에이전트 해제'));
    expect(container.querySelector('.hx-agent-chip')).toBeNull();
    type('다시');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onSend.mock.calls[1]![0]).not.toHaveProperty('agent');
  });
});
