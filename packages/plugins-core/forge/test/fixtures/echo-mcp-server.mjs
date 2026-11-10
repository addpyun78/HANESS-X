// 테스트용 stdio MCP 서버: 도구 echo, word_count
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer({ name: 'echo-fixture', version: '0.0.1' });
server.registerTool('echo', { description: '받은 글을 그대로 돌려준다' }, async () => ({
  content: [{ type: 'text', text: 'echo' }],
}));
server.registerTool('word_count', { description: '낱말 수를 센다' }, async () => ({
  content: [{ type: 'text', text: '0' }],
}));
await server.connect(new StdioServerTransport());
