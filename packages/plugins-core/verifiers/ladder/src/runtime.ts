import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  AI_ACCEPTS_FILE,
  createAiAcceptTracker,
  projectDictionary,
  type DictionaryFiles,
} from '@harness-x/approvals';
import type { ChecklistLedger } from '@harness-x/checklist-ledger';
import { defaultCompareCtx, type CompareOptions, type SemanticMode } from '@harness-x/comparators';
import {
  createJudgeChain,
  DEFAULT_JUDGE_SETTINGS,
  parseJudgeSettings,
  type JudgeChain,
  type JudgeEngineInfo,
  type JudgeSelectDeps,
  type JudgeSettings,
} from '@harness-x/judge';
import {
  cleanupLegacyVerifier,
  type LegacyVerifierCleanupResult,
  type NoticeEvent,
  type SecretDeleter,
} from './cleanup.js';
import {
  createComparePipeline,
  type ApprovalCardSink,
  type ComparePipeline,
  type PipelineResult,
} from './pipeline.js';
import { judgeSettingsFrom, type SettingsEventSink } from './settings.js';

/**
 * 판정 실행 환경 (T-100 Part 1 연결) — 커널 `harness-x serve`가 시작할 때 한 번 만든다.
 *   1. 설정 파일 ~/.harness-x/settings.json 읽기
 *   2. 예전 판정 설정·키 정리 1회 (cleanupLegacyVerifier: J.5 설정 옮기기 → J.6 키체인 정리·안내 → J.2 lock 정리)
 *      옮긴 설정은 파일에 다시 쓴다
 *   3. judge.* 설정 + engine-scanner 감지 결과·로그인 상태로 judge 체인 생성
 *   4. 세션마다 비교 파이프라인(정규화 → 사전 → 의미 판단 → 승인 카드)
 *   5. 라우트: GET /api/notices (한 번만 보여 줄 안내), POST /api/compare (파이프라인 실행)
 */

export const HARNESS_SETTINGS_FILE = 'settings.json';
export const NOTICES_FILE = 'notices.json';

/** engine-scanner 캐시(engines.json) 모양 — 구조적으로만 본다 */
export interface EngineScanLike {
  engines: { name: string; path?: string; status?: string }[];
}

export type LoginStateLike = 'loggedIn' | 'loggedOut' | 'unknown';

/**
 * 감지된 엔진 → judge 체인 엔진 정보.
 * 로그인 상태를 알 수 없으면(상태 명령이 없는 엔진) 감지된 것을 로그인으로 본다 — 실제 호출이 실패하면 체인이
 * unavailable로 끝나 승인 카드로 간다(예외·자동 통과 없음). 확실히 로그아웃이면 쓰지 않는다.
 */
export function judgeEnginesFrom(
  scan: EngineScanLike | null | undefined,
  opts: {
    authMode?: (id: string) => 'subscription' | 'apiKey' | undefined;
    loginState?: (id: string) => LoginStateLike | undefined;
  } = {},
): JudgeEngineInfo[] {
  return (scan?.engines ?? []).map((e) => {
    const state = opts.loginState?.(e.name);
    return {
      id: e.name,
      detected: !!e.path && e.status !== 'missing',
      loggedIn: state !== 'loggedOut',
      authMode: opts.authMode?.(e.name) ?? 'subscription',
      ...(e.path ? { command: e.path } : {}),
    };
  });
}

/** workspaceApprovals(approvals 플러그인) 모양 */
export interface WorkspaceApprovalsLike {
  open(sessionId: string): {
    store: ApprovalCardSink;
    ledger?: ChecklistLedger;
    dictionary?: DictionaryFiles;
  };
}

