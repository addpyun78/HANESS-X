import { randomUUID } from 'node:crypto';
import {
  type ChecklistItem,
  type ChecklistLedger,
  type EventSink,
  type Glossary,
  type GlossaryIndex,
  type ManifestStore,
} from '@harness-x/checklist-ledger';
import type { BlockingHandler, HookContext, HookResult, RegisterOptions } from '@harness-x/kernel';
import { ApprovalRequestEventSchema } from '@harness-x/protocol';
import { classifyBash } from './bash-classifier.js';
import { matchManifestPath, workspaceRelative, type PathMatch } from './path-match.js';

/**
 * 계획 게이트와 조기 경로 감지 (T-024) — HookBus `tool.before`(차단형)
 *  24.1 체크리스트·manifest가 확정(Lock)되기 전에는 쓰기 도구(Edit/Write/쓰기형 Bash)를 deny
 *  24.3 쓰기 대상 경로를 L1 정규화 + L2 glossary로 manifest에 매칭
 *  24.4 매칭됐지만 경로가 다르면 정식 경로를 알려 주는 deny (엔진이 정식 경로로 재시도)
 *  24.5 manifest 밖이면 strict: deny, default: ask(approval_request 이벤트 + 승인 콜백)
 *  24.6 교정 내역을 항목 evidence에 path_corrected로 기록
 */

export type GateMode = 'strict' | 'default';

/** 파일 쓰기 도구 (엔진별 이름) */
export const WRITE_TOOLS = [
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'write_file',
  'edit_file',
  'replace',
  'apply_patch',
  'str_replace_editor',
  'create_file',
] as const;
/** 셸 도구 (엔진별 이름) */
export const SHELL_TOOLS = [
  'Bash',
  'bash',
  'shell',
  'exec_command',
  'run_shell_command',
  'local_shell',
] as const;

export const PATH_CORRECTED_KIND = 'path_corrected';

export interface ApprovalAsk {
  approvalId: string;
  tool: string;
  paths: string[];
  reason: string;
  /** 지금 항목 (T-101 3D.2 오토 거부 시 blocked 처리) */
  itemId?: string;
}

export interface PlanGateOptions {
  ledger: ChecklistLedger;
  manifest: ManifestStore;
  glossary: Glossary | GlossaryIndex;
  /** manifest 경로의 기준 (기본 ctx.cwd) */
  workspace?: string;
  /** 기본 'default' */
  mode?: GateMode;
  /** approval_request 이벤트를 남길 곳 (보통 커널 EventLog) */
  log?: EventSink;
  sessionId?: string;
  /**
   * 24.5 default 모드의 ask: 승인 여부를 돌려준다(UI 승인 카드 등). 없으면 approval_request만 남기고 deny
   * (사유에 approvalId — 승인되면 grant()로 경로를 허용한 뒤 엔진이 재시도)
   */
  approve?: (req: ApprovalAsk) => boolean | Promise<boolean>;
  writeTools?: readonly string[];
  shellTools?: readonly string[];
  now?: () => Date;
}

export interface WriteIntent {
  /** 쓰기 호출인가 */
  write: boolean;
  /** 쓰기 대상 경로 (모르면 빈 배열) */
  paths: string[];
  /** 'tool' = 파일 쓰기 도구, 'bash' = 쓰기형 셸 */
  via?: 'tool' | 'bash';
  reasons?: string[];
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

const PATH_KEYS = ['file_path', 'path', 'filePath', 'notebook_path', 'target_file', 'file'];

/** apply_patch 본문의 대상 경로 (*** Add/Update/Delete File:, *** Move to:) */
export function patchTargets(patch: string): string[] {
  const out: string[] = [];
  for (const m of patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm))
    out.push((m[1] ?? m[2]!).trim());
  return out;
}

