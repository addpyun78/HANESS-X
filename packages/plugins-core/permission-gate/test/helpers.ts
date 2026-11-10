import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ChecklistLedger,
  ManifestStore,
  loadDefaultGlossary,
  type ChecklistItemInput,
} from '@harness-x/checklist-ledger';
import { HookBus, type LogRecord } from '@harness-x/kernel';
import { installPlanGate, type PlanGateOptions } from '../src/index.js';

export function item(id: string, extra: Partial<ChecklistItemInput> = {}): ChecklistItemInput {
  return {
    id,
    title: `항목 ${id} 구현`,
    artifactId: `art.item-${id.replace(/\./g, '-')}`,
    acceptance: [{ type: 'test', run: `pnpm test item-${id}` }],
    ...extra,
  };
}

export interface GateFixture {
  /** 워크스페이스 (= 세션 폴더의 부모) */
  ws: string;
  ledger: ChecklistLedger;
  manifest: ManifestStore;
  bus: HookBus;
  events: LogRecord[];
  gate: ReturnType<typeof installPlanGate>['gate'];
  /** 체크리스트 생성 + manifest Lock (art.mobile-app → harness/mobile) */
  lockPlan(): void;
  tool(tool: string, input: unknown, extra?: Record<string, unknown>): ReturnType<HookBus['runBlocking']>;
  cleanup(): void;
}

export function gateFixture(opts: Partial<PlanGateOptions> = {}): GateFixture {
  const ws = mkdtempSync(join(tmpdir(), 'hx-gate-'));
  const dir = join(ws, '.harness-x', 'sessions', 's1');
  const events: LogRecord[] = [];
  const log = { append: (e: LogRecord) => events.push(e) };
  const ledger = new ChecklistLedger({ dir, sessionId: 's1' });
  const manifest = new ManifestStore({ dir, sessionId: 's1' });
  const glossary = loadDefaultGlossary();
  const bus = new HookBus();
  const { gate } = installPlanGate(bus, {
    ledger,
    manifest,
    glossary,
    workspace: ws,
    log,
    sessionId: 's1',
    ...opts,
  });
  return {
    ws,
    ledger,
    manifest,
    bus,
    events,
    gate,
    lockPlan() {
      ledger.create([item('1', { artifactId: 'art.mobile-app' }), item('2', { artifactId: 'art.readme' })]);
      const r = manifest.lock(
        [
          { artifactId: 'art.mobile-app', displayName: '하네스/모바일', kind: 'dir' },
          { artifactId: 'art.readme', displayName: 'docs/README.md', kind: 'file', path: 'docs/readme.md' },
        ],
        { glossary },
      );
      if (r.status !== 'locked') throw new Error('lock failed');
    },
    tool: (tool, input, extra = {}) =>
      bus.runBlocking('tool.before', { sessionId: 's1', cwd: ws, tool, input, ...extra }),
    cleanup: () => rmSync(ws, { recursive: true, force: true }),
  };
}
