import type { TemplateKind } from '@harness-x/sdk';
import type { Permissions } from '@harness-x/protocol';
import { ForgeSpecSchema, type ForgeExample, type ForgeSpec, type ForgeSpecInput } from './spec.js';

/**
 * 51.2 인터뷰: 최대 5문항, 선택지 버튼
 * 종류 → 발동 시점 → 입출력 → 권한 → 성공 예시. 앞 답에 따라 뒤 질문의 선택지가 바뀐다.
 * 요청문에서 짐작한 값은 suggested로 표시한다(버튼 강조). 답은 선택지 값(또는 직접 입력한 글).
 */

export const MAX_QUESTIONS = 5;
export const QUESTION_IDS = ['kind', 'trigger', 'io', 'permissions', 'example'] as const;
export type QuestionId = (typeof QUESTION_IDS)[number];

export interface ForgeChoice {
  value: string;
  label: string;
}

export interface ForgeQuestion {
  id: QuestionId;
  /** 1부터 */
  index: number;
  total: number;
  title: string;
  choices: ForgeChoice[];
  /** 요청문에서 짐작한 답 */
  suggested?: string | string[];
  /** 여러 개 고르기 */
  multiple?: boolean;
  /** 직접 입력 허용 */
  allowText?: boolean;
}

export interface ForgeAnswer {
  /** 고른 선택지 값 (multiple이면 배열) */
  value: string | string[];
  /** 직접 입력한 글 */
  text?: string;
}

export type InterviewAnswers = Partial<Record<QuestionId, ForgeAnswer>>;

// ── 요청문에서 짐작 ──────────────────────────────────────────
export interface Inferred {
  kind: TemplateKind;
  hook?: ForgeSpec['trigger']['hook'];
  match?: string;
  command?: string;
  shell: boolean;
  net: boolean;
  words: string[];
}

export function inferFromRequest(request: string): Inferred {
  const r = request.toLowerCase();
  const kind: TemplateKind = /스킬|skill/.test(r)
    ? 'skill'
    : /도구|tool/.test(r)
      ? 'tool'
      : /파이프라인|pipeline/.test(r)
        ? 'pipeline'
        : /패널|panel/.test(r)
          ? 'panel'
          : 'hook';
  let hook: Inferred['hook'];
  if (kind === 'hook') {
    if (/세션.*시작|session start/.test(r)) hook = 'session.start';
    else if (/끝나기 전|종료 전|stop/.test(r)) hook = 'stop.before';
    else if (/입력|프롬프트|prompt/.test(r)) hook = 'prompt.submit';
    else hook = 'tool.before';
  }
  const match = /\bpr\b|pull request|풀 ?리퀘/.test(r)
    ? 'gh pr create'
    : /\bpush\b|푸시/.test(r)
      ? 'git push'
      : /커밋|commit/.test(r)
        ? 'git commit'
        : undefined;
  const command = /kotlin|코틀린/.test(r)
    ? './gradlew ktlintCheck'
    : /eslint|린트|lint/.test(r)
      ? 'npm run lint'
      : /테스트|test/.test(r)
        ? 'npm test'
        : undefined;
  const words = (request.match(/[A-Za-z][A-Za-z0-9]*/g) ?? []).map((w) => w.toLowerCase()).slice(0, 3);
  return {
    kind,
    ...(hook ? { hook } : {}),
    ...(match ? { match } : {}),
    ...(command ? { command } : {}),
    shell: !!command,
    net: /네트워크|http|api 호출|웹훅|webhook/.test(r),
    words,
  };
}

// ── 질문 ─────────────────────────────────────────────────────
const KIND_CHOICES: ForgeChoice[] = [
  { value: 'hook', label: '훅 — 이벤트에 반응하거나 막기' },
  { value: 'skill', label: '스킬 — SKILL.md 지침' },
  { value: 'tool', label: '도구 — 입력을 받아 실행' },
  { value: 'pipeline', label: '파이프라인 — 여러 노드' },
  { value: 'panel', label: '패널 — 화면 오른쪽 패널' },
];

const HOOK_TRIGGERS: ForgeChoice[] = [
  { value: 'tool.before', label: '도구·명령 실행 직전 (막을 수 있음)' },
  { value: 'tool.after', label: '도구·명령 실행 뒤' },
  { value: 'session.start', label: '세션 시작' },
  { value: 'prompt.submit', label: '입력 전송' },
  { value: 'stop.before', label: '에이전트가 끝내기 전' },
  { value: 'turn.end', label: '턴이 끝날 때' },
];

