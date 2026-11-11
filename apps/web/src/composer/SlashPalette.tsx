import type { AgentSummary } from '@harness-x/protocol';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { containsMatch, fuzzyFilter } from './fuzzy.js';
import './slash.css';

/**
 * / 팔레트(컨셉 D): 입력 맨 앞에 /를 치면 입력창 바로 위에 뜬다.
 * 그룹: 에이전트 / 플러그인 명령 / 스킬 / 내장 명령. 한글 초성 검색. ↑↓ 이동, Enter·Tab 선택, Esc 닫기.
 * 에이전트·플러그인 명령을 고르면 입력창 앞에 칩으로 고정된다(× 로 해제).
 */

export type PaletteGroup = 'agent' | 'plugin' | 'skill' | 'builtin';

export const PALETTE_GROUPS: PaletteGroup[] = ['agent', 'plugin', 'skill', 'builtin'];
export const PALETTE_GROUP_LABEL: Record<PaletteGroup, string> = {
  agent: '에이전트',
  plugin: '플러그인 명령',
  skill: '스킬',
  builtin: '내장 명령',
};

export interface PaletteItem {
  id: string;
  group: PaletteGroup;
  /** /이름 */
  command: string;
  name: string;
  description?: string;
  icon?: string;
  nodeCount?: number;
  defaultEngine?: string;
  /** T-100 P4-F.6 빈 칸이 남은 에이전트 (회색, 실행 안 됨) */
  incomplete?: boolean;
}

export interface PaletteSkill {
  id: string;
  label: string;
  description?: string;
}

export const BUILTIN_COMMANDS: PaletteItem[] = [
  {
    id: 'engines',
    group: 'builtin',
    command: '/engines',
    name: '엔진',
    icon: '⚙',
    description: '감지된 엔진·로그인 상태',
  },
  {
    id: 'checklist',
    group: 'builtin',
    command: '/checklist',
    name: '체크리스트',
    icon: '☑',
    description: '현재 세션 체크리스트 보기',
  },
  {
    id: 'resume',
    group: 'builtin',
    command: '/resume',
    name: '이어하기',
    icon: '↺',
    description: '지난 세션 이어서 실행',
  },
];

/** 칩으로 고정되는 그룹 */
export const pinsChip = (it: PaletteItem) => it.group === 'agent' || it.group === 'plugin';

export function paletteItems(
  agents: readonly AgentSummary[],
  skills: readonly PaletteSkill[] = [],
): PaletteItem[] {
  const fromAgent = (a: AgentSummary): PaletteItem => ({
    id: a.name,
    group: a.source === 'plugin' ? 'plugin' : 'agent',
    command: a.command,
    name: a.displayName,
    ...(a.description ? { description: a.description } : {}),
    ...(a.icon ? { icon: a.icon } : {}),
    nodeCount: a.nodeCount,
    defaultEngine: a.defaultEngine,
    ...(a.status === 'incomplete' ? { incomplete: true } : {}),
  });
  return [
    ...agents.map(fromAgent),
    ...skills.map((s): PaletteItem => ({
      id: s.id,
      group: 'skill',
      command: `/${s.id}`,
      name: s.label,
      icon: '◇',
      ...(s.description ? { description: s.description } : {}),
    })),
    ...BUILTIN_COMMANDS,
  ];
}

/** 입력이 '/검색어'(공백 전)이면 검색어, 아니면 undefined */
export function slashQuery(text: string): string | undefined {
  const m = /^\/(\S*)$/.exec(text);
  return m ? m[1]! : undefined;
}

/** 검색 후 그룹 순서대로 (그룹 안은 점수순) */
export function filterPalette(items: readonly PaletteItem[], query: string): PaletteItem[] {
  // 이름·명령은 퍼지(부분 순서열), 설명은 연속 일치만
  const fuzzy = fuzzyFilter(items, query, (x) => [x.command.slice(1), x.name, x.id]);
  const byDesc = items.filter(
    (x) => !fuzzy.includes(x) && x.description !== undefined && containsMatch(query, x.description),
  );
  const hits = [...fuzzy, ...byDesc];
  return PALETTE_GROUPS.flatMap((g) => hits.filter((x) => x.group === g));
}

export interface SlashPaletteProps {
  items: PaletteItem[];
  activeIndex: number;
  onSelect: (it: PaletteItem) => void;
  onHover?: (index: number) => void;
}

