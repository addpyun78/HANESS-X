import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ChecklistLedger, type ChecklistItemInput } from '@harness-x/checklist-ledger';
import { eventFactory, type LogRecord } from '@harness-x/kernel';
import { jsonBlocks, isNodeOutputTool, type GateVerifier } from '@harness-x/agent-builder';
import type { EngineAdapter, EngineRun, EngineRunOptions, HarnessEvent, RoleNode } from '@harness-x/protocol';
import { ForgeBroker, type ForgeCard } from './broker.js';
import {
  MAX_QUESTIONS,
  draftSpec,
  nextQuestion,
  type ForgeAnswer,
  type InterviewAnswers,
} from './interview.js';
import { applyFiles, currentBody, scaffoldFromSpec } from './scaffold.js';
import { FORGE_SPEC_FILE, validateForgeSpec, type ForgeSpec } from './spec.js';

/**
 * Forge 실행 (T-051)
 * /forge 파이프라인의 role 노드는 Forge 엔진 래퍼가 맡는다.
 * - interview: 질문 카드(approval_request kind=forge_question)를 하나씩 띄우고 답을 기다린다 (엔진 불필요)
 * - spec:      답으로 초안을 만들고 엔진(LLM)에 다듬게 한 뒤 스키마 검증 → forge-spec.json → 확인 카드(forge_spec)
 * - scaffold:  spec으로 템플릿을 채우고 엔진이 쓴 본문(JSON {files})을 얹는다. 체크리스트 항목 body를 done으로
 * - install:   설치기(T-052)가 있으면 설치 카드(forge_install) → 승인 시 설치
 * check/test gate는 runnerOptions().verify가 판정한다(검사기·샌드박스는 주입, T-052).
 * 상태는 <workspace>/.harness-x/forge/<sessionId>/ (forge-spec.json, plugin/).
 */

export const FORGE_PIPELINE = 'forge';
export const SCAFFOLD_TEMPLATE = 'forge-scaffold';
export const SCAFFOLD_ITEM = 'body';

export interface ForgeSessionState {
  sessionId: string;
  request: string;
  workspace: string;
  /** <workspace>/.harness-x/forge/<sessionId> */
  dir: string;
  /** 만들어지는 플러그인 폴더 */
  pluginDir: string;
  answers: InterviewAnswers;
  questions: number;
  spec?: ForgeSpec;
  /** spec 노드에서 엔진 출력이 스키마를 통과하지 못해 초안을 쓴 경우 그 오류 */
  specErrors?: string[];
  scaffoldRuns: number;
  /** gate 판정 기록 (순서대로) */
  gates: { gate: string; attempt: number; ok: boolean; reasons: string[] }[];
  installed?: unknown;
}

export interface GateOutcome {
  ok: boolean;
  /** 실패 사유 (scaffold 재작성 지시에 들어간다) */
  reasons: string[];
  /** 기록용 상세 */
  detail?: Record<string, unknown>;
}

export interface ForgeInstaller {
  /** 설치 카드 내용 (파일 diff·권한 요약·경고) */
  card(state: ForgeSessionState): Record<string, unknown> | Promise<Record<string, unknown>>;
  install(state: ForgeSessionState): unknown;
}

export interface ForgeOptions {
  broker: ForgeBroker;
  log?: { append(rec: LogRecord): unknown };
  /** check gate (기본: 통과) */
  check?: (state: ForgeSessionState) => GateOutcome | Promise<GateOutcome>;
  /** test gate (기본: 통과) */
  test?: (state: ForgeSessionState) => GateOutcome | Promise<GateOutcome>;
  installer?: ForgeInstaller;
}

export interface ForgeRunInput {
  sessionId: string;
  request: string;
  workspace: string;
  /** 엔진(LLM) 조회. 없거나 undefined면 결정적 경로만 (spec 초안·템플릿 본문) */
  engines?: (id: string) => EngineAdapter | undefined;
}