/** 도구 호출 → 쓰기 의도 */
export function writeIntentOf(
  tool: string,
  input: unknown,
  opts: Pick<PlanGateOptions, 'writeTools' | 'shellTools'> = {},
): WriteIntent {
  const a = obj(input);
  const writeTools = opts.writeTools ?? WRITE_TOOLS;
  const shellTools = opts.shellTools ?? SHELL_TOOLS;
  if (writeTools.includes(tool)) {
    const paths = PATH_KEYS.map((k) => a[k]).filter(
      (v): v is string => typeof v === 'string' && v.length > 0,
    );
    const patch = typeof input === 'string' ? input : [a.patch, a.input].find((v) => typeof v === 'string');
    if (typeof patch === 'string') paths.push(...patchTargets(patch));
    return { write: true, paths: [...new Set(paths)], via: 'tool' };
  }
  if (shellTools.includes(tool)) {
    const raw = typeof input === 'string' ? input : (a.command ?? a.cmd);
    const cmd = Array.isArray(raw)
      ? // ["bash","-lc","..."] 형태
        (raw as unknown[]).map(String).at(-1)!
      : typeof raw === 'string'
        ? raw
        : '';
    const r = classifyBash(cmd);
    return { write: r.write, paths: r.targets, via: 'bash', reasons: r.reasons };
  }
  return { write: false, paths: [] };
}

export interface PlanGate {
  /** tool.before 차단형 핸들러 */
  handler: BlockingHandler;
  /** 계획(체크리스트 + manifest Lock)이 확정됐는가 */
  isPlanLocked(): boolean;
  /** 승인된 경로(워크스페이스 상대 또는 절대)를 이후 허용 */
  grant(path: string): void;
}