export interface JudgeRuntimeOptions {
  /** ~/.harness-x */
  home: string;
  /** --workspace (없으면 사전·카드 없이 판정만) */
  workspace?: string;
  /** 설정 파일 (기본 <home>/settings.json) */
  settingsFile?: string;
  log?: SettingsEventSink;
  /** 키체인 (kernel SecretStore) — 예전 판정 서비스 키 정리에만 쓴다 */
  secrets: SecretDeleter;
  /** plugins.lock 정리 (kernel removeLockEntries를 묶어 넘긴다) */
  removeLockEntries?: (ids: string[]) => string[];
  /** 승인 카드 저장소 (나중에 로드되는 플러그인이라 함수로 받는다) */
  approvals?: () => WorkspaceApprovalsLike | undefined;
  /** judge 체인 의존성 (listEngines 필수: engine-scanner 감지 + 로그인 상태) */
  judge: JudgeSelectDeps;
  now?: () => Date;
}

export interface JudgeRuntime {
  readonly settings: JudgeSettings;
  /** 설정 파일이 잘못돼 기본값을 쓴 경우 사유 */
  readonly settingsError?: string;
  readonly cleanup: LegacyVerifierCleanupResult;
  readonly chain: JudgeChain;
  /** 이번 실행에서 한 번 보여 줄 안내 (패널 토스트) */
  notices(): NoticeEvent[];
  pipelineFor(sessionId: string): ComparePipeline;
  compare(input: CompareRequest): Promise<CompareResponse>;
}

