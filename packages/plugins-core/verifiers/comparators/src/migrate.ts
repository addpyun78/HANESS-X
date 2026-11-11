import { copyFileSync, existsSync } from 'node:fs';
import {
  ChecklistStore,
  type Acceptance,
  type Checklist,
  type CompareSpec,
} from '@harness-x/checklist-ledger';
import { inferCompareKind } from './infer.js';

/**
 * D.5 기존 체크리스트 마이그레이션
 * `compare`가 없는 acceptance에 D.2 추론으로 compare를 채운다. 항목 수·상태·증거는 그대로 둔다.
 * 원본은 덮어쓰기 전에 `checklist.v-before-T100.json`으로 한 번만 보관한다.
 *   command/test  → expectOutput이 있으면 그 값으로 추론, 없으면 exitCode
 *   file_exists   → path
 *   symbol        → text (mode: contains)
 *   schema        → json
 *   llm           → 비교 대상 없음 (그대로)
 */

export const BEFORE_T100_SUFFIX = 'v-before-T100';

export function inferAcceptanceCompare(a: Acceptance): CompareSpec | undefined {
  switch (a.type) {
    case 'command':
    case 'test':
      return a.expectOutput !== undefined ? { kind: inferCompareKind(a.expectOutput) } : { kind: 'exitCode' };
    case 'file_exists':
      return { kind: 'path' };
    case 'symbol':
      return { kind: 'text', options: { mode: 'contains' } };
    case 'schema':
      return { kind: 'json' };
    case 'llm':
      return undefined;
  }
}

/** 항목 acceptance에 compare 채우기 (순수 함수). 바뀐 조건 수를 함께 돌려준다 */
export function fillCompare(c: Checklist): { checklist: Checklist; filled: number } {
  let filled = 0;
  const items = c.items.map((it) => ({
    ...it,
    acceptance: it.acceptance.map((a) => {
      if (a.type === 'llm' || a.compare) return a;
      const spec = inferAcceptanceCompare(a);
      if (!spec) return a;
      filled++;
      return { ...a, compare: spec } as Acceptance;
    }),
  }));
  return { checklist: { ...c, items }, filled };
}

export interface MigrateResult {
  migrated: boolean;
  filled: number;
  /** 원본 보관 파일 (보관했을 때) */
  backup?: string;
  checklist: Checklist | null;
}

export function backupFileOf(store: ChecklistStore): string {
  return store.file.replace(/\.json$/, `.${BEFORE_T100_SUFFIX}.json`);
}

export function migrateChecklistCompare(store: ChecklistStore): MigrateResult {
  const cur = store.read();
  if (!cur) return { migrated: false, filled: 0, checklist: null };
  const { filled } = fillCompare(cur);
  if (filled === 0) return { migrated: false, filled: 0, checklist: cur };
  const backup = backupFileOf(store);
  if (!existsSync(backup)) copyFileSync(store.file, backup);
  const next = store.update((c) => {
    const base = fillCompare(c!).checklist;
    return { revision: base.revision, items: base.items };
  });
  return { migrated: true, filled, backup, checklist: next };
}
