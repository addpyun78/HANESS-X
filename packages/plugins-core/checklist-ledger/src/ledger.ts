import { randomUUID } from 'node:crypto';
import type { LogRecord } from '@harness-x/kernel';
import { ChecklistChangeEventSchema, type ChecklistChangeEvent } from '@harness-x/protocol';
import {
  ChecklistItemSchema,
  EvidenceSchema,
  hasAiJudgedEvidence,
  VerdictSchema,
  type Checklist,
  type ChecklistItem,
  type ChecklistItemInput,
  type Evidence,
  type ItemStatus,
  type Verdict,
} from './schema.js';
import { assertTransition, InvalidTransitionError } from './state.js';
import { ChecklistStore, type ChecklistStoreOptions, type WriteOptions } from './store.js';

/**
 * 체크리스트 원장: 저장소 + 상태 기계 + checklist_change 이벤트 발행 (20.4)
 * 모든 변경은 저장(새 version 확정) 후 항목별 checklist_change 이벤트 1개씩을 남긴다.
 */

/** 이벤트를 받을 곳 — 보통 커널 EventLog */
export interface EventSink {
  append(event: LogRecord): unknown;
}

export interface ChecklistLedgerOptions extends ChecklistStoreOptions {
  sessionId: string;
  /** 이벤트 로그 (없으면 이벤트를 남기지 않음) */
  log?: EventSink;
  /** 변경 주체 엔진 ID (이벤트 engineId) */
  engineId?: string;
  idGen?: () => string;
}

export class ChecklistNotFoundError extends Error {
  readonly code = 'CHECKLIST_NOT_FOUND';
  constructor(file: string) {
    super(`체크리스트가 없습니다: ${file}`);
    this.name = 'ChecklistNotFoundError';
  }
}

export class ItemNotFoundError extends Error {
  readonly code = 'ITEM_NOT_FOUND';
  constructor(readonly itemId: string) {
    super(`없는 항목: ${itemId}`);
    this.name = 'ItemNotFoundError';
  }
}

export interface TransitionOptions extends WriteOptions {
  /** 함께 붙일 증거 */
  evidence?: Evidence | Evidence[];
  /** 판정 결과 기록 (verifying → done/failed 시) */
  verdict?: Verdict;
}

export class ChecklistLedger {
  readonly store: ChecklistStore;
  readonly sessionId: string;
  private readonly log: EventSink | undefined;
  private readonly engineId: string | undefined;
  private readonly idGen: () => string;
  private readonly now: () => Date;

  constructor(opts: ChecklistLedgerOptions) {
    this.store = new ChecklistStore(opts);
    this.sessionId = opts.sessionId;
    this.log = opts.log;
    this.engineId = opts.engineId;
    this.idGen = opts.idGen ?? randomUUID;
    this.now = opts.now ?? (() => new Date());
  }

  /** 현재 체크리스트 (없으면 null) */
  read(): Checklist | null {
    return this.store.read();
  }

  /** 현재 체크리스트 (없으면 ChecklistNotFoundError) */
  get(): Checklist {
    const c = this.store.read();
    if (!c) throw new ChecklistNotFoundError(this.store.file);
    return c;
  }

  item(id: string): ChecklistItem {
    const it = this.get().items.find((i) => i.id === id);
    if (!it) throw new ItemNotFoundError(id);
    return it;
  }

  /** 체크리스트 최초 생성 (revision 1). 이미 있으면 VersionConflictError(expected 0) */
  create(items: ChecklistItemInput[]): Checklist {
    const parsed = items.map((i) => ChecklistItemSchema.parse({ ...i, status: 'todo', attempts: 0 }));
    const next = this.store.update(() => ({ revision: 1, items: parsed }), { expectedVersion: 0 });
    this.emit(
      next,
      parsed.map((i) => ({ itemId: i.id, from: null, to: i.status })),
    );
    return next;
  }

  /** 상태 전이 (전이표 밖이면 InvalidTransitionError). doing 진입 시 attempts + 1 */
  transition(itemId: string, to: ItemStatus, opts: TransitionOptions = {}): Checklist {
    let from: ItemStatus = 'todo';
    const extra = toArray(opts.evidence).map((e) =>
      EvidenceSchema.parse({ ts: this.now().toISOString(), ...e }),
    );
    const verdict = opts.verdict ? VerdictSchema.parse(opts.verdict) : undefined;
    const next = this.store.update((cur) => {
      if (!cur) throw new ChecklistNotFoundError(this.store.file);
      const items = cur.items.map((it) => {
        if (it.id !== itemId) return it;
        from = it.status;
        assertTransition(itemId, it.status, to);
        return {
          ...it,
          status: to,
          attempts: to === 'doing' ? it.attempts + 1 : it.attempts,
          evidence: [...it.evidence, ...extra],
          ...(verdict ? { verdict } : {}),
          ...(hasAiJudgedEvidence(extra) ? { ai_judged: true } : {}),
        };
      });
      if (!cur.items.some((i) => i.id === itemId)) throw new ItemNotFoundError(itemId);
      return { revision: cur.revision, items };
    }, opts);
    this.emit(next, [{ itemId, from, to }]);
    return next;
  }

