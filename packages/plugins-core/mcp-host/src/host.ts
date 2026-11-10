import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  ChecklistLedger,
  ManifestStore,
  ensureProjectGlossary,
  loadDefaultGlossary,
  type EventSink,
  type Glossary,
} from '@harness-x/checklist-ledger';
import type { HarnessToolDeps } from './tools.js';

/** 세션 폴더 하나(checklist.json + manifest.json)로 도구 의존성을 만든다 */
export interface OpenSessionOptions {
  /** 세션 폴더 (예: <workspace>/.harness-x/sessions/<id>) */
  dir: string;
  sessionId?: string;
  /** 프로젝트 glossary.json (없으면 기본값을 복사). 생략하면 패키지 기본 glossary */
  glossaryFile?: string;
  log?: EventSink;
  engineId?: string;
}

export function openSession(opts: OpenSessionOptions): HarnessToolDeps & { glossary: Glossary } {
  mkdirSync(opts.dir, { recursive: true });
  const sessionId = opts.sessionId ?? 'mcp';
  const common = {
    sessionId,
    ...(opts.log ? { log: opts.log } : {}),
    ...(opts.engineId ? { engineId: opts.engineId } : {}),
  };
  const glossary = opts.glossaryFile ? ensureProjectGlossary(opts.glossaryFile) : loadDefaultGlossary();
  return {
    ledger: new ChecklistLedger({ dir: opts.dir, ...common }),
    manifest: new ManifestStore({ dir: opts.dir, ...common }),
    glossary,
  };
}

/** 워크스페이스 기준 기본 세션 폴더 */
export function sessionDir(workspace: string, sessionId: string): string {
  return join(workspace, '.harness-x', 'sessions', sessionId);
}
