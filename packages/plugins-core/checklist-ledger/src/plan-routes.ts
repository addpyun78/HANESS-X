import { loadDefaultGlossary, type Glossary, type GlossaryIndex } from './glossary.js';
import { currentItemOf, type ChecklistLedger, type EventSink } from './ledger.js';
import { lintChecklist, type LintItem, type LintOptions, type LintResult } from './lint.js';
import { ManifestStore, type ArtifactKind, type ManifestDraft } from './manifest.js';
import type { Checklist } from './schema.js';
import { StageTreeStore } from './stages/store.js';
import type { StageTree } from './stages/schema.js';

/**
 * 체크리스트 패널용 라우트 (T-036)
 *  - GET  /api/checklist/:session        전체 항목(acceptance·evidence·verdict) + 현재 항목 + 계획 잠금 상태 + 린트
 *  - POST /api/checklist/:session/lock   Lock 전 계획 검토의 [승인] → 린트 통과 시 manifest Lock
 * 커널 API 서버의 `routes` 옵션에 넘긴다 (registerChecklistStatusRoute와 같은 방식).
 */

export interface PlanArtifactView {
  displayName: string;
  path: string;
  kind: ArtifactKind;
}

export interface ChecklistPlanView {
  locked: boolean;
  lockedAt?: string;
  revision: number;
  artifacts: Record<string, PlanArtifactView>;
}

export interface ChecklistView {
  sessionId: string;
  checklist: Checklist;
  currentItemId: string | null;
  plan: ChecklistPlanView;
  lint: LintResult;
  /** 단계 트리 (T-101 4F.4, 실행이 시작된 세션만 — 없으면 null) */
  stages: StageTree | null;
}

function stagesOf(ledger: ChecklistLedger): StageTree | null {
  try {
    return new StageTreeStore({ dir: ledger.store.dir, sessionId: ledger.sessionId }).read();
  } catch {
    return null;
  }
}

export function manifestForLedger(ledger: ChecklistLedger, log?: EventSink): ManifestStore {
  return new ManifestStore({ dir: ledger.store.dir, sessionId: ledger.sessionId, ...(log ? { log } : {}) });
}

function planOf(manifest: ManifestStore): ChecklistPlanView {
  const m = manifest.read();
  if (!m) return { locked: false, revision: 0, artifacts: {} };
  return {
    locked: m.locked,
    ...(m.lockedAt ? { lockedAt: m.lockedAt } : {}),
    revision: m.revision,
    artifacts: Object.fromEntries(
      Object.entries(m.artifacts).map(([id, e]) => [
        id,
        { displayName: e.displayName, path: e.path, kind: e.kind },
      ]),
    ),
  };
}

export function checklistView(
  ledger: ChecklistLedger,
  manifest: ManifestStore,
  lint: LintOptions = {},
): ChecklistView | null {
  const c = ledger.read();
  if (!c) return null;
  return {
    sessionId: ledger.sessionId,
    checklist: c,
    currentItemId: currentItemOf(c)?.id ?? null,
    plan: planOf(manifest),
    lint: lintChecklist(c.items as unknown as LintItem[], lint),
    stages: stagesOf(ledger),
  };
}

export interface LockPlanInput {
  /** 산출물 초안 (생략하면 잠기지 않은 manifest의 초안 항목) */
  artifacts?: ManifestDraft[];
  /** 미등록 단어 → 영문 이름 */
  overrides?: Record<string, string>;
}

export type LockPlanResult =
  | { status: 'locked'; revision: number; artifacts: Record<string, string> }
  | { status: 'already_locked' }
  | { status: 'lint'; violations: LintResult['violations'] }
  | { status: 'needs_approval'; approvalId: string; unknownWords: string[] };

/** 계획 Lock: 린트 위반이 있으면 거부, 없으면 manifest를 잠근다 */
export function lockPlan(
  ledger: ChecklistLedger,
  manifest: ManifestStore,
  input: LockPlanInput,
  opts: { glossary: Glossary | GlossaryIndex; lint?: LintOptions },
): LockPlanResult {
  const c = ledger.get();
  const cur = manifest.read();
  if (cur?.locked) return { status: 'already_locked' };
  const lint = lintChecklist(c.items as unknown as LintItem[], opts.lint);
  if (!lint.ok) return { status: 'lint', violations: lint.violations };
  const drafts: ManifestDraft[] =
    input.artifacts ??
    Object.entries(cur?.artifacts ?? {}).map(([artifactId, e]) => ({
      artifactId,
      displayName: e.displayName,
      kind: e.kind,
      path: e.path,
    }));
  const r = manifest.lock(drafts, {
    glossary: opts.glossary,
    ...(input.overrides ? { overrides: input.overrides } : {}),
  });
  if (r.status === 'needs_approval')
    return { status: 'needs_approval', approvalId: r.approvalId, unknownWords: r.unknownWords };
  return {
    status: 'locked',
    revision: r.manifest.revision,
    artifacts: Object.fromEntries(Object.entries(r.manifest.artifacts).map(([k, v]) => [k, v.path])),
  };
}

type Reply = { code(n: number): { send(b: unknown): unknown } };
type Handler = (req: { params: unknown; body?: unknown }, reply: Reply) => Promise<unknown>;

export interface ChecklistPlanRoutesOptions {
  /** Lock 이벤트(manifest_lock·approval_request)를 남길 로그 */
  log?: EventSink;
  /** 이름 정책 사전 (기본: 내장 glossary) */
  glossary?: () => Glossary | GlossaryIndex;
  /** 세션 원장 → manifest (기본: 같은 폴더의 manifest.json) */
  manifestFor?: (ledger: ChecklistLedger) => ManifestStore;
  lint?: LintOptions;
}

export function registerChecklistPlanRoutes(
  app: { get(path: string, handler: Handler): unknown; post(path: string, handler: Handler): unknown },
  resolveLedger: (sessionId: string) => ChecklistLedger | null | undefined,
  opts: ChecklistPlanRoutesOptions = {},
): void {
  const manifestFor = opts.manifestFor ?? ((l: ChecklistLedger) => manifestForLedger(l, opts.log));
  const notFound = (reply: Reply, session: string) =>
    reply.code(404).send({ error: 'session_not_found', sessionId: session });

  app.get('/api/checklist/:session', async (req, reply) => {
    const { session } = req.params as { session: string };
    const ledger = resolveLedger(session);
    const view = ledger ? checklistView(ledger, manifestFor(ledger), opts.lint) : null;
    if (!view) return notFound(reply, session);
    return view;
  });

  app.post('/api/checklist/:session/lock', async (req, reply) => {
    const { session } = req.params as { session: string };
    const ledger = resolveLedger(session);
    if (!ledger?.read()) return notFound(reply, session);
    const body = (req.body ?? {}) as LockPlanInput;
    try {
      const r = lockPlan(
        ledger,
        manifestFor(ledger),
        {
          ...(Array.isArray(body.artifacts) ? { artifacts: body.artifacts } : {}),
          ...(body.overrides && typeof body.overrides === 'object' ? { overrides: body.overrides } : {}),
        },
        { glossary: (opts.glossary ?? loadDefaultGlossary)(), ...(opts.lint ? { lint: opts.lint } : {}) },
      );
      return r.status === 'locked' ? r : reply.code(409).send(r);
    } catch (err) {
      return reply
        .code(400)
        .send({ error: 'lock_failed', message: err instanceof Error ? err.message : String(err) });
    }
  });
}