export const forgeDir = (workspace: string, sessionId: string) =>
  join(workspace, '.harness-x', 'forge', sessionId);

const SCAFFOLD_ITEMS: ChecklistItemInput[] = [
  {
    id: SCAFFOLD_ITEM,
    title: 'spec대로 플러그인 본문 작성',
    artifactId: 'forge.body',
    acceptance: [{ type: 'command', run: 'true' }],
  },
];

export class Forge {
  readonly sessions = new Map<string, ForgeSessionState>();

  constructor(readonly opts: ForgeOptions) {}

  get broker(): ForgeBroker {
    return this.opts.broker;
  }

  session(sessionId: string): ForgeSessionState | undefined {
    return this.sessions.get(sessionId);
  }

  private state(i: ForgeRunInput): ForgeSessionState {
    let s = this.sessions.get(i.sessionId);
    if (!s) {
      const dir = forgeDir(i.workspace, i.sessionId);
      s = {
        sessionId: i.sessionId,
        request: i.request,
        workspace: i.workspace,
        dir,
        pluginDir: join(dir, 'plugin'),
        answers: {},
        questions: 0,
        scaffoldRuns: 0,
        gates: [],
      };
      this.sessions.set(i.sessionId, s);
    }
    return s;
  }

  /** PipelineRunner에 넘길 옵션: 엔진 래퍼 + gate 판정 + scaffold 체크리스트 */
  runnerOptions(i: ForgeRunInput): {
    engines: (id: string) => EngineAdapter;
    defaultEngine: string;
    verify: GateVerifier;
    checklists: (node: RoleNode, template: string | undefined) => ChecklistItemInput[] | undefined;
  } {
    const state = this.state(i);
    return {
      engines: (id) => this.wrap(id === 'forge' ? undefined : i.engines?.(id), state),
      defaultEngine: 'forge',
      checklists: (_node, template) => (template === SCAFFOLD_TEMPLATE ? SCAFFOLD_ITEMS : undefined),
      verify: async ({ gate, attempt }) => {
        const fn = gate.id === 'check' ? this.opts.check : gate.id === 'test' ? this.opts.test : undefined;
        const r: GateOutcome = fn ? await fn(state) : { ok: true, reasons: [] };
        state.gates.push({ gate: gate.id, attempt, ok: r.ok, reasons: r.reasons });
        this.record(state.sessionId, `forge_${gate.id}`, {
          attempt,
          ok: r.ok,
          reasons: r.reasons,
          ...(r.detail ? { detail: r.detail } : {}),
        });
        return {
          failed: r.ok
            ? []
            : [
                {
                  nodeId: 'scaffold',
                  itemId: SCAFFOLD_ITEM,
                  reason: r.reasons.join('; ') || `${gate.id} 실패`,
                },
              ],
        };
      },
    };
  }

  private record(sessionId: string, type: string, body: Record<string, unknown>) {
    this.opts.log?.append({
      id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ts: new Date().toISOString(),
      sessionId,
      type,
      ...body,
    });
  }

