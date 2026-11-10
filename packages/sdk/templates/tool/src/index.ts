/**
 * {{displayName}} — 도구 플러그인
 * 도구 1개: 입력 JSON Schema + run(). 권한 밖 호출은 하네스가 막는다.
 */

export interface PluginContext {
  manifest: { id: string; version: string };
  log(message: string): void;
}

export interface ToolInput {
  text: string;
}

export interface ToolResult {
  ok: boolean;
  output: string;
}

export const tool = {
  name: '{{id}}',
  description: '{{json:description}}',
  inputSchema: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
  },
  async run(input: ToolInput): Promise<ToolResult> {
    return { ok: true, output: input.text };
  },
};

export function activate(ctx: PluginContext): void {
  ctx.log(`tool ${tool.name} registered`);
}

export function deactivate(): void {}
