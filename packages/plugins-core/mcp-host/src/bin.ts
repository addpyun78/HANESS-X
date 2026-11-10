#!/usr/bin/env node
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openSession } from './host.js';
import { createHarnessMcpServer } from './server.js';
import { serveStdio, startMcpHttpServer } from './transports.js';

/**
 * harness-mcp — 하네스 MCP 서버 단독 실행
 *   harness-mcp --dir <세션 폴더> [--session <id>] [--glossary <file>]            (stdio)
 *   (--node-output: 파이프라인 노드 출력 도구 node.output 추가, T-042)
 *   harness-mcp --dir <세션 폴더> --http [--port <n>] [--token <t>]               (streamable HTTP)
 * stdout은 stdio 전송이 쓰므로 진단은 stderr로만 낸다.
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      dir: { type: 'string' },
      session: { type: 'string' },
      glossary: { type: 'string' },
      http: { type: 'boolean' },
      port: { type: 'string' },
      token: { type: 'string' },
      'tool-names': { type: 'string' },
      'node-output': { type: 'boolean' },
    },
  });
  const dir = resolve(values.dir ?? process.cwd());
  const deps = openSession({
    dir,
    ...(values.session ? { sessionId: values.session } : {}),
    ...(values.glossary ? { glossaryFile: resolve(values.glossary) } : {}),
  });
  const toolNames = values['tool-names'] === 'underscore' ? 'underscore' : 'dotted';
  const make = () => createHarnessMcpServer(deps, { toolNames, nodeOutput: values['node-output'] === true });
  if (values.http) {
    const srv = await startMcpHttpServer({
      createServer: make,
      port: values.port ? Number(values.port) : 0,
      ...(values.token ? { token: values.token } : {}),
    });
    process.stdout.write(JSON.stringify({ event: 'listening', url: srv.url, port: srv.port }) + '\n');
    const stop = () => void srv.close().then(() => process.exit(0));
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    return;
  }
  await serveStdio(make());
  process.stderr.write(`harness-mcp stdio ready (dir=${dir})\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(String(err instanceof Error ? (err.stack ?? err.message) : err) + '\n');
  process.exit(1);
});