  /** 엔진 래퍼: 노드(HARNESS_X_NODE)마다 하네스 단계 + 필요한 곳만 엔진 */
  wrap(inner: EngineAdapter | undefined, state: ForgeSessionState): EngineAdapter {
    const steps = {
      interview: this.interview.bind(this),
      spec: this.spec.bind(this),
      scaffold: this.scaffold.bind(this),
      install: this.install.bind(this),
    };
    const id = inner?.id ?? 'forge';
    return {
      id,
      displayName: inner ? `Forge · ${inner.displayName}` : 'Forge',
      capabilities: {
        nativeStopHook: false,
        resume: false,
        mcp: inner?.capabilities.mcp ?? false,
        interrupt: true,
      },
      run(o: EngineRunOptions): EngineRun {
        let innerRun: EngineRun | undefined;
        let sid: string | undefined;
        let resolveDone!: (v: { exitCode: number | null }) => void;
        const done = new Promise<{ exitCode: number | null }>((r) => (resolveDone = r));
        const ev = eventFactory({ sessionId: o.sessionId, engineId: id });
        const callInner = async function* (prompt: string): AsyncGenerator<HarnessEvent, HarnessEvent[]> {
          const got: HarnessEvent[] = [];
          if (!inner) return got;
          innerRun = inner.run({ ...o, prompt });
          for await (const e of innerRun.events) {
            got.push(e);
            if (e.type === 'turn_end') continue;
            yield e;
          }
          sid = innerRun.engineSessionId() ?? sid;
          return got;
        };
        const node = o.env?.HARNESS_X_NODE ?? '';
        async function* events(): AsyncGenerator<HarnessEvent> {
          try {
            switch (node) {
              case 'interview':
                yield* steps.interview(state, o, ev);
                break;
              case 'spec':
                yield* steps.spec(state, o, ev, callInner);
                break;
              case 'scaffold':
                yield* steps.scaffold(state, o, ev, callInner);
                break;
              case 'install':
                yield* steps.install(state, o, ev);
                break;
              default: {
                const got = yield* callInner(o.prompt);
                const end = got.find((e) => e.type === 'turn_end');
                if (end) yield end;
                else yield ev({ type: 'turn_end', reason: 'completed' });
                return;
              }
            }
            yield ev({ type: 'turn_end', reason: 'completed' });
          } catch (err) {
            yield ev({
              type: 'error',
              code: 'unknown',
              message: err instanceof Error ? err.message : String(err),
            });
            yield ev({ type: 'turn_end', reason: o.signal?.aborted ? 'interrupted' : 'error' });
          } finally {
            resolveDone({ exitCode: 0 });
          }
        }
        return {
          events: events(),
          engineSessionId: () => sid,
          interrupt: async () => {
            await innerRun?.interrupt();
          },
          done,
        };
      },
    };
  }

  // ── 카드 ───────────────────────────────────────────────────
  /** 카드를 먼저 등록하고(답이 바로 와도 놓치지 않게) approval_request 이벤트를 낸다 */
  private async *card(
    card: ForgeCard,
    ev: Ev,
    signal?: AbortSignal,
  ): AsyncGenerator<HarnessEvent, ForgeAnswer> {
    const answer = this.broker.ask(card, signal);
    yield ev({
      type: 'approval_request',
      approvalId: card.approvalId,
      kind: card.kind,
      title: card.title,
      options: card.options,
      detail: {
        ...(card.detail ?? {}),
        ...(card.multiple ? { multiple: true } : {}),
        ...(card.allowText ? { allowText: true } : {}),
      },
    });
    return await answer;
  }

  // ── 51.2 interview ─────────────────────────────────────────
  private async *interview(s: ForgeSessionState, o: EngineRunOptions, ev: Ev): AsyncGenerator<HarnessEvent> {
    for (let q = nextQuestion(s.request, s.answers); q && s.questions < MAX_QUESTIONS;) {
      s.questions++;
      const a = yield* this.card(
        {
          approvalId: `${s.sessionId}:q${q.index}`,
          sessionId: s.sessionId,
          kind: 'forge_question',
          title: q.title,
          options: q.choices.map((c) => c.value),
          ...(q.multiple ? { multiple: true } : {}),
          ...(q.allowText ? { allowText: true } : {}),
          detail: {
            questionId: q.id,
            index: q.index,
            total: q.total,
            choices: q.choices,
            ...(q.suggested !== undefined ? { suggested: q.suggested } : {}),
          },
        },
        ev,
        o.signal,
      );
      s.answers[q.id] = a;
      q = nextQuestion(s.request, s.answers);
    }
    yield ev({
      type: 'assistant_text',
      text: '인터뷰 완료\n```json\n' + JSON.stringify({ request: s.request, answers: s.answers }) + '\n```',
      partial: false,
    });
  }

