// C2.5 MCP 도구마다 최소 입력으로 호출 → "미구현"·빈 결과·오류 → raw/shell-mcp.json
// harness-mcp(bin, stdio)를 임시 세션 폴더로 실제 실행하고 MCP SDK 클라이언트로 붙는다(--node-output --attachments 켬).
// install.* · tools.request 는 커널 serve가 설치 서비스를 연결해야 생기는 도구라 여기서는 '미시험(커널 연결 필요)'으로 기록.
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { auditDir, rawDir, readJson, root, writeJson } from './lib.mjs';

const pkg = join(root, 'packages', 'plugins-core', 'mcp-host');
const req = createRequire(join(pkg, 'package.json'));
const imp = (m) => import(pathToFileURL(req.resolve(m)).href);
const { Client } = await imp('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = await imp('@modelcontextprotocol/sdk/client/stdio.js');

const dir = mkdtempSync(join(tmpdir(), 'hx-mcp-'));
const att = join(dir, 'attachments');
mkdirSync(att, { recursive: true });
writeFileSync(join(att, 'note.txt'), '첨부 시험 파일');
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['--no-warnings', join(pkg, 'dist', 'bin.js'), '--dir', dir, '--node-output', '--attachments', att],
  env: { ...process.env, HOME: dir, HARNESS_X_HOME: join(dir, '.hx') },
  stderr: 'ignore',
});
const client = new Client({ name: 'audit-probe', version: '0.0.0' });
await client.connect(transport);
const listed = (await client.listTools()).tools;
const MIN = {
  'checklist.propose': {
    items: [
      { id: '1', title: '시험 항목 만들기', acceptance: [{ type: 'file_exists' }], artifactId: 'art.probe' },
    ],
  },
  'checklist.start': { id: '1' },
  'checklist.submit': { id: '1', evidence: [] },
  'checklist.current': {},
  'manifest.resolve': { artifactId: 'art.probe' },
  'node.output': { json: { ok: true } },
  'attachments.list': {},
  'attachments.read': { id: 'att_probe' },
};
const out = [];
for (const t of listed) {
  const args = MIN[t.name] ?? {};
  try {
    const r = await client.callTool({ name: t.name, arguments: args });
    const text = (r.content ?? []).map((c) => c.text ?? '').join(' ');
    const notImpl = /not implemented|미구현|준비 중|TODO/i.test(text);
    const empty = !text.trim() || text.trim() === '{}' || text.trim() === '[]';
    // 오류 응답이라도 코드·쉬운 말 이유가 있으면 '구현된 거절'(예: 없는 산출물·없는 첨부)로 본다
    const handledError = !!r.isError && /"error":"[A-Z_]+"|NOT_FOUND|UNKNOWN_|찾지 못했어요|없는/.test(text);
    out.push({
      tool: t.name,
      input: args,
      isError: !!r.isError,
      handledError,
      notImplemented: notImpl,
      empty,
      result: text.slice(0, 240),
    });
  } catch (e) {
    out.push({ tool: t.name, input: args, threw: String(e?.message ?? e).slice(0, 200) });
  }
}
await client.close();
rmSync(dir, { recursive: true, force: true });
const snap = readJson(join(auditDir, 'snapshots', 'mcp-tools.json'), []);
const listedNames = new Set(listed.map((t) => t.name));
for (const s of snap)
  if (!listedNames.has(s.name))
    out.push({
      tool: s.name,
      tested: false,
      reason: '커널 serve가 설치·도구 찾기 서비스를 연결해야 생기는 도구(install-tools.test.ts 등이 덮음)',
    });
writeJson(join(rawDir, 'shell-mcp.json'), out);
console.log(
  `probe-mcp: 도구 ${listed.length}개 호출, 미구현 ${out.filter((o) => o.notImplemented).length}, 빈 결과 ${out.filter((o) => o.empty).length}, 구현된 거절 ${out.filter((o) => o.handledError).length}, 처리 안 된 오류 ${out.filter((o) => (o.isError && !o.handledError) || o.threw).length}, 미시험 ${out.filter((o) => o.tested === false).length}`,
);
for (const o of out)
  console.log(
    `  ${o.tool}: ${o.tested === false ? '미시험' : o.threw ? 'THREW ' + o.threw : (o.isError ? 'ERROR ' : 'ok ') + (o.result ?? '').slice(0, 110)}`,
  );
