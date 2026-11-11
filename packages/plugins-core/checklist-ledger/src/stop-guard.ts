import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { HookBus, HookResult } from '@harness-x/kernel';
import {
  selectStopStrategy,
  type EngineAdapter,
  type EngineRunOptions,
  type HarnessEvent,
} from '@harness-x/protocol';
import { z } from 'zod';
import { ChecklistLedger, currentItemOf, type EventSink } from './ledger.js';
import { ITEM_STATUSES, type Checklist, type ChecklistItem } from './schema.js';
import type { SessionBudget, StallDetector } from './stall.js';

/**
 * 종료 차단 (T-028)
 * 미완료 항목이 남아 있으면 엔진이 멈추지 못하게 한다. 엔진별 경로:
 *  - claude-code: <workspace>/.claude/settings.local.json에 Stop 훅(scripts/hooks/stop-bridge.mjs)을 세션 동안 임시 주입
 *  - codex: <workspace>/.codex/hooks.json에 같은 브리지를 임시 주입 (+ 하네스 재주입 폴백)
 *  - 훅 없는 엔진(agy·로컬): turn_end 뒤 하네스가 같은 판단(stop.before 훅)을 하고 다음 턴을 자동 전송
 * 판단 규칙(브리지와 동일): 남은 항목 0 → 통과 / stop_hook_active이고 직전 판단 뒤 진척 없음 → 통과(사람에게) / 그 밖 → block
 */

// ── 28.1 상태 ──────────────────────────────────────────────────
export const ChecklistStatusItemSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  status: z.enum(ITEM_STATUSES),
});

export const ChecklistStatusSchema = z
  .object({
    sessionId: z.string().min(1),
    /** 체크리스트가 있는가 (없으면 차단할 것도 없다) */
    exists: z.boolean(),
    total: z.number().int().nonnegative(),
    done: z.number().int().nonnegative(),
    /** done이 아닌 항목 수 */
    remaining: z.number().int().nonnegative(),
    complete: z.boolean(),
    /** 진척 비교용 키 (원장 version + 항목 상태·증거 수) */
    progressKey: z.string(),
    remainingItems: z.array(ChecklistStatusItemSchema),
    next: z
      .object({
        id: z.string().min(1),
        title: z.string(),
        status: z.enum(ITEM_STATUSES),
        /** 엔진에게 줄 다음 항목 지시문 */
        instruction: z.string().min(1),
      })
      .nullable(),
  })
  .strict();
export type ChecklistStatus = z.infer<typeof ChecklistStatusSchema>;

/** 다음 항목 지시문 (브리지 reason·재주입 프롬프트) */
export function nextInstruction(
  item: Pick<ChecklistItem, 'id' | 'title'> & Partial<Pick<ChecklistItem, 'status' | 'evidence'>>,
  remaining: number,
): string {
  // T-100 H.19 승인 카드 "원래 자리로 다시 만들기" → 다음 턴 지시문 앞에 쉬운 말 사유 + 정식 경로
  const last = item.evidence?.at(-1);
  const redo =
    item.status === 'doing' && last?.kind === 'approval_redo' && typeof last.instruction === 'string'
      ? `${last.instruction}\n\n`
      : '';
  return (
    redo +
    `다음 항목 ${item.id}: ${item.title} — 체크리스트에 미완료 항목 ${remaining}개가 남았습니다. ` +
    `멈추지 말고 이 항목을 진행한 뒤 checklist.submit으로 증거를 제출하세요.`
  );
}

export function progressKeyOf(c: Checklist | null): string {
  if (!c) return 'none';
  return `v${c.version}:` + c.items.map((i) => `${i.id}=${i.status}/${i.evidence.length}`).join(',');
}