const OTHER_TRIGGERS: ForgeChoice[] = [
  { value: 'manual', label: '직접 부를 때 (/명령)' },
  { value: 'node', label: '역할 노드에 끼울 때' },
];

const HOOK_IO: ForgeChoice[] = [
  { value: 'command-decision', label: '셸 명령 → 허용/차단' },
  { value: 'prompt-decision', label: '입력문 → 허용/차단' },
  { value: 'event-log', label: '이벤트 → 기록만' },
];

const OTHER_IO: ForgeChoice[] = [
  { value: 'text-text', label: '글 → 글' },
  { value: 'files-report', label: '파일 → 보고서' },
];

const IO_TEXT: Record<string, { input: string; output: string }> = {
  'command-decision': {
    input: '실행하려는 셸 명령 (훅 컨텍스트 input.command)',
    output: '허용/차단 결정과 사유',
  },
  'prompt-decision': { input: '사용자 입력문', output: '허용/차단 결정과 사유' },
  'event-log': { input: '훅 이벤트 컨텍스트', output: '로그 한 줄' },
  'text-text': { input: '글', output: '글' },
  'files-report': { input: '워크스페이스 파일', output: '보고서' },
};

const PERMISSION_CHOICES: ForgeChoice[] = [
  { value: 'none', label: '권한 없음' },
  { value: 'fs:read', label: '워크스페이스 읽기' },
  { value: 'fs:write', label: '워크스페이스 쓰기' },
  { value: 'shell', label: '셸 명령 실행' },
  { value: 'net', label: '네트워크' },
];

const first = (a: ForgeAnswer | undefined): string | undefined =>
  a === undefined ? undefined : Array.isArray(a.value) ? a.value[0] : a.value;
const all = (a: ForgeAnswer | undefined): string[] =>
  a === undefined ? [] : Array.isArray(a.value) ? a.value : [a.value];

function answeredKind(answers: InterviewAnswers, inf: Inferred): TemplateKind {
  const k = first(answers.kind);
  return (KIND_CHOICES.some((c) => c.value === k) ? k : inf.kind) as TemplateKind;
}

/** 다음 질문 (다 물었으면 undefined). 질문은 최대 MAX_QUESTIONS개 */
export function nextQuestion(request: string, answers: InterviewAnswers): ForgeQuestion | undefined {
  const inf = inferFromRequest(request);
  const id = QUESTION_IDS.find((q) => answers[q] === undefined);
  if (!id) return undefined;
  const index = QUESTION_IDS.indexOf(id) + 1;
  const base = { id, index, total: MAX_QUESTIONS };
  const kind = answeredKind(answers, inf);
  switch (id) {
    case 'kind':
      return { ...base, title: '무엇을 만들까요?', choices: KIND_CHOICES, suggested: inf.kind };
    case 'trigger':
      return kind === 'hook'
        ? {
            ...base,
            title: '언제 발동할까요?',
            choices: HOOK_TRIGGERS,
            suggested: inf.hook ?? 'tool.before',
            allowText: true,
          }
        : { ...base, title: '언제 쓰나요?', choices: OTHER_TRIGGERS, suggested: 'manual', allowText: true };
    case 'io':
      return kind === 'hook'
        ? {
            ...base,
            title: '무엇을 받아 무엇을 내나요?',
            choices: HOOK_IO,
            suggested: inf.command || inf.match ? 'command-decision' : 'event-log',
          }
        : { ...base, title: '무엇을 받아 무엇을 내나요?', choices: OTHER_IO, suggested: 'text-text' };
    case 'permissions': {
      const sug = [...(inf.shell ? ['shell'] : []), ...(inf.net ? ['net'] : [])];
      return {
        ...base,
        title: '어떤 권한이 필요하나요? (필요한 것만)',
        choices: PERMISSION_CHOICES,
        suggested: sug.length ? sug : ['none'],
        multiple: true,
      };
    }
    case 'example': {
      const choices: ForgeChoice[] =
        kind === 'hook' && inf.command
          ? [
              {
                value: 'fail-blocks',
                label: `${inf.match ?? '대상 명령'} 때 \`${inf.command}\` 실패 → 차단, 성공 → 허용`,
              },
              { value: 'default', label: '기본 예시 (항상 허용)' },
            ]
          : [
              {
                value: 'default',
                label: kind === 'hook' ? '기본 예시 (항상 허용)' : '기본 예시 (활성화 성공)',
              },
            ];
      return {
        ...base,
        title: '성공하면 어떻게 되어야 하나요?',
        choices,
        suggested: choices[0]!.value,
        allowText: true,
      };
    }
  }
}