function readJsonObject(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {};
  const v = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function writeJsonAtomic(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  renameSync(tmp, file);
}

export interface CompareRequest {
  sessionId: string;
  itemId: string;
  itemTitle?: string;
  authorEngineId?: string;
  /** 비교기 종류 (기본 auto) */
  kind?: string;
  expected: unknown;
  actual: unknown;
  options?: CompareOptions;
  semantic?: SemanticMode;
  file?: string;
}

export type CompareResponse = Omit<PipelineResult, 'evidence'> & {
  evidence: PipelineResult['evidence'];
  /** 항목 evidence에 기록했는가 (세션에 체크리스트가 있을 때) */
  recorded: boolean;
};

export function startJudgeRuntime(opts: JudgeRuntimeOptions): JudgeRuntime {
  const settingsFile = opts.settingsFile ?? join(opts.home, HARNESS_SETTINGS_FILE);
  let config: Record<string, unknown> = {};
  let settingsError: string | undefined;
  try {
    config = readJsonObject(settingsFile);
  } catch (err) {
    settingsError = `설정 파일을 읽지 못했습니다: ${err instanceof Error ? err.message : String(err)}`;
  }

  const cleanup = cleanupLegacyVerifier({
    config,
    secrets: opts.secrets,
    noticeFile: join(opts.home, NOTICES_FILE),
    ...(opts.log ? { log: opts.log } : {}),
    ...(opts.removeLockEntries ? { removeLockEntries: opts.removeLockEntries } : {}),
    ...(opts.now ? { now: opts.now } : {}),
  });
  if (cleanup.migration.migrated && !settingsError) {
    config = cleanup.migration.config;
    writeJsonAtomic(settingsFile, config);
  }

  let settings: JudgeSettings = DEFAULT_JUDGE_SETTINGS;
  try {
    settings = parseJudgeSettings(judgeSettingsFrom(config));
  } catch (err) {
    settingsError ??= `judge 설정이 잘못돼 기본값을 씁니다: ${err instanceof Error ? err.message : String(err)}`;
  }
  const chain = createJudgeChain(settings, opts.judge);

  const pipelines = new Map<string, ComparePipeline>();
  const dictionary = opts.workspace ? projectDictionary(opts.workspace) : undefined;
  const aiAccepts = opts.workspace
    ? createAiAcceptTracker({
        file: join(opts.workspace, '.harness-x', AI_ACCEPTS_FILE),
        ...(dictionary ? { dictionary } : {}),
      })
    : undefined;
  const opened = (sessionId: string) => (opts.workspace ? opts.approvals?.()?.open(sessionId) : undefined);

  const pipelineFor = (sessionId: string): ComparePipeline => {
    let p = pipelines.get(sessionId);
    if (!p) {
      const o = opened(sessionId);
      p = createComparePipeline({
        judge: chain,
        sessionId,
        ...(o?.store ? { approvals: o.store } : {}),
        ...((o?.dictionary ?? dictionary) ? { dictionary: o?.dictionary ?? dictionary } : {}),
        ...(aiAccepts ? { aiAccepts } : {}),
        ...(opts.now ? { now: opts.now } : {}),
      });
      pipelines.set(sessionId, p);
    }
    return p;
  };

  return {
    settings,
    ...(settingsError ? { settingsError } : {}),
    cleanup,
    chain,
    notices: () => (cleanup.notice ? [cleanup.notice] : []),
    pipelineFor,
    async compare(input) {
      const r = await pipelineFor(input.sessionId).compare({
        kind: input.kind ?? 'auto',
        expected: input.expected,
        actual: input.actual,
        ctx: defaultCompareCtx({
          ...(opts.workspace ? { workspaceRoot: opts.workspace } : {}),
          itemTitle: input.itemTitle ?? input.itemId,
          sessionId: input.sessionId,
        }),
        itemId: input.itemId,
        sessionId: input.sessionId,
        ...(input.itemTitle ? { itemTitle: input.itemTitle } : {}),
        ...(input.authorEngineId ? { authorEngineId: input.authorEngineId } : {}),
        ...(input.options ? { options: input.options } : {}),
        ...(input.semantic ? { semantic: input.semantic } : {}),
        ...(input.file ? { file: input.file } : {}),
      });
      // 세션에 체크리스트가 있으면 비교 증거를 항목에 남긴다 (F.1 · AI 판단 통과면 F.2 ai_judged)
      const ledger = opened(input.sessionId)?.ledger;
      let recorded = false;
      if (ledger && r.status !== 'awaiting') {
        ledger.addEvidence(input.itemId, r.evidence);
        recorded = true;
      }
      return { ...r, recorded };
    },
  };
}

// ── 라우트 ──────────────────────────────────────────────────────────
interface RouteReply {
  code(n: number): { send(body: unknown): unknown };
}
interface RouteApp {
  get(path: string, handler: () => Promise<unknown>): unknown;
  post(path: string, handler: (req: { body?: unknown }, reply: RouteReply) => Promise<unknown>): unknown;
}

function isCompareRequest(b: unknown): b is CompareRequest {
  if (!b || typeof b !== 'object') return false;
  const o = b as Record<string, unknown>;
  return (
    typeof o.sessionId === 'string' &&
    /^[A-Za-z0-9._-]{1,128}$/.test(o.sessionId) &&
    typeof o.itemId === 'string' &&
    o.itemId.length > 0 &&
    'expected' in o &&
    'actual' in o &&
    (o.kind === undefined || typeof o.kind === 'string') &&
    (o.semantic === undefined || o.semantic === 'auto' || o.semantic === 'off')
  );
}

/**
 *   GET  /api/notices  → { notices: [{ noticeId, level, message }] }  (예: "더 이상 쓰지 않는 판정 서비스 키를 지웠어요")
 *   POST /api/compare  {sessionId, itemId, kind?, expected, actual, …} → 파이프라인 결과
 *        status: pass | fail | awaiting(승인 카드 — approval_request 이벤트로도 나간다)
 */
export function registerJudgeRoutes(app: RouteApp, rt: JudgeRuntime): void {
  app.get('/api/notices', async () => ({ notices: rt.notices() }));
  app.post('/api/compare', async (req, reply) => {
    if (!isCompareRequest(req.body))
      return reply
        .code(400)
        .send({ error: 'BAD_REQUEST', message: 'sessionId·itemId·expected·actual이 필요합니다' });
    try {
      return await rt.compare(req.body);
    } catch (err) {
      return reply.code(422).send({
        error: 'COMPARE_FAILED',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
