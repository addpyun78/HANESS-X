import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChecklistLedger, ManifestStore, loadDefaultGlossary } from '@harness-x/checklist-ledger';
import type { CardInput } from '../src/templates.js';

export function tempDir(prefix = 'hx-approvals-'): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export const NOW = new Date('2026-11-11T09:00:00.000Z');

/** 카드 공통 입력 (id·시각 고정 → 스냅샷 안정) */
export const PATH_INPUT: CardInput = {
  kind: 'path',
  itemId: '3.2.2',
  sessionId: 's1',
  expected: '하네스/모바일',
  actual: 'ai/mobile',
  comparator: 'path',
  confidence: 0.75,
  judgeEngine: 'codex',
  recommendation: 'accept',
  plainReason: '안에 든 파일과 테스트 결과가 같아요.',
  id: 'card-path-1',
  now: NOW,
};

/** 세션 폴더 하나: 체크리스트(1 → 2 의존, 3 독립) + 잠긴 manifest */
export function sessionFixture(dir: string, sessionId = 's1') {
  const events: Record<string, unknown>[] = [];
  const log = { append: (e: unknown) => events.push(e as Record<string, unknown>) };
  const manifest = new ManifestStore({ dir, sessionId });
  manifest.lock(
    [
      { artifactId: 'art.mobile-app', displayName: '하네스/모바일', kind: 'dir' },
      {
        artifactId: 'art.mobile-login',
        displayName: '로그인',
        kind: 'file',
        path: 'harness/mobile/login.kt',
      },
      { artifactId: 'art.web', displayName: '웹', kind: 'dir', path: 'harness/web' },
    ],
    { glossary: loadDefaultGlossary() },
  );
  const ledger = new ChecklistLedger({ dir, sessionId });
  ledger.create([
    { id: '1', title: '모바일 앱 폴더', artifactId: 'art.mobile-app', acceptance: [{ type: 'file_exists' }] },
    {
      id: '2',
      title: '로그인 화면',
      artifactId: 'art.mobile-login',
      deps: ['1'],
      acceptance: [{ type: 'test', run: 'pnpm test harness/mobile/login' }],
    },
    { id: '3', title: '웹 셸', artifactId: 'art.web', acceptance: [{ type: 'test', run: 'pnpm test web' }] },
  ]);
  ledger.transition('1', 'doing');
  ledger.transition('1', 'verifying');
  return { ledger, manifest, events, log };
}