export function SlashPalette({ items, activeIndex, onSelect, onHover }: SlashPaletteProps) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex]);
  let i = -1;
  return (
    <div className="hx-slash" role="listbox" aria-label="명령 팔레트" id="hx-slash-list" ref={listRef}>
      {items.length === 0 && <p className="hx-slash__empty">맞는 명령이 없습니다</p>}
      {PALETTE_GROUPS.map((g) => {
        const rows = items.filter((x) => x.group === g);
        if (rows.length === 0) return null;
        return (
          <div key={g} role="group" aria-label={PALETTE_GROUP_LABEL[g]} className="hx-slash__group">
            <div className="hx-slash__group-title" aria-hidden="true">
              {PALETTE_GROUP_LABEL[g]}
            </div>
            {rows.map((it) => {
              i++;
              const idx = i;
              return (
                <div
                  key={`${it.group}:${it.id}`}
                  id={`hx-slash-${idx}`}
                  role="option"
                  aria-selected={idx === activeIndex}
                  className="hx-slash__row"
                  data-status={it.incomplete ? 'incomplete' : undefined}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => onHover?.(idx)}
                  onClick={() => onSelect(it)}
                >
                  <span className="hx-slash__icon" aria-hidden="true">
                    {it.icon ?? '✦'}
                  </span>
                  <span className="hx-slash__name">
                    <span className="hx-mono">{it.command}</span> {it.name}
                  </span>
                  <span className="hx-slash__desc">{it.description ?? ''}</span>
                  <span className="hx-slash__meta">
                    {it.nodeCount !== undefined && (
                      <span className="hx-slash__nodes">노드 {it.nodeCount}</span>
                    )}
                    {it.defaultEngine && <span className="hx-slash__engine">{it.defaultEngine}</span>}
                    {it.incomplete && <span className="hx-slash__incomplete">빈 칸을 먼저 채워 주세요</span>}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export interface UseSlashPaletteOptions {
  agents?: readonly AgentSummary[];
  skills?: readonly PaletteSkill[];
  text: string;
  setText: (t: string) => void;
}

/** 입력창에 붙이는 팔레트 상태: 열림·검색·키보드·에이전트 칩 */
export function useSlashPalette({ agents = [], skills = [], text, setText }: UseSlashPaletteOptions) {
  const [dismissed, setDismissed] = useState<string>();
  const [active, setActive] = useState(0);
  const [agent, setAgent] = useState<PaletteItem>();
  const all = useMemo(() => paletteItems(agents, skills), [agents, skills]);
  const query = slashQuery(text);
  const open = query !== undefined && dismissed !== text;
  const items = useMemo(() => (query === undefined ? [] : filterPalette(all, query)), [all, query]);

  useEffect(() => setActive(0), [query]);

  const select = (it: PaletteItem) => {
    if (pinsChip(it)) {
      setAgent(it);
      setText('');
    } else setText(`${it.command} `);
    setDismissed(undefined);
  };

  /** 팔레트가 키를 처리했으면 true (입력창은 기본 동작을 하지 않는다) */
  const onKeyDown = (e: KeyboardEvent): boolean => {
    if (!open) return false;
    const n = items.length;
    switch (e.key) {
      case 'ArrowDown':
        if (n) setActive((a) => (a + 1) % n);
        break;
      case 'ArrowUp':
        if (n) setActive((a) => (a - 1 + n) % n);
        break;
      case 'Enter':
      case 'Tab': {
        if (e.shiftKey && e.key === 'Enter') return false;
        const it = items[Math.min(active, n - 1)];
        if (!it) return false;
        select(it);
        break;
      }
      case 'Escape':
        setDismissed(text);
        break;
      default:
        return false;
    }
    e.preventDefault();
    return true;
  };

  const popover = open ? (
    <SlashPalette items={items} activeIndex={active} onSelect={select} onHover={setActive} />
  ) : null;

  const chip = agent ? (
    <span className="hx-agent-chip" data-group={agent.group} aria-label={`에이전트 ${agent.name}`}>
      <span aria-hidden="true">{agent.icon ?? '✦'}</span>
      <span className="hx-mono">{agent.command}</span>
      <button
        type="button"
        className="hx-agent-chip__x"
        aria-label={`${agent.name} 에이전트 해제`}
        onClick={() => setAgent(undefined)}
      >
        ×
      </button>
    </span>
  ) : null;

  return {
    open,
    items,
    activeIndex: active,
    agent,
    clearAgent: () => setAgent(undefined),
    onKeyDown,
    popover,
    chip,
    inputProps: open
      ? {
          'aria-controls': 'hx-slash-list',
          'aria-activedescendant': items.length
            ? `hx-slash-${Math.min(active, items.length - 1)}`
            : undefined,
        }
      : {},
  };
}