export function createPlanGate(opts: PlanGateOptions): PlanGate {
  const mode = opts.mode ?? 'default';
  const granted = new Set<string>();
  const now = opts.now ?? (() => new Date());

  const isPlanLocked = () => {
    try {
      return opts.ledger.read() !== null && opts.manifest.isLocked();
    } catch {
      return false; // 손상·변조된 원장은 미확정으로 본다
    }
  };

  const workspaceOf = (ctx: HookContext) =>
    opts.workspace ?? (typeof ctx.cwd === 'string' ? ctx.cwd : process.cwd());

  const emitApproval = (ctx: HookContext, ask: ApprovalAsk) => {
    if (!opts.log) return;
    const sessionId = typeof ctx.sessionId === 'string' ? ctx.sessionId : (opts.sessionId ?? 'kernel');
    const rec = ApprovalRequestEventSchema.parse({
      id: randomUUID(),
      ts: now().toISOString(),
      sessionId,
      ...(typeof ctx.engineId === 'string' ? { engineId: ctx.engineId } : {}),
      ...(typeof ctx.itemId === 'string' ? { itemId: ctx.itemId } : {}),
      type: 'approval_request',
      approvalId: ask.approvalId,
      kind: 'plan-gate.outside-manifest',
      title: `manifest 밖 경로에 쓰기: ${ask.paths.join(', ')}`,
      detail: { tool: ask.tool, paths: ask.paths, reason: ask.reason },
      options: ['allow', 'deny'],
    });
    opts.log.append(rec as Parameters<EventSink['append']>[0]);
  };

  /** 24.6 교정 기록 대상 항목: ctx.itemId → 같은 산출물의 진행 중 항목 → 현재 항목 */
  const targetItem = (ctx: HookContext, artifactId: string): ChecklistItem | null => {
    const c = opts.ledger.read();
    if (!c) return null;
    if (typeof ctx.itemId === 'string') {
      const it = c.items.find((i) => i.id === ctx.itemId);
      if (it) return it;
    }
    const same = c.items.filter(
      (i) => i.artifactId === artifactId && i.status !== 'done' && i.status !== 'blocked',
    );
    return same.find((i) => i.status === 'doing') ?? same[0] ?? opts.ledger.currentItem();
  };

  const recordCorrections = (
    ctx: HookContext,
    tool: string,
    corrected: Extract<PathMatch, { kind: 'corrected' }>[],
  ) => {
    for (const m of corrected) {
      const it = targetItem(ctx, m.artifactId);
      if (!it) continue;
      try {
        opts.ledger.addEvidence(it.id, {
          kind: PATH_CORRECTED_KIND,
          summary: `${m.path} → ${m.canonical}`,
          tool,
          from: m.path,
          to: m.canonical,
          artifactId: m.artifactId,
          level: m.level,
          ...(typeof ctx.callId === 'string' ? { callId: ctx.callId } : {}),
        });
      } catch {
        // 기록 실패가 교정 자체를 막지 않는다
      }
    }
  };

  const handler: BlockingHandler = async (ctx): Promise<HookResult | void> => {
    const tool = typeof ctx.tool === 'string' ? ctx.tool : '';
    const intent = writeIntentOf(tool, ctx.input, opts);
    if (!intent.write) return;

    // 24.1 계획 게이트
    if (!isPlanLocked())
      return {
        decision: 'deny',
        reason:
          `plan_not_locked: 체크리스트가 확정되기 전에는 파일을 쓸 수 없습니다 (${tool}${intent.reasons?.length ? `: ${intent.reasons.join(', ')}` : ''}). ` +
          '먼저 checklist.propose로 체크리스트와 산출물(artifacts)을 제안해 manifest를 잠그세요.',
      };

    const workspace = workspaceOf(ctx);
    const cwd = typeof ctx.cwd === 'string' ? ctx.cwd : workspace;
    let manifest;
    try {
      manifest = opts.manifest.read();
    } catch (err) {
      return {
        decision: 'deny',
        reason: `manifest를 읽을 수 없습니다: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    // 24.3 매칭
    const matches = intent.paths.map((p) =>
      matchManifestPath(p, manifest, { workspace, cwd, glossary: opts.glossary }),
    );
    const corrected = matches.filter(
      (m): m is Extract<PathMatch, { kind: 'corrected' }> => m.kind === 'corrected',
    );
    // 24.4 정식 경로로 고쳐 쓰라는 deny
    if (corrected.length) {
      recordCorrections(ctx, tool, corrected);
      const lines = corrected.map(
        (m) => `- ${m.path} → canonical path: ${m.canonical} (산출물 ${m.artifactId}, L${m.level} 매칭)`,
      );
      return {
        decision: 'deny',
        reason: [
          'path_mismatch: 쓰기 대상이 manifest의 정식 경로와 다릅니다. 같은 내용을 정식 경로로 다시 쓰세요.',
          ...lines,
        ].join('\n'),
      };
    }
    // 24.5 manifest 밖
    const outside = matches.filter(
      (m) => m.kind === 'outside' && !granted.has(workspaceRelative(m.path, { workspace, cwd }) ?? m.path),
    );
    if (!outside.length) return;
    const paths = outside.map((m) => m.path);
    const why = outside.some((m) => m.kind === 'outside' && m.reason === 'outside_workspace')
      ? '워크스페이스 밖'
      : 'manifest에 없는 경로';
    if (mode === 'strict')
      return {
        decision: 'deny',
        reason: `outside_manifest: ${why}에는 쓸 수 없습니다 (strict 모드): ${paths.join(', ')}. checklist.current / manifest.resolve로 정식 경로를 확인하세요.`,
      };
    const ask: ApprovalAsk = {
      approvalId: randomUUID(),
      tool,
      paths,
      reason: why,
      ...(typeof ctx.itemId === 'string' ? { itemId: ctx.itemId } : {}),
    };
    emitApproval(ctx, ask);
    if (opts.approve) {
      const ok = await opts.approve(ask);
      if (ok) {
        for (const p of paths) granted.add(workspaceRelative(p, { workspace, cwd }) ?? p);
        return;
      }
      return {
        decision: 'deny',
        reason: `outside_manifest: 사용자가 거부했습니다 (${ask.approvalId}): ${paths.join(', ')}`,
      };
    }
    return {
      decision: 'deny',
      reason: `approval_required: ${why}에 쓰려면 사용자 승인이 필요합니다 (approvalId ${ask.approvalId}): ${paths.join(', ')}`,
    };
  };

  return {
    handler,
    isPlanLocked,
    grant: (p) => {
      granted.add(workspaceRelative(p, { workspace: opts.workspace ?? process.cwd() }) ?? p);
    },
  };
}

/** HookBus 또는 PluginContext.hooks 어디에나 설치 */
export interface BlockingHookHost {
  onBlocking(
    name: 'tool.before',
    handler: BlockingHandler,
    opts?: Omit<RegisterOptions, 'pluginId'>,
  ): () => void;
}

export const PLAN_GATE_HOOK_ID = 'permission-gate:plan-gate';

/** tool.before에 계획 게이트 설치. 반환: 해제 함수 */
export function installPlanGate(
  hooks: BlockingHookHost,
  opts: PlanGateOptions,
): { gate: PlanGate; dispose: () => void } {
  const gate = createPlanGate(opts);
  const dispose = hooks.onBlocking('tool.before', gate.handler, {
    id: PLAN_GATE_HOOK_ID,
    priority: 10,
    // 판단 불가(예외·타임아웃)면 쓰기를 막는다. ask 대기가 길 수 있어 넉넉히
    failMode: 'deny',
    timeoutMs: opts.approve ? 10 * 60_000 : 10_000,
  });
  return { gate, dispose };
}
