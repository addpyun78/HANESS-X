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

export interface HarnessMcpOptions {
  name?: string;
  version?: string;
  /**
   * 'dotted'(기본) = checklist.propose, 'underscore' = checklist_propose
   * (도구 이름에 점을 못 쓰는 클라이언트용)
   */
  toolNames?: 'dotted' | 'underscore';
}

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

  return server;
}
