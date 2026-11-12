import type { MissingEngineCard, MissingEngineChoice } from './missing-engine.js';
import type { LogRecord } from '@harness-x/kernel';
import type { ChecklistItem, ChecklistItemInput, ChecklistLedger } from '@harness-x/checklist-ledger';
import type {
  EngineAdapter,
  GateNode,
  HarnessEvent,
  McpServerRef,
  Pipeline,
  PipelineNode,
  RoleNode,
} from '@harness-x/protocol';

/** 실행기가 이벤트를 남기는 곳 (보통 커널 EventLog) */
export interface RunnerEventSink {
  append(event: LogRecord): unknown;
}

/** 노드 실행 상태 */
export type NodeStatus =
  | 'completed'
  /** 체크리스트 미완료 (role 노드 완료 조건 불충족) */
  | 'incomplete'
  /** gate 판정 실패 (재시도 소진) */
  | 'failed'
  /** loop 최대 반복 도달 (다음으로 진행) */
  | 'max_iterations'
  /** loop 정체 (출력 무변화) — 파이프라인 중단 */
  | 'stalled'
  /** 엔진 오류·중단 */
  | 'error'
  /** 출력 계약(outputSchema) 불충족 (T-042) */
  | 'contract_failed';

export type PipelineRunStatus =
  'completed' | 'incomplete' | 'failed' | 'stalled' | 'error' | 'contract_failed';

/** 노드 방문 1회의 기록 (loop 안에서는 같은 노드가 여러 번 방문된다) */
export interface NodeVisit {
  nodeId: string;
  type: PipelineNode['type'];
  /** 1부터 시작하는 방문 번호 */
  visit: number;
  engineId?: string;
  status: NodeStatus;
  /** 노드 자신의 출력 (role: 추출된 값, gate: 판정, join: 합친 값) */
  output: unknown;
  /** 이 노드의 체크리스트 원장 (role 노드) */
  ledgerDir?: string;
  /** 엔진에 보낸 프롬프트 (재요청·부분 재실행 포함, 순서대로) */
  prompts: string[];
  /** 이 방문에서 엔진이 낸 이벤트 */
  events: HarnessEvent[];
  reason?: string;
  /** gate: onFail로 되돌린 횟수 / loop: 반복 횟수 */
  retries?: number;
  iterations?: number;
}

export interface PipelineRunResult {
  sessionId: string;
  status: PipelineRunStatus;
  /** 노드 id → 마지막 출력 */
  outputs: Record<string, unknown>;
  /** 방문 순서대로 */
  visits: NodeVisit[];
  /** 중단된 노드 */
  haltedAt?: string;
  reason?: string;
  /** 마지막 노드가 넘긴 값 */
  result: unknown;
}

/** role 노드 1회 실행 문맥 (mcpServers 콜백 등에 넘긴다) */
export interface NodeRunContext {
  pipeline: Pipeline;
  node: RoleNode;
  sessionId: string;
  visit: number;
  engine: EngineAdapter;
  /** 이 노드 방문의 체크리스트 폴더 (checklist.json) */
  ledgerDir: string;
  ledger: ChecklistLedger;
}

/** gate 판정에 넘기는 상류 노드 방문 */
export interface GateSubject {
  nodeId: string;
  visit: NodeVisit;
  items: ChecklistItem[];
  ledger: ChecklistLedger;
}

export interface GateFailure {
  /** 항목이 속한 노드 (기본: onFail 대상 노드) */
  nodeId?: string;
  itemId: string;
  reason: string;
}

export interface GateVerdict {
  /** 실패 항목 (비면 통과) */
  failed: GateFailure[];
}

export type GateVerifier = (input: {
  pipeline: Pipeline;
  gate: GateNode;
  /** 0 = 첫 판정, n = n번째 재시도 뒤 판정 */
  attempt: number;
  /** onFail 대상 ~ gate 사이 노드들의 최신 방문 */
  subjects: GateSubject[];
}) => GateVerdict | Promise<GateVerdict>;

/**
 * 실행기 → 단계 트리 알림 (T-101 4번). 모두 선택. nodeStart가 { stop }을 돌려주면(계획 모드) 실행을 멈춘다.
 */
