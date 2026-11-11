import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  HarnessToolError,
  currentItem,
  proposeChecklist,
  resolveArtifact,
  startItem,
  submitItem,
  type HarnessToolDeps,
} from './tools.js';

/**
 * 하네스 MCP 서버 (T-023): 체크리스트 원장·경로 원장을 엔진에게 MCP 도구로 제공한다.
 * 전송(stdio / streamable HTTP)은 transports.ts가 붙인다.
 */

export const MCP_SERVER_NAME = 'harness';
export const MCP_SERVER_VERSION = '0.1.0';

/** 도구 이름 (MCP 규격은 점을 허용한다) */
export const HARNESS_TOOLS = [
  'checklist.propose',
  'checklist.start',
  'checklist.submit',
  'checklist.current',
  'manifest.resolve',
] as const;
export type HarnessToolName = (typeof HARNESS_TOOLS)[number];

/**
 * T-100 P2-A.7 설치 관리자 도구: AI에게는 찾기·주소 해석·계획만 준다.
 * 실행(install.execute)·제거(uninstall)는 MCP 도구로 절대 노출하지 않는다 — 사람 클릭 토큰이 필요한 API로만.
 */
export const INSTALL_MCP_TOOLS = ['install.search', 'install.resolve', 'install.plan'] as const;
export type InstallMcpToolName = (typeof INSTALL_MCP_TOOLS)[number];

/** @harness-x/installer의 InstallService가 구현 (mcp-host는 설치 관리자에 의존하지 않는다) */
export interface InstallToolsProvider {
  search(query: string, kind?: string): unknown;
  resolve(url: string): unknown;
  plan(req: Record<string, unknown>): unknown;
}

export interface HarnessMcpOptions {
  name?: string;
  version?: string;
  /**
   * 'dotted'(기본) = checklist.propose, 'underscore' = checklist_propose
   * (도구 이름에 점을 못 쓰는 클라이언트용)
   */
  toolNames?: 'dotted' | 'underscore';
  /**
   * T-042: 파이프라인 노드 출력 도구 node.output(json)도 등록한다.
   * 하네스 실행기는 이 도구의 tool_call 입력을 노드 출력으로 읽는다(받은 값은 그대로 돌려준다).
   */
  nodeOutput?: boolean;
  /** T-100 A.7: 설치 관리자 도구 install.search·install.resolve·install.plan 등록 */
  install?: InstallToolsProvider;
  /** T-100 P3-A.1 ④ 도구 찾기 요청 tools.request 등록 */
  tools?: ToolsRequestProvider;
}

/**
 * T-100 P3-A.1 ④ 도구 찾기 요청: 엔진이 작업 중 필요한 능력을 설명하면 사람에게 "도구 고르기" 카드가 뜬다.
 * 찾기·추천만 하고 설치는 하지 않는다.
 */
export const TOOLS_REQUEST_TOOL = 'tools.request';

/** @harness-x/tool-finder의 ToolNeedHub.mcpProvider()가 구현 */
export interface ToolsRequestProvider {
  request(args: { capability: string; why?: string; itemId?: string }): unknown;
}

/** 파이프라인 노드 출력 도구 이름 (nodeOutput 옵션) */
export const NODE_OUTPUT_TOOL = 'node.output';

export function toolName(base: HarnessToolName, style: HarnessMcpOptions['toolNames'] = 'dotted'): string {
  return style === 'underscore' ? base.replace(/\./g, '_') : base;
}

const AcceptanceShape = z.looseObject({ type: z.string() });
const ProposedItemShape = z.looseObject({
  id: z.string().describe('항목 id (예: "1", "1.2")'),
  title: z.string().describe('동사 1개짜리 제목'),
  artifactId: z.unknown().describe('산출물 ID 1개 (예: art.mobile-app)'),
  acceptance: z
    .array(AcceptanceShape)
    .optional()
    .describe('기계 검증 조건 (command/test/file_exists/symbol/schema)'),
  deps: z.array(z.string()).optional(),
  parent: z.string().nullable().optional(),
  owner: z.string().nullable().optional(),
  estimate: z.object({ files: z.number().optional(), diffLines: z.number().optional() }).optional(),
});
const ArtifactDraftShape = z.object({
  artifactId: z.string(),
  displayName: z.string().describe('표시 이름 (한글 허용, 예: 하네스/모바일)'),
  kind: z.enum(['file', 'dir']),
  path: z.string().optional(),
});
const EvidenceShape = z.looseObject({ kind: z.string(), summary: z.string().optional() });

type ToolResult = {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function ok(value: unknown): ToolResult {
  const structured =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : { value };
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: structured };
}

function fail(err: unknown): ToolResult {
  const body =
    err instanceof HarnessToolError
      ? { error: err.code, message: err.message }
      : { error: 'ERROR', message: err instanceof Error ? err.message : String(err) };
  return { content: [{ type: 'text', text: JSON.stringify(body) }], isError: true };
}

async function run(fn: () => unknown): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    return fail(err);
  }
}