export function statusOf(sessionId: string, c: Checklist | null): ChecklistStatus {
  const items = c?.items ?? [];
  const rest = items.filter((i) => i.status !== 'done');
  // blocked 항목은 엔진이 더 진행할 수 없다 → 다음 항목 후보에서 제외
  const cur = c ? currentItemOf(c) : null;
  const next = cur ?? rest.find((i) => i.status !== 'blocked') ?? null;
  return ChecklistStatusSchema.parse({
    sessionId,
    exists: c !== null,
    total: items.length,
    done: items.length - rest.length,
    remaining: rest.length,
    complete: rest.length === 0,
    progressKey: progressKeyOf(c),
    remainingItems: rest.map((i) => ({ id: i.id, title: i.title, status: i.status })),
    next: next
      ? {
          id: next.id,
          title: next.title,
          status: next.status,
          instruction: nextInstruction(next, rest.length),
        }
      : null,
  });
}

export function checklistStatus(ledger: ChecklistLedger): ChecklistStatus {
  return statusOf(ledger.sessionId, ledger.read());
}

/** 28.1 GET /api/checklist/:session/status — 커널 API 서버의 `routes` 옵션에 넘긴다 */
export function registerChecklistStatusRoute(
  app: {
    get(
      path: string,
      handler: (
        req: { params: unknown },
        reply: { code(n: number): { send(b: unknown): unknown } },
      ) => Promise<unknown>,
    ): unknown;
  },
  resolveLedger: (sessionId: string) => ChecklistLedger | null | undefined,
): void {
  app.get('/api/checklist/:session/status', async (req, reply) => {
    const { session } = req.params as { session: string };
    const ledger = resolveLedger(session);
    if (!ledger) return reply.code(404).send({ error: 'session_not_found', sessionId: session });
    return checklistStatus(ledger);
  });
}

const SESSION_RE = /^[A-Za-z0-9._-]{1,128}$/;

/** <workspace>/.harness-x/sessions/<id>/checklist.json이 있는 세션의 원장 (없거나 잘못된 id면 null) */
export function workspaceLedgerResolver(workspace: string): (sessionId: string) => ChecklistLedger | null {
  return (sessionId) => {
    if (!SESSION_RE.test(sessionId) || sessionId === '.' || sessionId === '..') return null;
    const dir = join(workspace, '.harness-x', 'sessions', sessionId);
    if (!existsSync(join(dir, 'checklist.json'))) return null;
    return new ChecklistLedger({ dir, sessionId });
  };
}

// ── 판단 ───────────────────────────────────────────────────────
export interface StopDecisionInput {
  /** 엔진이 Stop 훅 때문에 이미 한 번 계속한 상태인가 (claude/codex stop_hook_active) */
  stopHookActive?: boolean;
  /** 직전 block 판단 때의 progressKey */
  lastBlockedKey?: string;
}

export type StopDecision =
  | { decision: 'allow'; reason: string; status: ChecklistStatus }
  | { decision: 'block'; reason: string; status: ChecklistStatus };

export function decideStop(status: ChecklistStatus, input: StopDecisionInput = {}): StopDecision {
  if (status.complete || !status.next)
    return { decision: 'allow', reason: status.exists ? '모든 항목 완료' : '체크리스트 없음', status };
  if (input.stopHookActive && input.lastBlockedKey === status.progressKey)
    return {
      decision: 'allow',
      reason: `진척 없음(남은 ${status.remaining}개) — 사람에게 넘깁니다`,
      status,
    };
  return { decision: 'block', reason: status.next.instruction, status };
}

/** 하네스 측 종료 판단기 (재주입 경로). stop.before 차단형 훅으로 설치할 수 있다 */
export class StopGuard {
  private lastBlockedKey: string | undefined;
  constructor(readonly ledger: ChecklistLedger) {}

  status(): ChecklistStatus {
    return checklistStatus(this.ledger);
  }

  /** stopHookActive: 직전 턴이 차단 뒤 자동 전송된 턴인가 */
  decide(stopHookActive: boolean): StopDecision {
    const d = decideStop(this.status(), {
      stopHookActive,
      ...(this.lastBlockedKey ? { lastBlockedKey: this.lastBlockedKey } : {}),
    });
    this.lastBlockedKey = d.decision === 'block' ? d.status.progressKey : undefined;
    return d;
  }