export interface RunnerStageHooks {
  nodeStart?(i: {
    node: PipelineNode;
    visit: number;
    engineId?: string;
    /** gate 부분 재실행으로 같은 방문을 다시 시작 */
    rerun?: boolean;
  }): void | { stop: string } | Promise<void | { stop: string }>;
  nodeEnd?(i: {
    node: PipelineNode;
    visit: number;
    status: NodeStatus;
    output: unknown;
    reason?: string;
    /** role 노드 원장 항목 */
    items?: ChecklistItem[];
    /** 정지(일시정지·지금 멈추기)로 끝남 — 단계는 막힘이 아니라 그대로 둔다 */
    interrupted?: boolean;
  }): void;
  gateFailed?(i: {
    gate: GateNode;
    attempt: number;
    failed: Required<GateFailure>[];
    exhausted: boolean;
  }): void;
  loopIteration?(i: { loop: PipelineNode; iteration: number }): void;
  loopEnd?(i: { loop: PipelineNode; iterations: number; reason?: string }): void;
  routeChosen?(i: { router: PipelineNode; to: string }): void;
  /** subagent 노드: 그 에이전트 트리를 단계 아래에 넣고 하위 실행기용 알림을 돌려준다 */
  subagent?(i: {
    node: PipelineNode;
    visit: number;
    agent: string;
    pipeline: Pipeline;
  }): RunnerStageHooks | undefined;
  /** role 노드 프롬프트 다듬기 (단계 슬라이스 붙이기) */
  prompt?(i: { node: RoleNode; engineId: string; prompt: string }): string;
  /** role 노드 원장 항목이 바뀌었을 수 있는 때(원장 생성 직후·턴이 끝날 때마다) — 진행률을 맞춘다 */
  nodeItems?(i: { node: PipelineNode; items: ChecklistItem[] }): void;
}

/** 노드 출력 추출기 (T-042 contract가 기본) */
export type OutputExtractor = (node: RoleNode, events: readonly HarnessEvent[]) => unknown;

export interface PipelineRunnerOptions {
  /** 엔진 id → 어댑터 (또는 조회 함수) */
  engines: Record<string, EngineAdapter> | ((id: string) => EngineAdapter | undefined);
  /** engine: auto인 노드가 쓸 엔진 (기본: 등록된 첫 엔진) */
  defaultEngine?: string;
  /** T-101 5D.4 `engine: main`(메인 AI 따라가기) 노드가 쓸 엔진 (없으면 defaultEngine) */
  mainEngine?: string;
  /**
   * T-101 5D.6 고정 엔진을 못 찾았을 때 카드 응답을 기다린다 ('use-main' → 메인 AI로 대신, 'stop' → 멈춤).
   * 없으면 카드만 남기고 멈춘다
   */
  onMissingEngine?: (card: MissingEngineCard) => Promise<MissingEngineChoice>;
  /** 엔진 작업 폴더. 노드 원장은 <workspace>/.harness-x/sessions/<sessionId>/nodes/<노드>.<방문>/ */
  workspace: string;
  sessionId?: string;
  log?: RunnerEventSink;
  onEvent?: (rec: LogRecord) => void;
  /** checklistTemplate → 항목 목록 (없으면 노드에 체크리스트를 만들지 않는다) */
  checklists?: (node: RoleNode, template: string | undefined) => ChecklistItemInput[] | undefined;
  /** gate 판정기 (없으면 상류 항목 중 done이 아닌 것을 실패로 본다) */
  verify?: GateVerifier;
  /** 노드 세션에 붙일 MCP 서버 */
  mcpServers?: (ctx: NodeRunContext) => McpServerRef[] | undefined;
  /** 하네스 MCP 서버(harness-mcp) 실행 방법 — 있으면 노드 원장 폴더로 'harness' 서버를 붙인다 */
  harnessMcp?: { command: string; args?: string[] };
  /** 엔진 자식 프로세스 환경변수 (기본 process.env) */
  env?: Record<string, string | undefined>;
  /** 차단 뒤 자동 전송 최대 턴 (runWithStopGuard, 기본 20) */
  maxAutoTurns?: number;
  /** 정체 감지 기준 (T-101 6B.4 설정 checklist.stall*, 기본 2턴·3턴) */
  stall?: { changeApproachTurns?: number; blockTurns?: number };
  /** subagent 노드: 에이전트 이름 → 파이프라인 (예: AgentRegistry.get(name)?.pipeline) */
  resolveAgent?: (name: string) => Pipeline | undefined;
  /** 노드 출력 추출기 (주면 계약 검증·재요청을 하지 않는다) */
  extractOutput?: OutputExtractor;
  /** outputSchema 검증 실패 시 같은 노드에 재요청할 최대 횟수 (기본 2) */
  maxContractRetries?: number;
  /** 단계 체크리스트 연결 (T-101 4번 — StageTracker.hooks()) */
  stages?: RunnerStageHooks;
  signal?: AbortSignal;
  /** T-101 2B.9 엔진 자체 재개: 노드 id → 엔진 세션 id (그 노드 첫 턴에 resumeId로 넘김) */
  resumeIds?: Record<string, string>;
  idGen?: () => string;
  now?: () => Date;
}
