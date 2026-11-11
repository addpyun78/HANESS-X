import { appendFileSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AGENT_FILE,
  AgentDraftSchema,
  AgentNameSchema,
  AgentSchema,
  commandForName,
  draftToPipeline,
  PIPELINE_FILE,
  PipelineSchema,
  stringifyAgent,
  stringifyPipeline,
  type AgentDraft,
  type AgentInput,
} from '@harness-x/protocol';
import type { DraftRecord } from './store.js';

/**
 * 초안 → 에이전트 저장 (사람이 화면에서 누를 때만 — 라우트가 클릭 토큰을 먼저 확인한다, P4-F.2)
 *   F.4 이름·명령 중복 검사(T-043: 이름은 kebab-case, 명령은 /이름), 겹치면 다른 이름 제안
 *   F.5 ~/.harness-x/agents/<이름>/agent.yaml + pipeline.yaml + design-notes.md(요청 원문·대화 요약·버전 기록)
 *   F.6 빈 칸이 남았으면 status: incomplete (실행은 막힌다)
 *   F.8 agents-audit.jsonl 에 (시각, 저장한 사람, 초안 버전, 설계 엔진)
 */

export const DESIGN_NOTES_FILE = 'design-notes.md';
export const AGENTS_AUDIT_FILE = 'agents-audit.jsonl';

export interface SaveDraftInput {
  home: string;
  draft: AgentDraft;
  record?: DraftRecord;
  allowIncomplete?: boolean;
  /** 이미 쓰는 이름·명령 (레지스트리 + 폴더) */
  taken: { names: Iterable<string>; commands: Iterable<string> };
  /** 저장한 사람 (화면 클릭) */
  savedBy: string;
  /** 클릭 토큰 기록 id (토큰 값은 남기지 않는다) */
  gestureId?: string;
  now?: () => Date;
}

export type SaveDraftResult =
  | {
      ok: true;
      name: string;
      command: string;
      dir: string;
      files: string[];
      status: 'ready' | 'incomplete';
    }
  | {
      ok: false;
      status: 400 | 409;
      error: 'invalid_draft' | 'gaps' | 'name_taken';
      message: string;
      errors?: string[];
      suggestion?: { name: string; command: string };
    };

/** 겹치지 않는 이름 제안: name-2, name-3 … */
export function suggestAgentName(
  name: string,
  names: ReadonlySet<string>,
  commands: ReadonlySet<string>,
): string {
  for (let i = 2; ; i++) {
    const n = `${name}-${i}`;
    if (!names.has(n) && !commands.has(commandForName(n))) return n;
  }
}

const issues = (e: { issues: { path: PropertyKey[]; message: string }[] }) =>
  e.issues.map((i) => (i.path.length ? `${i.path.map(String).join('.')}: ` : '') + i.message);

function atomicWrite(file: string, text: string) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

export function designNotes(d: AgentDraft, record: DraftRecord | undefined, savedAt: string): string {
  const lines = [`# ${d.displayName} (${d.command})`, '', `저장: ${savedAt}`, ''];
  lines.push(
    '## 요청 원문',
    '',
    record?.request ? `> ${record.request.replace(/\n/g, '\n> ')}` : '(없음)',
    '',
  );
  lines.push('## 요약', '', ...d.summary.split('\n').map((l) => `- ${l}`), '');
  lines.push('## 대화 요약', '');
  const conv = record?.conversation ?? [];
  if (conv.length === 0) lines.push('(없음)');
  for (const c of conv) lines.push(`- ${c.role === 'user' ? '나' : 'AI'}: ${c.text.split('\n')[0]}`);
  lines.push('', '## 버전 기록', '');
  for (const v of record?.versions ?? [])
    lines.push(`- v${v.v} · ${v.at} · ${v.source}${v.note ? ` · ${v.note}` : ''}`);
  if (d.gaps.length) {
    lines.push('', '## 빈 칸 (채워야 실행돼요)', '');
    for (const g of d.gaps) lines.push(`- ${g.need}${g.nodeId ? ` (${g.nodeId})` : ''}`);
  }
  lines.push('', '## 단계별 이유', '');
  for (const n of d.nodes) lines.push(`- ${n.role} (${n.id}, ${n.engine ?? 'auto'}): ${n.reason}`);
  return lines.join('\n') + '\n';
}

