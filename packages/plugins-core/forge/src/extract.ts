import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ChecklistItem } from '@harness-x/checklist-ledger';
import type { LogRecord } from '@harness-x/kernel';
import { validateSkillMd } from '@harness-x/sdk';

/**
 * T-053 53.1 완료 세션 → SKILL.md
 * 세션의 체크리스트(항목 제목·acceptance)와 궤적(이벤트 로그의 tool_call 명령)에서
 * - 반복 단계: 제목이 같은 틀(다른 낱말만 자리표시)인 항목 → 하나의 일반화된 단계
 * - 명령: 두 번 이상 실행한 명령(파일 경로·숫자는 자리표시로)
 * - 검증: 항목 acceptance의 command/test 명령, file_exists 등 (중복 제거)
 * 를 뽑아 프런트매터(name·description)가 있는 SKILL.md로 쓴다. 결과는 validateSkillMd를 통과한다.
 */

export interface SessionMaterial {
  items: ChecklistItem[];
  events: LogRecord[];
  /** 세션 요청문 (설명에 쓴다) */
  request?: string;
}

export interface ExtractedStep {
  /** 일반화한 제목 (<…>는 바뀌는 자리) */
  title: string;
  /** 이 틀에 들어맞은 항목 수 */
  count: number;
  examples: string[];
}

export interface ExtractedCommand {
  command: string;
  count: number;
}

export interface ExtractedSkill {
  name: string;
  description: string;
  steps: ExtractedStep[];
  commands: ExtractedCommand[];
  verifications: string[];
  markdown: string;
}

const SLOT = '<…>';
const PATHLIKE = /[/\\]|\.[a-z0-9]{1,5}$|^\d+$/i;

/** 명령 일반화: 파일 경로·숫자 낱말 → <path>/<n> */
export function generalizeCommand(cmd: string): string {
  return cmd
    .trim()
    .split(/\s+/)
    .map((w, i) =>
      i === 0 || w.startsWith('-') ? w : /^\d+$/.test(w) ? '<n>' : PATHLIKE.test(w) ? '<path>' : w,
    )
    .join(' ');
}

/** 두 제목이 같은 틀이면 일반화한 틀, 아니면 undefined (낱말 수가 같고 절반 넘게 같을 때) */
function template(a: string[], b: string[]): string[] | undefined {
  if (a.length !== b.length || a.length < 2) return undefined;
  let same = 0;
  const out = a.map((w, i) => {
    if (w === b[i]) {
      same++;
      return w;
    }
    return SLOT;
  });
  return same * 2 > a.length ? out : undefined;
}

export function generalizeSteps(titles: string[]): ExtractedStep[] {
  const groups: { words: string[]; examples: string[] }[] = [];
  for (const t of titles) {
    const words = t.trim().split(/\s+/);
    const g = groups.find((x) => template(x.words, words));
    if (g) {
      g.words = template(g.words, words)!;
      g.examples.push(t);
    } else groups.push({ words, examples: [t] });
  }
  return groups.map((g) => ({ title: g.words.join(' '), count: g.examples.length, examples: g.examples }));
}

function commandOf(input: unknown): string | undefined {
  if (typeof input === 'string') return input;
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>;
    for (const k of ['command', 'cmd']) if (typeof o[k] === 'string') return o[k] as string;
    if (Array.isArray(o.argv)) return o.argv.map(String).join(' ');
  }
  return undefined;
}

export function repeatedCommands(events: readonly LogRecord[], min = 2): ExtractedCommand[] {
  const counts = new Map<string, number>();
  for (const e of events) {
    if (e.type !== 'tool_call') continue;
    const c = commandOf(e.input);
    if (!c) continue;
    const g = generalizeCommand(c);
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= min)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([command, count]) => ({ command, count }));
}

export function verificationsOf(items: readonly ChecklistItem[]): string[] {
  const out = new Set<string>();
  for (const it of items)
    for (const a of it.acceptance) {
      if (a.type === 'command' || a.type === 'test')
        out.add(`\`${generalizeCommand(a.run)}\` 종료코드 ${a.expectExit}`);
      else if (a.type === 'file_exists') out.add(`산출물 파일 존재${a.file ? `: ${a.file}` : ''}`);
      else if (a.type === 'symbol') out.add(`심볼 \`${a.symbol}\` 존재`);
      else if (a.type === 'schema') out.add(`JSON 필수 키: ${a.requiredKeys.join(', ')}`);
    }
  return [...out];
}

const kebab = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');

export function extractSkill(
  m: SessionMaterial,
  opts: { name: string; description?: string },
): ExtractedSkill {
  const name = kebab(opts.name) || 'extracted-skill';
  const done = m.items.filter((i) => i.status === 'done');
  const steps = generalizeSteps((done.length ? done : m.items).map((i) => i.title));
  const commands = repeatedCommands(m.events);
  const verifications = verificationsOf(done.length ? done : m.items);
  const repeated = steps.filter((s) => s.count > 1).length;
  const description =
    opts.description ??
    `${m.request ? `${m.request.replace(/\s+/g, ' ').trim()} — ` : ''}완료 세션에서 추출한 절차 (단계 ${steps.length}개, 반복 ${repeated}개, 명령 ${commands.length}개, 검증 ${verifications.length}개)`;
  const yamlStr = (s: string) => JSON.stringify(s);
  const lines = [
    '---',
    `name: ${name}`,
    `description: ${yamlStr(description)}`,
    '---',
    '',
    `# ${name}`,
    '',
    '## 언제 쓰나',
    '',
    `- ${m.request?.trim() || '같은 종류의 작업을 다시 할 때'}`,
    '',
    '## 절차',
    '',
    ...steps.map(
      (s, i) =>
        `${i + 1}. ${s.title}${s.count > 1 ? ` (반복 ${s.count}회 — 예: ${s.examples.join(' / ')})` : ''}`,
    ),
    '',
  ];
  if (commands.length)
    lines.push('## 자주 쓰는 명령', '', ...commands.map((c) => `- \`${c.command}\` (${c.count}회)`), '');
  if (verifications.length) lines.push('## 검증', '', ...verifications.map((v) => `- ${v}`), '');
  const markdown = lines.join('\n');
  const check = validateSkillMd(markdown);
  if (!check.ok) throw new Error(`추출한 SKILL.md가 검증을 통과하지 못함: ${check.errors.join('; ')}`);
  return { name, description, steps, commands, verifications, markdown };
}

/** 세션 폴더(<workspace>/.harness-x/sessions/<id>/ 아래 모든 checklist.json) + 이벤트 로그 */
export function loadSessionMaterial(
  workspace: string,
  sessionId: string,
  log: { query(q: { sessionId: string }): LogRecord[] },
  request?: string,
): SessionMaterial {
  const root = join(workspace, '.harness-x', 'sessions', sessionId);
  const items: ChecklistItem[] = [];
  const visit = (d: string) => {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) visit(full);
      else if (name === 'checklist.json') {
        const c = JSON.parse(readFileSync(full, 'utf8')) as { items?: ChecklistItem[] };
        items.push(...(c.items ?? []));
      }
    }
  };
  visit(root);
  return { items, events: log.query({ sessionId }), ...(request ? { request } : {}) };
}
