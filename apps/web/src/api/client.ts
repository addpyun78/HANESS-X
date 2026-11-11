import type { DispatchSessionLike } from '../shell/agent-sessions.js';
import type { AgentInput, AgentListResponse, HarnessEvent, PipelineInput } from '@harness-x/protocol';

/**
 * 로컬 하네스 API 클라이언트 (packages/kernel/src/api/server.ts와 짝)
 * - HTTP: Authorization: Bearer <token>
 * - WebSocket /ws/events?token=<token>[&sessionId=&type=] — 첫 메시지 {type:'hello'}, 이후 HarnessEvent JSON
 * - 연결이 끊기면(서버 재기동 등) 지수 백오프로 자동 재연결, 연결되면 백오프 초기화
 */

export const DEFAULT_API_URL = 'http://127.0.0.1:3790';
export const TOKEN_STORAGE_KEY = 'hx-token';

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface BackoffOptions {
  /** 첫 재시도 대기 (기본 500ms) */
  initialMs?: number;
  /** 최대 대기 (기본 10초) */
  maxMs?: number;
  /** 배수 (기본 2) */
  factor?: number;
  /** 0~1 무작위 가감 비율 (기본 0.2) */
  jitter?: number;
}

export function backoffDelay(
  attempt: number,
  o: BackoffOptions = {},
  rand: () => number = Math.random,
): number {
  const base = Math.min((o.initialMs ?? 500) * (o.factor ?? 2) ** attempt, o.maxMs ?? 10_000);
  const j = o.jitter ?? 0.2;
  return Math.round(base * (1 - j + 2 * j * rand()));
}

export interface PluginInfo {
  id: string;
  version: string;
  displayName: string;
  description?: string;
  state: string;
  origin: string;
  slots: string[];
  provides?: Record<string, unknown>;
  error?: string;
}

export interface PluginsResponse {
  plugins: PluginInfo[];
  rejected: { id?: string; dir: string; reason: string }[];
}

/** POST /api/native/pick-folder 응답 */
export type PickFolderResponse = { cancelled: true } | { cancelled: false; path: string };

/** 커널 WorkspaceInfo (packages/kernel/src/workspaces.ts) */
export interface WorkspaceInfo {
  name: string;
  path: string;
  lastUsedAt: string;
  pinned?: boolean;
  git: boolean;
  branch?: string;
  hasAgentsMd: boolean;
  hasClaudeMd: boolean;
}

export interface WorkspacesResponse {
  current?: WorkspaceInfo;
  recent: WorkspaceInfo[];
  cwd?: string;
}

/** PUT /api/agents/:name 요청 (kernel api/agents-routes.ts) */
export interface SaveAgentRequest {
  agent: Omit<AgentInput, 'pipeline'> & { pipeline?: string };
  pipeline: PipelineInput;
  overwrite?: boolean;
}

export interface SaveAgentResponse {
  name: string;
  command: string;
  dir: string;
  files: string[];
  created: boolean;
}

export interface CreateSessionRequest {
  /** 이름 또는 /명령 */
  agent: string;
  prompt: string;
  modifiers?: { engine?: string; strict?: boolean; planOnly?: boolean };
  /** T-101 0B.39 만들 때 저장할 프로젝트 */
  projectId?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`하네스 API 오류 ${status}`);
  }
}

type WebSocketCtor = new (url: string) => WebSocket;

export interface ApiClientOptions {
  /** 기본: 브라우저면 현재 출처(개발 서버 프록시), 아니면 127.0.0.1:3790 */
  baseUrl?: string;
  token: string;
  fetch?: typeof fetch;
  WebSocket?: WebSocketCtor;
  backoff?: BackoffOptions;
}

export interface EventStreamOptions {
  sessionId?: string;
  type?: string;
  onEvent: (ev: HarnessEvent) => void;
  onStatus?: (s: ConnectionStatus) => void;
}

export interface EventStream {
  readonly status: ConnectionStatus;
  /** 지금까지 연결에 성공한 횟수 (재연결 확인용) */
  readonly connects: number;
  close(): void;
}