  /** stop.before 차단형 훅 등록 (ctx.stopHookActive). 결과는 HookBus가 hook_result로 기록 */
  install(hooks: HookBus, opts: { pluginId?: string } = {}): () => void {
    return hooks.onBlocking(
      'stop.before',
      (ctx): HookResult => {
        const d = this.decide(ctx.stopHookActive === true);
        return { decision: d.decision, reason: d.reason };
      },
      { id: 'checklist-ledger:stop-guard', ...(opts.pluginId ? { pluginId: opts.pluginId } : {}) },
    );
  }
}

// ── 28.2 / 28.3 임시 주입·원복 ─────────────────────────────────
export interface TempFileRestore {
  file: string;
  /** 원래 바이트로 되돌린다 (없던 파일이면 지우고, 만든 빈 폴더도 지운다) */
  restore(): void;
}

/** JSON 파일을 세션 동안만 바꿔 쓴다. 원래 내용은 바이트 그대로 보관해 restore()로 되돌린다 */
export function patchJsonTemporarily(
  file: string,
  mutate: (current: Record<string, unknown>) => Record<string, unknown>,
): TempFileRestore {
  const original = existsSync(file) ? readFileSync(file) : null;
  const createdDirs: string[] = [];
  for (let d = dirname(file); !existsSync(d); d = dirname(d)) createdDirs.unshift(d);
  let cur: Record<string, unknown> = {};
  if (original && original.length) {
    const parsed: unknown = JSON.parse(original.toString('utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      cur = parsed as Record<string, unknown>;
    else throw new Error(`JSON 객체가 아닙니다: ${file}`);
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(mutate(structuredClone(cur)), null, 2) + '\n');
  let done = false;
  return {
    file,
    restore() {
      if (done) return;
      done = true;
      if (original) writeFileSync(file, original);
      else {
        rmSync(file, { force: true });
        for (const d of [...createdDirs].reverse()) {
          try {
            if (readdirSync(d).length === 0) rmdirSync(d);
          } catch {
            /* 이미 없음 */
          }
        }
      }
    },
  };
}

export const STOP_BRIDGE_SCRIPT = 'scripts/hooks/stop-bridge.mjs';

export interface StopBridgeCommand {
  /** node 실행 파일 (기본 process.execPath) */
  node?: string;
  /** stop-bridge.mjs 절대 경로 */
  script: string;
  /** 세션 폴더 (checklist.json이 있는 곳) — 또는 statusUrl */
  dir?: string;
  /** GET /api/checklist/:session/status URL */
  statusUrl?: string;
  /** statusUrl 토큰 파일 */
  tokenFile?: string;
  /** 판단 기록(JSONL) 파일 */
  logFile?: string;
  /** 진척 비교 상태 파일 */
  stateFile?: string;
  engineId?: string;
  sessionId?: string;
}

function shq(s: string): string {
  return /^[A-Za-z0-9_./:=@%+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

/** 훅 설정에 넣을 셸 명령 문자열 */
export function stopBridgeCommand(o: StopBridgeCommand): string {
  const args = [o.node ?? process.execPath, o.script];
  const add = (k: string, v: string | undefined) => {
    if (v !== undefined) args.push(k, v);
  };
  add('--dir', o.dir);
  add('--status-url', o.statusUrl);
  add('--token-file', o.tokenFile);
  add('--log', o.logFile);
  add('--state', o.stateFile);
  add('--engine', o.engineId);
  add('--session', o.sessionId);
  return args.map(shq).join(' ');
}

type HookGroup = { matcher?: string; hooks: { type: 'command'; command: string; timeout?: number }[] };

function addStopGroup(cfg: Record<string, unknown>, command: string, timeout: number) {
  const hooks = (cfg.hooks && typeof cfg.hooks === 'object' ? cfg.hooks : {}) as Record<string, unknown>;
  const stop = Array.isArray(hooks.Stop) ? (hooks.Stop as HookGroup[]) : [];
  const group: HookGroup = { hooks: [{ type: 'command', command, timeout }] };
  return { ...cfg, hooks: { ...hooks, Stop: [...stop, group] } };
}

/**
 * 28.2 Claude Code: <workspace>/.claude/settings.local.json의 hooks.Stop에 브리지 명령을 추가.
 * 형식: {"hooks":{"Stop":[{"hooks":[{"type":"command","command":"…","timeout":30}]}]}}
 */
export function injectClaudeStopHook(
  workspace: string,
  command: string,
  opts: { timeoutSec?: number } = {},
): TempFileRestore {
  return patchJsonTemporarily(join(workspace, '.claude', 'settings.local.json'), (cfg) =>
    addStopGroup(cfg, command, opts.timeoutSec ?? 30),
  );
}

/**
 * 28.3 Codex: 프로젝트 로컬 <workspace>/.codex/hooks.json의 hooks.Stop에 브리지 명령을 추가.
 * 가정(codex-cli 0.155, `codex features list`의 hooks=stable): Codex hooks.json은 Claude Code와 같은
 * {"hooks":{"Stop":[{"hooks":[{"type":"command","command":"…","timeout":…}]}]}} 형식이고, Stop 훅 stdout의
 * {"decision":"block","reason":"…"}를 "계속하라"로, stdin의 stop_hook_active를 재진입 표시로 쓴다.
 * 프로젝트 로컬 훅은 신뢰된 프로젝트에서만 읽힐 수 있으므로 하네스 재주입(harness-reinject)을 폴백으로 함께 둔다.
 */
export function injectCodexStopHook(
  workspace: string,
  command: string,
  opts: { timeoutSec?: number } = {},
): TempFileRestore {
  return patchJsonTemporarily(join(workspace, '.codex', 'hooks.json'), (cfg) =>
    addStopGroup(cfg, command, opts.timeoutSec ?? 30),
  );
}

/** 엔진 id → 네이티브 Stop 훅 브리지 주입기 */
export const STOP_BRIDGES: Record<string, typeof injectClaudeStopHook> = {
  'claude-code': injectClaudeStopHook,
  codex: injectCodexStopHook,
};

// ── 브리지 판단 기록 → 이벤트 로그 ──────────────────────────────
export interface BridgeLogRecord {
  ts: string;
  sessionId?: string;
  engineId?: string;
  decision: 'block' | 'allow';
  reason: string;
  remaining: number;
  nextItemId?: string;
  stopHookActive: boolean;
}

export function readBridgeLog(file: string): BridgeLogRecord[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as BridgeLogRecord);
}

/** 브리지가 남긴 판단을 hook_result(stop.before) 기록으로 이벤트 로그에 옮긴다 */
export function ingestBridgeLog(file: string, log: EventSink, sessionId: string): number {
  const recs = readBridgeLog(file);
  for (const r of recs)
    log.append({
      id: randomUUID(),
      ts: r.ts,
      sessionId,
      ...(r.engineId ? { engineId: r.engineId } : {}),
      ...(r.nextItemId ? { itemId: r.nextItemId } : {}),
      type: 'hook_result',
      hookId: 'stop-bridge',
      hook: 'stop.before',
      mode: 'blocking',
      decision: r.decision,
      reason: r.reason,
      durationMs: 0,
    });
  return recs.length;
}

// ── 28.5 하네스 재주입 루프 ────────────────────────────────────
export interface StopGuardRunOptions {
  engine: EngineAdapter;
  run: EngineRunOptions;
  guard: StopGuard;
  /** stop.before 훅 버스 (없으면 guard.decide를 직접 부른다) */
  hooks?: HookBus;
  /** 차단 뒤 자동 전송 최대 턴 수 (기본 20) */
  maxAutoTurns?: number;
  /** 매 턴 시작 전 프롬프트 가공 (예: 컨텍스트 슬라이스 앞붙이기, T-029) */
  preparePrompt?: (prompt: string, turn: number) => string;
  /** 네이티브 브리지 주입 (없으면 주입 안 함) */
  bridge?: { command: string };
  /** 29.3 정체 감지 (있으면 무진척 처리를 맡는다: 2턴 접근 변경 지시, 3턴 blocked) */
  stall?: StallDetector;
  /** 29.4 세션 상한 (초과 시 turn_end(max_turns)를 내고 일시정지) */
  budget?: SessionBudget;
}

/**
 * 엔진 턴을 돌리고, turn_end(completed)에서 종료 판단을 한다. 미완료면 turn_end(reason 'blocked',
 * remaining·nextItemId·nextItemTitle)를 내보내고 다음 항목 지시문으로 다음 턴을 자동 전송한다.
 * 네이티브 Stop 훅 엔진(claude-code)은 브리지만 주입하고 재주입하지 않는다.
 */
export async function* runWithStopGuard(o: StopGuardRunOptions): AsyncGenerator<HarnessEvent> {
  const strategy = selectStopStrategy(o.engine.capabilities);
  const inject = o.bridge ? STOP_BRIDGES[o.engine.id] : undefined;
  const restore = inject && o.bridge ? inject(o.run.cwd, o.bridge.command) : undefined;
  try {
    const max = o.maxAutoTurns ?? 20;
    let prompt = o.run.prompt;
    let resumeId = o.run.resumeId;
    let stopHookActive = false;
    for (let turn = 0; ; turn++) {
      const pause = o.budget?.check();
      if (pause?.paused) {
        yield {
          id: randomUUID(),
          ts: new Date().toISOString(),
          sessionId: o.run.sessionId,
          engineId: o.engine.id,
          type: 'error',
          code: 'session_limit',
          message: pause.reason,
          retryable: true,
        };
        yield {
          id: randomUUID(),
          ts: new Date().toISOString(),
          sessionId: o.run.sessionId,
          engineId: o.engine.id,
          type: 'turn_end',
          reason: 'max_turns',
        };
        return;
      }
      o.budget?.startTurn();
      o.stall?.beginTurn();
      const run = o.engine.run({
        ...o.run,
        prompt: o.preparePrompt ? o.preparePrompt(prompt, turn) : prompt,
        ...(resumeId ? { resumeId } : {}),
      });
      let last: HarnessEvent | undefined;
      for await (const e of run.events) {
        last = e;
        o.budget?.observe(e);
        yield e;
      }
      await run.done;
      resumeId = run.engineSessionId() ?? resumeId;
      if (strategy !== 'harness-reinject') return;
      if (last?.type !== 'turn_end' || last.reason !== 'completed') return;
      const stall = o.stall?.observeTurn();
      // 정체 감지가 있으면 무진척 판단은 정체 감지가 맡는다 (가드는 항상 "처음 멈춤"으로 본다)
      const active = o.stall ? false : stopHookActive;
      const outcome = o.hooks
        ? await o.hooks.runBlocking('stop.before', {
            sessionId: o.run.sessionId,
            engineId: o.engine.id,
            stopHookActive: active,
          })
        : o.guard.decide(active);
      if (outcome.decision === 'allow') return;
      const st = o.guard.status();
      yield {
        id: randomUUID(),
        ts: new Date().toISOString(),
        sessionId: o.run.sessionId,
        engineId: o.engine.id,
        ...(st.next ? { itemId: st.next.id } : {}),
        type: 'turn_end',
        reason: 'blocked',
        remaining: st.remaining,
        ...(st.next ? { nextItemId: st.next.id, nextItemTitle: st.next.title } : {}),
      };
      if (turn + 1 >= max) return;
      prompt = outcome.reason ?? st.next?.instruction ?? '체크리스트의 다음 항목을 진행하세요.';
      if (stall?.action === 'change_approach') prompt = `${stall.instruction}\n\n${prompt}`;
      stopHookActive = true;
    }
  } finally {
    restore?.restore();
  }
}