  // ── 51.3 spec ──────────────────────────────────────────────
  private async *spec(
    s: ForgeSessionState,
    o: EngineRunOptions,
    ev: Ev,
    callInner: CallInner,
  ): AsyncGenerator<HarnessEvent> {
    const draft = draftSpec(s.request, s.answers);
    let spec = draft;
    const got = yield* callInner(specPrompt(draft));
    const proposed = lastJson(got);
    if (proposed) {
      const merged = { ...draft, ...proposed, request: s.request };
      const v = validateForgeSpec(merged);
      if (v.ok) spec = v.spec!;
      else {
        s.specErrors = v.errors;
        yield ev({
          type: 'assistant_text',
          text: `엔진이 낸 spec이 스키마를 통과하지 못해 초안을 씁니다: ${v.errors.join('; ')}`,
          partial: false,
        });
      }
    }
    mkdirSync(s.dir, { recursive: true });
    const file = join(s.dir, FORGE_SPEC_FILE);
    writeFileSync(file, JSON.stringify(spec, null, 2) + '\n');
    yield ev({ type: 'file_change', path: file, change: 'create' });
    const a = yield* this.card(
      {
        approvalId: `${s.sessionId}:spec`,
        sessionId: s.sessionId,
        kind: 'forge_spec',
        title: `${spec.displayName} (${spec.kind}) 이렇게 만들까요?`,
        options: ['confirm', 'cancel'],
        detail: { spec, file },
      },
      ev,
      o.signal,
    );
    if (a.value !== 'confirm') throw new Error('사용자가 spec을 취소함');
    s.spec = spec;
    yield ev({
      type: 'assistant_text',
      text:
        'spec 확정\n```json\n' + JSON.stringify({ specFile: file, id: spec.id, kind: spec.kind }) + '\n```',
      partial: false,
    });
  }

  // ── 51.4 scaffold ──────────────────────────────────────────
  private async *scaffold(
    s: ForgeSessionState,
    o: EngineRunOptions,
    ev: Ev,
    callInner: CallInner,
  ): AsyncGenerator<HarnessEvent> {
    const spec = s.spec;
    if (!spec) throw new Error('확정된 spec이 없음');
    s.scaffoldRuns++;
    for (const rel of scaffoldFromSpec(spec, s.pluginDir))
      yield ev({ type: 'file_change', path: join(s.pluginDir, rel), change: 'create' });
    const retry = s.scaffoldRuns > 1 ? o.prompt : undefined;
    const got = yield* callInner(scaffoldPrompt(spec, currentBody(s.pluginDir), retry));
    const out = lastJson(got);
    const files = out && isStringRecord(out.files) ? out.files : undefined;
    if (files) {
      const r = applyFiles(s.pluginDir, files);
      for (const w of r.written)
        yield ev({ type: 'file_change', path: join(s.pluginDir, w.path), change: w.change });
      for (const x of r.rejected) yield ev({ type: 'error', code: 'invalid_request', message: x.reason });
    }
    completeLedger(o);
    yield ev({
      type: 'assistant_text',
      text:
        '스캐폴드 완료\n```json\n' +
        JSON.stringify({ pluginDir: s.pluginDir, files: Object.keys(files ?? {}), run: s.scaffoldRuns }) +
        '\n```',
      partial: false,
    });
  }