export class HarnessApiClient {
  readonly baseUrl: string;
  readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly WS: WebSocketCtor;
  private readonly backoff: BackoffOptions;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = (opts.baseUrl ?? defaultBaseUrl()).replace(/\/+$/, '');
    this.token = opts.token;
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.WS = opts.WebSocket ?? globalThis.WebSocket;
    this.backoff = opts.backoff ?? {};
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${this.token}`);
    if (init.body !== undefined && !headers.has('content-type'))
      headers.set('content-type', 'application/json');
    const res = await this.fetchImpl(this.baseUrl + path, { ...init, headers });
    const text = await res.text();
    const body: unknown = text ? safeJson(text) : undefined;
    if (!res.ok) throw new ApiError(res.status, body);
    return body as T;
  }

  health() {
    return this.request<{ ok: boolean; port: number }>('/api/health');
  }

  plugins() {
    return this.request<PluginsResponse>('/api/plugins');
  }

  /** 34.2 서버가 네이티브 폴더 대화상자를 띄운다 (이미 떠 있으면 ApiError 409) */
  pickFolder(initialPath?: string) {
    return this.request<PickFolderResponse>('/api/native/pick-folder', {
      method: 'POST',
      body: JSON.stringify(initialPath ? { initialPath } : {}),
    });
  }

  /** 35.x 현재 워크스페이스·최근 프로젝트 */
  workspaces() {
    return this.request<WorkspacesResponse>('/api/workspaces');
  }

  /** 35.1~35.2 검증 → 등록 → 현재 워크스페이스 (거부면 ApiError 400 {error, message}) */
  openWorkspace(path: string) {
    return this.request<{ workspace: WorkspaceInfo; recent: WorkspaceInfo[] }>('/api/workspaces/open', {
      method: 'POST',
      body: JSON.stringify({ path }),
    });
  }

  pinWorkspace(path: string, pinned: boolean) {
    return this.request<{ recent: WorkspaceInfo[] }>('/api/workspaces/pin', {
      method: 'POST',
      body: JSON.stringify({ path, pinned }),
    });
  }

  /** T-051 Forge 질문·spec·설치 카드 답 → POST /api/forge/answers/:id (서버가 forge_answer 이벤트를 남긴다) */
  forgeAnswer(approvalId: string, answer: { value: string | string[]; text?: string }) {
    return this.request<{ approvalId: string }>(`/api/forge/answers/${encodeURIComponent(approvalId)}`, {
      method: 'POST',
      body: JSON.stringify(answer),
    });
  }

  /** GET /api/agents — 등록된 에이전트 요약 (빌더·/ 팔레트) */
  agents() {
    return this.request<AgentListResponse>('/api/agents');
  }

  /** T-100 P2-A.6 사람 클릭 토큰 (1회용·60초) — 버튼 클릭 처리기 안에서만 부른다 */
  gestureToken(kind: 'save-agent') {
    return this.request<{ token: string }>('/api/gesture-tokens', {
      method: 'POST',
      body: JSON.stringify({ kind }),
    }).then((r) => r.token);
  }

  /**
   * 46.3 PUT /api/agents/:name — 빌더 저장 (~/.harness-x/agents/<name>/agent.yaml + pipeline.yaml)
   * P4-F.2: 사람 클릭 토큰(save-agent)을 헤더 x-harness-gesture로 보낸다 (없으면 403)
   */
  saveAgent(name: string, body: SaveAgentRequest, gestureToken: string) {
    return this.request<SaveAgentResponse>(`/api/agents/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
      headers: { 'x-harness-gesture': gestureToken },
    });
  }

  /** 48.1 POST /api/sessions — 에이전트 칩 + 지시문 → 새 세션 (수식어 @엔진 #strict !plan은 prompt 안에) */
  createSession(req: CreateSessionRequest) {
    return this.request<DispatchSessionLike>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  }

  /** 48.4 실행 중 세션에 서브에이전트 추가 */
  addSubagent(sessionId: string, agent: string) {
    return this.request<DispatchSessionLike>(`/api/sessions/${encodeURIComponent(sessionId)}/subagents`, {
      method: 'POST',
      body: JSON.stringify({ agent }),
    });
  }

  /** T-101 2A.2 ⏸ 일시정지 (안전한 지점에서 멈춤) */
  pauseSession(sessionId: string) {
    return this.request<{ state: string }>(`/api/sessions/${encodeURIComponent(sessionId)}/pause`, {
      method: 'POST',
      body: '{}',
    });
  }

  /** T-101 2A.2 ⏹ 지금 멈추기 */
  stopSession(sessionId: string) {
    return this.request<{ state: string }>(`/api/sessions/${encodeURIComponent(sessionId)}/stop`, {
      method: 'POST',
      body: '{}',
    });
  }

  /** T-101 2A.2 전체 정지 (실행 중 세션 전부) */
  stopAllSessions() {
    return this.request<{ results: { sessionId: string; state: string }[] }>('/api/sessions/stop-all', {
      method: 'POST',
      body: '{}',
    });
  }

  eventsUrl(q: { sessionId?: string; type?: string } = {}): string {
    const u = new URL(this.baseUrl.replace(/^http/, 'ws') + '/ws/events');
    u.searchParams.set('token', this.token);
    if (q.sessionId) u.searchParams.set('sessionId', q.sessionId);
    if (q.type) u.searchParams.set('type', q.type);
    return u.toString();
  }

  /** 37.2 WS /ws/terminal (node-pty 셸, cwd = 워크스페이스) */
  terminalUrl(q: { cols?: number; rows?: number } = {}): string {
    const u = new URL(this.baseUrl.replace(/^http/, 'ws') + '/ws/terminal');
    u.searchParams.set('token', this.token);
    if (q.cols) u.searchParams.set('cols', String(q.cols));
    if (q.rows) u.searchParams.set('rows', String(q.rows));
    return u.toString();
  }

  openSocket(url: string): WebSocket {
    return new this.WS(url);
  }

  events(opts: EventStreamOptions): EventStream {
    let status: ConnectionStatus = 'connecting';
    let ws: WebSocket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let connects = 0;
    let stopped = false;
    const set = (s: ConnectionStatus) => {
      if (status === s) return;
      status = s;
      opts.onStatus?.(s);
    };
    const connect = () => {
      if (stopped) return;
      const sock = new this.WS(this.eventsUrl(opts));
      ws = sock;
      sock.onopen = () => {
        attempt = 0;
        connects++;
        set('open');
      };
      sock.onmessage = (m: MessageEvent) => {
        const data = safeJson(typeof m.data === 'string' ? m.data : String(m.data));
        if (!data || typeof data !== 'object' || (data as { type?: unknown }).type === 'hello') return;
        opts.onEvent(data as HarnessEvent);
      };
      sock.onclose = () => {
        if (ws !== sock) return;
        ws = undefined;
        if (stopped) return set('closed');
        set('reconnecting');
        timer = setTimeout(connect, backoffDelay(attempt++, this.backoff));
      };
      sock.onerror = () => {
        /* close가 뒤따른다 */
      };
    };
    opts.onStatus?.(status);
    connect();
    return {
      get status() {
        return status;
      },
      get connects() {
        return connects;
      },
      close() {
        stopped = true;
        if (timer) clearTimeout(timer);
        const s = ws;
        ws = undefined;
        s?.close();
        set('closed');
      },
    };
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function defaultBaseUrl(): string {
  const loc = (globalThis as { location?: Location }).location;
  return loc && /^https?:$/.test(loc.protocol) ? loc.origin : DEFAULT_API_URL;
}

/**
 * 브라우저에서 토큰 찾기: URL ?token= (harness-x serve가 여는 주소) → sessionStorage에 보관 후 주소창에서 제거.
 * 토큰 파일(~/.harness-x/run/token)은 브라우저가 읽을 수 없으므로 이 방식만 쓴다.
 */
export function resolveToken(
  loc: Location = location,
  storage: Storage | undefined = globalThis.sessionStorage,
): string | undefined {
  const url = new URL(loc.href);
  const fromUrl = url.searchParams.get('token');
  if (fromUrl) {
    try {
      storage?.setItem(TOKEN_STORAGE_KEY, fromUrl);
    } catch {
      /* noop */
    }
    url.searchParams.delete('token');
    globalThis.history?.replaceState?.(null, '', url.toString());
    return fromUrl;
  }
  try {
    return storage?.getItem(TOKEN_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}