export function saveDraftAgent(i: SaveDraftInput): SaveDraftResult {
  const parsed = AgentDraftSchema.safeParse(i.draft);
  if (!parsed.success)
    return {
      ok: false,
      status: 400,
      error: 'invalid_draft',
      message: '초안 모양이 알맞지 않아요.',
      errors: issues(parsed.error),
    };
  const d = parsed.data;
  if (!AgentNameSchema.safeParse(d.name).success)
    return {
      ok: false,
      status: 400,
      error: 'invalid_draft',
      message: '이름은 영어 소문자와 - 만 쓸 수 있어요.',
    };
  if (d.gaps.length && !i.allowIncomplete)
    return {
      ok: false,
      status: 400,
      error: 'gaps',
      message: '빈 칸을 채우거나 빈 칸 있는 채로 저장을 골라 주세요.',
    };

  // F.4 중복
  const names = new Set(i.taken.names);
  const commands = new Set(i.taken.commands);
  const dir = join(i.home, 'agents', d.name);
  if (names.has(d.name) || commands.has(d.command) || existsSync(join(dir, AGENT_FILE))) {
    const n = suggestAgentName(d.name, names, commands);
    return {
      ok: false,
      status: 409,
      error: 'name_taken',
      message: `이미 있는 이름이에요. "${n}"는 어떨까요?`,
      suggestion: { name: n, command: commandForName(n) },
    };
  }

  const status: 'ready' | 'incomplete' = d.gaps.length ? 'incomplete' : 'ready';
  const pipeline = draftToPipeline(d);
  const p = PipelineSchema.safeParse(pipeline);
  const agent: AgentInput = {
    name: d.name,
    displayName: d.displayName,
    description: d.summary.split('\n')[0]!,
    command: d.command,
    ...(status === 'incomplete' ? { status } : {}),
    pipeline: `./${PIPELINE_FILE}`,
  };
  const a = AgentSchema.safeParse(agent);
  if (!p.success || !a.success)
    return {
      ok: false,
      status: 400,
      error: 'invalid_draft',
      message: '연결 규칙에 맞지 않는 곳이 있어서 저장할 수 없어요.',
      errors: [...(p.success ? [] : issues(p.error)), ...(a.success ? [] : issues(a.error))],
    };

  const at = (i.now?.() ?? new Date()).toISOString();
  mkdirSync(dir, { recursive: true });
  const files = {
    pipeline: join(dir, PIPELINE_FILE),
    notes: join(dir, DESIGN_NOTES_FILE),
    agent: join(dir, AGENT_FILE),
  };
  // pipeline·notes 먼저 → agent.yaml (레지스트리는 agent.yaml이 있어야 읽는다)
  atomicWrite(files.pipeline, stringifyPipeline(pipeline));
  atomicWrite(files.notes, designNotes(d, i.record, at));
  atomicWrite(files.agent, stringifyAgent(agent));

  // F.8 저장 기록
  mkdirSync(i.home, { recursive: true });
  appendFileSync(
    join(i.home, AGENTS_AUDIT_FILE),
    JSON.stringify({
      at,
      action: 'save-agent',
      savedBy: i.savedBy,
      ...(i.gestureId ? { gestureId: i.gestureId } : {}),
      name: d.name,
      command: d.command,
      status,
      draftId: i.record?.id ?? null,
      draftVersion: i.record?.versions.at(-1)?.v ?? null,
      designEngine: i.record?.designEngine ?? null,
    }) + '\n',
  );
  return {
    ok: true,
    name: d.name,
    command: d.command,
    dir,
    files: [files.agent, files.pipeline, files.notes],
    status,
  };
}