  // ── install (설치기는 T-052) ───────────────────────────────
  private async *install(s: ForgeSessionState, o: EngineRunOptions, ev: Ev): AsyncGenerator<HarnessEvent> {
    const inst = this.opts.installer;
    if (!inst || !s.spec) {
      yield ev({ type: 'assistant_text', text: '```json\n{"installed":false}\n```', partial: false });
      return;
    }
    const card = await inst.card(s);
    const a = yield* this.card(
      {
        approvalId: `${s.sessionId}:install`,
        sessionId: s.sessionId,
        kind: 'forge_install',
        title: `${s.spec.displayName} 설치할까요?`,
        options: ['install', 'cancel'],
        detail: card,
      },
      ev,
      o.signal,
    );
    if (a.value !== 'install') {
      yield ev({ type: 'assistant_text', text: '```json\n{"installed":false}\n```', partial: false });
      return;
    }
    s.installed = await inst.install(s);
    yield ev({
      type: 'assistant_text',
      text:
        '설치 완료\n```json\n' + JSON.stringify({ installed: true, ...(s.installed as object) }) + '\n```',
      partial: false,
    });
  }
}

type Ev = ReturnType<typeof eventFactory>;
type CallInner = (prompt: string) => AsyncGenerator<HarnessEvent, HarnessEvent[]>;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStringRecord = (v: unknown): v is Record<string, string> =>
  isRecord(v) && Object.values(v).every((x) => typeof x === 'string');

/** 엔진 출력의 마지막 JSON (node.output 도구 → 마지막 ```json 블록) */
export function lastJson(events: readonly HarnessEvent[]): Record<string, unknown> | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === 'tool_call' && isNodeOutputTool(e.tool)) {
      let raw: unknown = isRecord(e.input) && 'json' in e.input ? e.input.json : e.input;
      if (typeof raw === 'string')
        try {
          raw = JSON.parse(raw);
        } catch {
          /* 무시 */
        }
      if (isRecord(raw)) return raw;
    }
  }
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type !== 'assistant_text' || e.partial) continue;
    const b = jsonBlocks(e.text);
    if (b.length) return b[b.length - 1];
  }
  return undefined;
}

function completeLedger(o: EngineRunOptions) {
  const dir = o.env?.HARNESS_X_CHECKLIST_DIR;
  if (!dir) return;
  const ledger = new ChecklistLedger({ dir, sessionId: o.sessionId });
  const c = ledger.read();
  if (!c) return;
  for (const it of c.items) {
    if (it.status === 'done') continue;
    if (it.status === 'todo' || it.status === 'failed') ledger.transition(it.id, 'doing');
    ledger.transition(it.id, 'verifying', { evidence: { kind: 'forge', summary: '본문 작성됨' } });
    ledger.transition(it.id, 'done');
  }
}

export function specPrompt(draft: ForgeSpec): string {
  return [
    '# Forge spec',
    '사용자 요청과 인터뷰 답으로 만든 forge-spec 초안이다. 빠진 점을 다듬어 같은 형식의 JSON 하나로 답하라.',
    'id·kind·trigger·permissions는 사용자가 고른 값이니 바꾸지 마라. 권한은 꼭 필요한 것만.',
    '```json\n' + JSON.stringify(draft, null, 2) + '\n```',
  ].join('\n\n');
}

export function scaffoldPrompt(spec: ForgeSpec, body: Record<string, string>, retry?: string): string {
  return [
    '# Forge scaffold',
    `spec대로 ${spec.kind} 플러그인 본문을 작성하라. 템플릿 파일을 고쳐 {"files": {"<상대 경로>": "<내용>"}} JSON 하나로 답하라.`,
    '쓸 수 있는 경로: src/**, SKILL.md, README.md, pipelines/**. 매니페스트·package.json·tsconfig.json은 하네스가 관리한다.',
    '격리 실행: Node 내장 모듈(fs, child_process …)을 import하지 말고 ctx.fs / ctx.shell / ctx.net만 써라.',
    '## spec\n```json\n' + JSON.stringify(spec, null, 2) + '\n```',
    ...Object.entries(body).map(([p, c]) => `## 현재 ${p}\n\`\`\`\n${c}\n\`\`\``),
    ...(retry ? [`## 이전 시도가 검사·시험에 실패했다\n${retry}`] : []),
  ].join('\n\n');
}
