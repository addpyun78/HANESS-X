import type { ChecklistLedger } from '@harness-x/checklist-ledger';
import type { ToolEntry } from '@harness-x/installer';
import { inferNeed, type AssistAsk } from './assist.js';
import type { FindResult, NeedRequest, ToolFinder } from './finder.js';
import { waitForTool } from './flow.js';
import { matchRegistry } from './match.js';

/**
 * P3-A.1 발동 시점 4가지 → 모두 ToolFinder.find 하나로 모인다.
 *   ① 체크리스트 분해 때 필요한 능력이 도구 목록에 없을 때 (assist AI가 항목 제목으로 판단, A.5)
 *   ② Part 4 에이전트 초안의 빈 칸
 *   ③ 사용자가 `/tools 찾아줘 …` 또는 채팅으로 요청
 *   ④ 작업 중 엔진이 MCP 도구 `tools.request(능력 설명)` 호출
 * 결과는 onResult로 넘겨 화면에 "도구 고르기" 카드를 띄운다 (설치는 사람이 고른 뒤에만).
 */

export const TOOLS_COMMAND = '/tools';

/** `/tools 찾아줘 동영상에서 소리 뽑기` · `/tools 동영상…` · "동영상에서 소리 뽑는 도구 찾아줘" */
export function parseToolsCommand(text: string): NeedRequest | undefined {
  const t = text.trim();
  const cmd = /^\/tools(?:\s+(.*))?$/s.exec(t);
  if (cmd) {
    const rest = (cmd[1] ?? '')
      .replace(/^(찾아\s?줘|찾기|find)\s*[:：]?\s*/i, '')
      .replace(/\s*(찾아\s?줘|찾아\s?주세요)$/, '')
      .trim();
    return rest.length >= 2 ? { capability: rest, source: 'user' } : undefined;
  }
  const chat =
    /^(.{2,80}?)\s*(?:하는|할 수 있는|용)?\s*도구\s*(?:좀\s*)?(?:찾아\s?줘|찾아\s?주세요|추천해\s?줘|추천해\s?주세요)[.!?]?$/.exec(
      t,
    );
  if (chat) return { capability: chat[1]!.trim(), source: 'user' };
  return undefined;
}

/** Part 4 에이전트 초안의 빈 칸 */
export interface AgentGap {
  nodeId: string;
  /** 쉬운 말 능력 설명 */
  capability: string;
  why?: string;
}

export function needFromGap(gap: AgentGap): NeedRequest {
  return {
    capability: gap.capability,
    ...(gap.why ? { why: gap.why } : {}),
    requiredBy: { nodeId: gap.nodeId },
    source: 'agent-gap',
  };
}

/** MCP `tools.request` 입력 */
export interface ToolsRequestArgs {
  capability: string;
  why?: string;
  itemId?: string;
}

export interface ChecklistItemLike {
  id: string;
  title: string;
  description?: string;
}

export class ToolNeedHub {
  constructor(
    private readonly finder: ToolFinder,
    private readonly onResult: (r: FindResult) => void = () => {},
    /** 있으면 항목이 필요로 하는 도구 후보가 나왔을 때 그 항목을 blocked(tool_needed)로 둔다 */
    private readonly ledger?: ChecklistLedger,
  ) {}

  private async run(req: NeedRequest): Promise<FindResult> {
    const r = await this.finder.find(req);
    const by = r.need.requiredBy;
    if (this.ledger && r.status === 'candidates' && by && 'itemId' in by) {
      const st = this.ledger.read()?.items.find((i) => i.id === by.itemId)?.status;
      if (st && st !== 'done') waitForTool(this.ledger, by.itemId, r.need);
    }
    this.onResult(r);
    return r;
  }

  /** ① 체크리스트 분해 직후: 항목마다 assist AI에게 필요한 능력을 묻고, 도구 목록에 없으면 찾기 */
  async fromChecklist(
    items: readonly ChecklistItemLike[],
    o: { ask: AssistAsk; engineId: string; tools: readonly ToolEntry[] },
  ): Promise<FindResult[]> {
    const out: FindResult[] = [];
    for (const it of items) {
      const n = await inferNeed(o.ask, o.engineId, it);
      if (!n || matchRegistry(n.capability, o.tools)) continue;
      out.push(
        await this.run({
          capability: n.capability,
          why: n.why,
          requiredBy: { itemId: it.id },
          source: 'checklist',
        }),
      );
    }
    return out;
  }

  /** ② 에이전트 초안 빈 칸 */
  fromGap(gap: AgentGap): Promise<FindResult> {
    return this.run(needFromGap(gap));
  }

  /** ③ 채팅·`/tools` 명령. 도구 찾기 요청이 아니면 undefined */
  async fromChat(text: string): Promise<FindResult | undefined> {
    const req = parseToolsCommand(text);
    return req ? this.run(req) : undefined;
  }

  /** ④ 엔진 MCP `tools.request` — 엔진에게는 카드가 떠서 사람이 고른다는 사실과 요약만 돌려준다 */
  async fromEngine(args: ToolsRequestArgs): Promise<Record<string, unknown>> {
    const r = await this.run({
      capability: args.capability,
      ...(args.why ? { why: args.why } : {}),
      ...(args.itemId ? { requiredBy: { itemId: args.itemId } } : {}),
      source: 'engine',
    });
    if (r.status === 'have')
      return {
        status: 'have',
        message: r.message,
        tool: { id: r.tool.id, name: r.tool.name, command: r.tool.command, howToUse: r.tool.howToUse },
      };
    return {
      status: 'waiting-user',
      message: '사람이 도구 고르기 카드에서 고를 때까지 기다려요. 다른 독립 항목을 먼저 진행하세요.',
      candidates: r.candidates.map((c) => ({ name: c.name, pricing: c.pricing.tier })),
    };
  }

  /** mcp-host `createHarnessMcpServer({ tools })`에 넘길 제공자 */
  mcpProvider(): { request(args: ToolsRequestArgs): Promise<Record<string, unknown>> } {
    return { request: (a) => this.fromEngine(a) };
  }
}