  /**
   * blocked → doing 재개 (T-100 P3-D.1 기다리던 도구 설치 완료 · P3-C.6 도구 없이 진행).
   * 전이표에서 blocked는 종단 상태라 일반 transition으로는 못 돌아온다 — 이 명시적 재개만 허용. 다른 상태면 InvalidTransitionError.
   */
  resume(itemId: string, opts: TransitionOptions = {}): Checklist {
    const extra = toArray(opts.evidence).map((e) =>
      EvidenceSchema.parse({ ts: this.now().toISOString(), ...e }),
    );
    const next = this.store.update((cur) => {
      if (!cur) throw new ChecklistNotFoundError(this.store.file);
      const target = cur.items.find((i) => i.id === itemId);
      if (!target) throw new ItemNotFoundError(itemId);
      if (target.status !== 'blocked') throw new InvalidTransitionError(itemId, target.status, 'doing');
      return {
        revision: cur.revision,
        items: cur.items.map((it) =>
          it.id === itemId
            ? {
                ...it,
                status: 'doing' as const,
                attempts: it.attempts + 1,
                evidence: [...it.evidence, ...extra],
              }
            : it,
        ),
      };
    }, opts);
    this.emit(next, [{ itemId, from: 'blocked', to: 'doing' }]);
    return next;
  }

  /** 상태를 바꾸지 않고 증거만 추가 (from = to = 현재 상태로 이벤트 발행) */
  addEvidence(itemId: string, evidence: Evidence | Evidence[], opts: WriteOptions = {}): Checklist {
    let status: ItemStatus = 'todo';
    const extra = toArray(evidence).map((e) => EvidenceSchema.parse({ ts: this.now().toISOString(), ...e }));
    const next = this.store.update((cur) => {
      if (!cur) throw new ChecklistNotFoundError(this.store.file);
      const target = cur.items.find((i) => i.id === itemId);
      if (!target) throw new ItemNotFoundError(itemId);
      status = target.status;
      return {
        revision: cur.revision,
        items: cur.items.map((it) =>
          it.id === itemId
            ? {
                ...it,
                evidence: [...it.evidence, ...extra],
                ...(hasAiJudgedEvidence(extra) ? { ai_judged: true } : {}),
              }
            : it,
        ),
      };
    }, opts);
    this.emit(next, [{ itemId, from: status, to: status }]);
    return next;
  }

  /**
   * 체크리스트 개정 (v{n} → v{n+1}) (20.5)
   * 이전 개정본은 checklist.v{n}.json으로 보관된다. 같은 id의 항목은 진행 상태(status·attempts·
   * evidence·verdict)를 이어받는다(입력에 명시하면 그 값). 빠진 항목은 to: 'removed' 이벤트를 남긴다.
   */
  revise(items: ChecklistItemInput[], opts: WriteOptions = {}): Checklist {
    const changes: { itemId: string; from: ItemStatus | null; to: ItemStatus | 'removed' }[] = [];
    const next = this.store.update((cur) => {
      if (!cur) throw new ChecklistNotFoundError(this.store.file);
      const prev = new Map(cur.items.map((i) => [i.id, i]));
      const parsed = items.map((input) => {
        const old = prev.get(input.id);
        const carried = old
          ? { status: old.status, attempts: old.attempts, evidence: old.evidence, verdict: old.verdict }
          : {};
        return ChecklistItemSchema.parse({ ...carried, ...input });
      });
      const kept = new Set(parsed.map((i) => i.id));
      changes.length = 0;
      for (const it of parsed)
        changes.push({ itemId: it.id, from: prev.get(it.id)?.status ?? null, to: it.status });
      for (const old of cur.items)
        if (!kept.has(old.id)) changes.push({ itemId: old.id, from: old.status, to: 'removed' });
      return { revision: cur.revision + 1, items: parsed };
    }, opts);
    this.emit(next, changes);
    return next;
  }

  /** 보관된 개정본 (없으면 null) */
  readRevision(revision: number): Checklist | null {
    const cur = this.store.read();
    if (cur?.revision === revision) return cur;
    return this.store.readArchive(revision);
  }

  /** 진행 중인 항목(doing/verifying/failed) 또는 의존이 모두 done인 첫 todo */
  currentItem(): ChecklistItem | null {
    const c = this.read();
    if (!c) return null;
    return currentItemOf(c);
  }

  /** current 다음으로 시작 가능한(또는 대기 중인) todo 항목 n개 — 정의 순서 */
  nextItems(n = 3): ChecklistItem[] {
    const c = this.read();
    if (!c) return [];
    const cur = currentItemOf(c);
    return c.items.filter((i) => i.status === 'todo' && i.id !== cur?.id).slice(0, n);
  }

  /** 남은(done이 아닌) 항목 */
  remaining(): ChecklistItem[] {
    return this.read()?.items.filter((i) => i.status !== 'done') ?? [];
  }

  protected emit(
    c: Checklist,
    changes: { itemId: string; from: ItemStatus | null; to: ItemStatus | 'removed' }[],
  ): void {
    if (!this.log) return;
    for (const ch of changes) {
      const ev: ChecklistChangeEvent = ChecklistChangeEventSchema.parse({
        id: this.idGen(),
        ts: this.now().toISOString(),
        sessionId: this.sessionId,
        ...(this.engineId ? { engineId: this.engineId } : {}),
        itemId: ch.itemId,
        type: 'checklist_change',
        changedItemId: ch.itemId,
        from: ch.from,
        to: ch.to,
        version: c.version,
      });
      this.log.append(ev);
    }
  }
}

export function currentItemOf(c: Checklist): ChecklistItem | null {
  const active = c.items.find(
    (i) => i.status === 'doing' || i.status === 'verifying' || i.status === 'failed',
  );
  if (active) return active;
  const done = new Set(c.items.filter((i) => i.status === 'done').map((i) => i.id));
  return c.items.find((i) => i.status === 'todo' && i.deps.every((d) => done.has(d))) ?? null;
}

function toArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}
