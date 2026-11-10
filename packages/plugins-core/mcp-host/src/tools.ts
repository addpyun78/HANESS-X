import {
  ChecklistLedger,
  lintChecklist,
  redecomposeMessage,
  type ChecklistItem,
  type ChecklistItemInput,
  type Evidence,
  type Glossary,
  type GlossaryIndex,
  type LintItem,
  type LintOptions,
  type LintViolation,
  type ManifestDraft,
  type ManifestStore,
} from '@harness-x/checklist-ledger';

/**
 * 하네스 MCP 도구의 순수 로직 (T-023). MCP 서버(server.ts)는 이 함수들을 도구로 감싸기만 한다.
 * 모든 도구는 JSON 직렬화 가능한 결과를 돌려주고, 실패는 HarnessToolError로 던진다.
 */

export interface HarnessToolDeps {
  ledger: ChecklistLedger;
  manifest: ManifestStore;
  /** propose 시 artifacts 초안을 manifest로 잠글 때 쓰는 이름 정책 사전 */
  glossary?: Glossary | GlossaryIndex;
  lint?: LintOptions;
}

export class HarnessToolError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'HarnessToolError';
  }
}

// ── checklist.propose ─────────────────────────────────────────
export interface ProposeInput {
  items: Record<string, unknown>[];
  /** 산출물 초안 — 주면 체크리스트 저장 후 manifest를 Lock한다(이미 잠겼으면 무시) */
  artifacts?: ManifestDraft[];
}

export type ProposeResult =
  | { ok: false; reason: 'lint'; violations: LintViolation[]; message: string }
  | { ok: false; reason: 'invalid'; message: string }
  | {
      ok: true;
      revision: number;
      version: number;
      itemCount: number;
      manifest:
        | { status: 'locked'; revision: number; artifacts: Record<string, string> }
        | { status: 'needs_approval'; approvalId: string; unknownWords: string[] }
        | { status: 'already_locked' }
        | { status: 'skipped' };
    };

export function proposeChecklist(deps: HarnessToolDeps, input: ProposeInput): ProposeResult {
  const lint = lintChecklist(input.items as unknown as LintItem[], deps.lint);
  if (!lint.ok)
    return {
      ok: false,
      reason: 'lint',
      violations: lint.violations,
      message: redecomposeMessage(lint.violations),
    };
  let saved;
  try {
    const items = input.items as unknown as ChecklistItemInput[];
    saved = deps.ledger.read() ? deps.ledger.revise(items) : deps.ledger.create(items);
  } catch (err) {
    return { ok: false, reason: 'invalid', message: errMsg(err) };
  }
  let manifest: Extract<ProposeResult, { ok: true }>['manifest'] = { status: 'skipped' };
  if (input.artifacts?.length) {
    if (deps.manifest.isLocked()) manifest = { status: 'already_locked' };
    else {
      if (!deps.glossary)
        throw new HarnessToolError('glossary가 없어 manifest를 잠글 수 없습니다', 'NO_GLOSSARY');
      const r = deps.manifest.lock(input.artifacts, { glossary: deps.glossary });
      manifest =
        r.status === 'locked'
          ? {
              status: 'locked',
              revision: r.manifest.revision,
              artifacts: Object.fromEntries(
                Object.entries(r.manifest.artifacts).map(([k, v]) => [k, v.path]),
              ),
            }
          : { status: 'needs_approval', approvalId: r.approvalId, unknownWords: r.unknownWords };
    }
  }
  return {
    ok: true,
    revision: saved.revision,
    version: saved.version,
    itemCount: saved.items.length,
    manifest,
  };
}

// ── checklist.start / submit ──────────────────────────────────
export interface ItemView {
  id: string;
  title: string;
  status: ChecklistItem['status'];
  attempts: number;
  artifactId: string;
  /** manifest의 정식 경로 (manifest에 없으면 null) */
  canonicalPath: string | null;
}

export function canonicalPathOf(deps: HarnessToolDeps, artifactId: string): string | null {
  try {
    return deps.manifest.read()?.artifacts[artifactId]?.path ?? null;
  } catch {
    return null;
  }
}

function view(deps: HarnessToolDeps, it: ChecklistItem): ItemView {
  return {
    id: it.id,
    title: it.title,
    status: it.status,
    attempts: it.attempts,
    artifactId: it.artifactId,
    canonicalPath: canonicalPathOf(deps, it.artifactId),
  };
}

/** todo/failed → doing */
export function startItem(deps: HarnessToolDeps, id: string): ItemView {
  return guard(() => {
    deps.ledger.transition(id, 'doing');
    return view(deps, deps.ledger.item(id));
  });
}

/** doing → verifying (+ 증거) */
export function submitItem(deps: HarnessToolDeps, id: string, evidence: Evidence[]): ItemView {
  return guard(() => {
    deps.ledger.transition(id, 'verifying', { evidence: evidence.length ? evidence : [{ kind: 'submit' }] });
    return view(deps, deps.ledger.item(id));
  });
}

// ── checklist.current ─────────────────────────────────────────
export interface CurrentResult {
  /** 체크리스트가 없거나 모두 끝났으면 null */
  item: (ItemView & { acceptance: ChecklistItem['acceptance']; deps: string[] }) | null;
  canonicalPath: string | null;
  next: ItemView[];
  remaining: number;
}

export function currentItem(deps: HarnessToolDeps): CurrentResult {
  const cur = deps.ledger.currentItem();
  const next = deps.ledger.nextItems(3).map((i) => view(deps, i));
  const remaining = deps.ledger.remaining().length;
  if (!cur) return { item: null, canonicalPath: null, next, remaining };
  const v = view(deps, cur);
  return {
    item: { ...v, acceptance: cur.acceptance, deps: cur.deps },
    canonicalPath: v.canonicalPath,
    next,
    remaining,
  };
}

// ── manifest.resolve ──────────────────────────────────────────
export function resolveArtifact(deps: HarnessToolDeps, artifactId: string) {
  return guard(() => deps.manifest.resolve(artifactId));
}

function guard<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    throw new HarnessToolError(errMsg(err), typeof code === 'string' ? code : 'ERROR');
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