/** 질문의 제안 답 (테스트·"제안대로" 버튼) */
export function suggestedAnswer(q: ForgeQuestion): ForgeAnswer {
  const s = q.suggested ?? q.choices[0]!.value;
  return { value: s };
}

// ── 답 → spec 초안 ──────────────────────────────────────────
function toPermissions(values: string[]): Permissions {
  const fs: Permissions['fs'] = [];
  if (values.includes('fs:write')) fs.push('workspace:write');
  else if (values.includes('fs:read')) fs.push('workspace:read');
  return { fs, net: [], shell: values.includes('shell') };
}

function pluginId(inf: Inferred, kind: TemplateKind): string {
  const suffix = kind === 'hook' ? 'guard' : kind;
  const words = inf.words.filter((w) => /^[a-z][a-z0-9]*$/.test(w) && w !== suffix);
  return [...(words.length ? words : ['forge']), suffix].join('-').slice(0, 64).replace(/-+$/, '');
}

/** ./gradlew ktlintCheck 처럼 워크스페이스 안 스크립트를 부르는 명령이면, 시험용으로 그 스크립트를 깐다 */
function scriptFor(command: string, exitCode: number): Record<string, string> {
  const m = /^\.\/(\S+)/.exec(command);
  if (!m) return {};
  return {
    [m[1]!]: `#!/bin/sh\necho "forge-sandbox: ${command} → exit ${exitCode}" >&2\nexit ${exitCode}\n`,
  };
}

function examplesFor(
  kind: TemplateKind,
  example: string | undefined,
  inf: Inferred,
  text?: string,
): ForgeExample[] {
  if (kind === 'hook' && example === 'fail-blocks' && inf.command) {
    const target = inf.match ?? 'gh pr create';
    return [
      {
        name: '린트 실패 → 차단',
        input: { tool: 'shell', input: { command: target } },
        files: scriptFor(inf.command, 1),
        expect: { decision: 'block' },
      },
      {
        name: '린트 성공 → 허용',
        input: { tool: 'shell', input: { command: target } },
        files: scriptFor(inf.command, 0),
        expect: { decision: 'allow' },
      },
      {
        name: '관계없는 명령 → 허용',
        input: { tool: 'shell', input: { command: 'ls' } },
        files: scriptFor(inf.command, 1),
        expect: { decision: 'allow' },
      },
    ];
  }
  return [
    {
      name: text?.trim() || '기본',
      input: {},
      files: {},
      expect: kind === 'hook' ? { decision: 'allow' } : {},
    },
  ];
}

/** 요청문 + 인터뷰 답 → spec 초안 (엔진이 다듬기 전) */
export function draftSpec(request: string, answers: InterviewAnswers): ForgeSpec {
  const inf = inferFromRequest(request);
  const kind = answeredKind(answers, inf);
  const trig = first(answers.trigger);
  const hookChoice = HOOK_TRIGGERS.find((c) => c.value === trig)?.value as ForgeSpec['trigger']['hook'];
  const io = IO_TEXT[first(answers.io) ?? ''] ?? IO_TEXT[kind === 'hook' ? 'event-log' : 'text-text']!;
  const perms = toPermissions(all(answers.permissions));
  const example = first(answers.example);
  const id = pluginId(inf, kind);
  const summary = request.trim() || `${kind} 플러그인`;
  const input: ForgeSpecInput = {
    version: 1,
    id,
    displayName: summary.replace(/[\r\n]+/g, ' ').slice(0, 80),
    description: summary,
    kind,
    request,
    trigger: {
      ...(kind === 'hook' ? { hook: hookChoice ?? inf.hook ?? 'tool.before' } : {}),
      ...(inf.match ? { match: inf.match } : {}),
      ...(answers.trigger?.text ? { when: answers.trigger.text } : {}),
    },
    io,
    permissions: perms,
    ...(inf.command && perms.shell ? { command: inf.command } : {}),
    acceptance:
      kind === 'hook' && inf.command && example === 'fail-blocks'
        ? [
            `${inf.match ?? '대상 명령'} 실행 전에 \`${inf.command}\`를 돌린다`,
            '실패(종료코드 ≠ 0)면 block, 성공이면 allow',
            '관계없는 명령은 allow',
          ]
        : ['격리 환경에서 활성화된다'],
    examples: examplesFor(kind, example, inf, answers.example?.text),
  };
  return ForgeSpecSchema.parse(input);
}
