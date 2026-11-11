import { loadDefaultGlossary } from '@harness-x/checklist-ledger';
import { EMPTY_EQUIVALENCES, type CompareCtx, type Equivalences } from '../src/types.js';

export function ctx(extra: Partial<CompareCtx> = {}, eq: Partial<Equivalences> = {}): CompareCtx {
  return {
    os: 'posix',
    workspaceRoot: '/work',
    glossary: loadDefaultGlossary(),
    equivalences: { ...EMPTY_EQUIVALENCES, ...eq },
    itemTitle: '테스트 항목',
    sessionId: 'sess-1',
    ...extra,
  };
}