/** 도구 5개가 등록된 McpServer (전송은 아직 연결 전) */
export function createHarnessMcpServer(deps: HarnessToolDeps, opts: HarnessMcpOptions = {}): McpServer {
  const server = new McpServer({
    name: opts.name ?? MCP_SERVER_NAME,
    version: opts.version ?? MCP_SERVER_VERSION,
  });
  const n = (b: HarnessToolName) => toolName(b, opts.toolNames);

  server.registerTool(
    n('checklist.propose'),
    {
      title: '체크리스트 제안',
      description:
        '작업 체크리스트(항목 트리)를 제안한다. 원자성 린터를 통과하면 저장하고, 위반이 있으면 ok:false와 재분해 요청 메시지를 돌려준다. artifacts를 주면 manifest(산출물 ID → 정식 경로)를 잠근다.',
      inputSchema: {
        items: z.array(ProposedItemShape).min(1),
        artifacts: z.array(ArtifactDraftShape).optional(),
      },
    },
    (args) =>
      run(() =>
        proposeChecklist(deps, {
          items: args.items as Record<string, unknown>[],
          ...(args.artifacts ? { artifacts: args.artifacts } : {}),
        }),
      ),
  );

  server.registerTool(
    n('checklist.start'),
    {
      title: '항목 시작',
      description: '항목을 doing 상태로 바꾼다 (todo 또는 failed에서만).',
      inputSchema: { id: z.string() },
    },
    (args) => run(() => startItem(deps, args.id)),
  );

  server.registerTool(
    n('checklist.submit'),
    {
      title: '항목 제출',
      description: '항목을 증거와 함께 verifying 상태로 제출한다 (doing에서만). 판정은 하네스가 한다.',
      inputSchema: { id: z.string(), evidence: z.array(EvidenceShape).optional() },
    },
    (args) => run(() => submitItem(deps, args.id, args.evidence ?? [])),
  );

  server.registerTool(
    n('checklist.current'),
    {
      title: '현재 항목',
      description:
        '지금 할 항목과 그 산출물의 정식 경로, 다음 항목 3개를 돌려준다. 파일은 정식 경로에만 쓴다.',
      inputSchema: {},
    },
    () => run(() => currentItem(deps)),
  );

  server.registerTool(
    n('manifest.resolve'),
    {
      title: '정식 경로 조회',
      description: '산출물 ID → manifest의 정식 경로·표시 이름·종류.',
      inputSchema: { artifactId: z.string() },
    },
    (args) => run(() => resolveArtifact(deps, args.artifactId)),
  );

  if (opts.nodeOutput)
    server.registerTool(
      opts.toolNames === 'underscore' ? NODE_OUTPUT_TOOL.replace(/\./g, '_') : NODE_OUTPUT_TOOL,
      {
        title: '노드 출력 제출',
        description:
          '이 파이프라인 노드의 결과를 outputSchema에 맞는 JSON 객체로 제출한다. 다음 노드에는 이 값이 그대로 전달된다.',
        inputSchema: { json: z.unknown().describe('outputSchema를 따르는 JSON 객체 (또는 그 JSON 문자열)') },
      },
      (args) => run(() => ({ accepted: true, json: args.json })),
    );

  if (opts.install) registerInstallTools(server, opts.install, opts.toolNames);
  if (opts.tools) {
    const p = opts.tools;
    server.registerTool(
      opts.toolNames === 'underscore' ? TOOLS_REQUEST_TOOL.replace(/\./g, '_') : TOOLS_REQUEST_TOOL,
      {
        title: '필요한 도구 요청',
        description:
          '작업에 필요한 프로그램 능력을 쉬운 말로 설명하면(코드·파일 내용·비밀 금지) 이미 있는 도구를 알려 주거나, 사람에게 무료/유료가 표시된 후보 카드를 띄운다. 설치는 사람이 고른 뒤에만 된다.',
        inputSchema: {
          capability: z
            .string()
            .min(2)
            .max(80)
            .describe('쉬운 말 능력 설명 (예: 동영상에서 소리만 뽑아내기)'),
          why: z.string().optional(),
          itemId: z.string().optional(),
        },
      },
      (args) =>
        run(() =>
          p.request({
            capability: args.capability,
            ...(args.why ? { why: args.why } : {}),
            ...(args.itemId ? { itemId: args.itemId } : {}),
          }),
        ),
    );
  }

  return server;
}

function registerInstallTools(
  server: McpServer,
  p: InstallToolsProvider,
  style: HarnessMcpOptions['toolNames'] = 'dotted',
): void {
  const n = (b: InstallMcpToolName) => (style === 'underscore' ? b.replace(/\./g, '_') : b);
  server.registerTool(
    n('install.search'),
    {
      title: '설치할 도구 찾기',
      description:
        '설치할 수 있는 앱·도구·모델 후보를 찾는다(실행 없음). 결과에서 하나를 골라 install.plan으로 계획을 만든다. 설치는 사람이 화면에서 승인해야만 실행된다.',
      inputSchema: { query: z.string().min(1), kind: z.string().optional() },
    },
    (args) => run(() => p.search(args.query, args.kind)),
  );
  server.registerTool(
    n('install.resolve'),
    {
      title: '주소로 설치 방법 찾기',
      description:
        '사용자가 준 주소(GitHub·npm·PyPI·Ollama·VS Code 마켓·Docker Hub·설치 파일·MCP 주소 등)를 읽기만 해서 설치 후보와 추천을 돌려준다. 코드는 실행하지 않는다.',
      inputSchema: { url: z.string().min(1) },
    },
    (args) => run(() => p.resolve(args.url)),
  );
  server.registerTool(
    n('install.plan'),
    {
      title: '설치 계획 만들기',
      description:
        '설치 계획(무엇을·어디서·무료/유료·바뀌는 것·위험·지우는 방법)을 만들어 사람에게 보여 줄 카드로 돌려준다. 실행하지 않는다.',
      inputSchema: {
        kind: z.string(),
        target: z.object({
          id: z.string(),
          version: z.string().optional(),
          name: z.string().optional(),
          options: z.record(z.string(), z.unknown()).optional(),
        }),
      },
    },
    (args) => run(() => p.plan(args as Record<string, unknown>)),
  );
}
