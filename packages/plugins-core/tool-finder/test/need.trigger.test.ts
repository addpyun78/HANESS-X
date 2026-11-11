import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createHarnessMcpServer, openSession, TOOLS_REQUEST_TOOL } from '@harness-x/mcp-host';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ALREADY_HAVE_MESSAGE,
  inferNeed,
  matchRegistry,
  parseAssistSettings,
  parseToolsCommand,
  selectAssistEngine,
  ToolFinder,
  ToolNeedHub,
  type AssistAsk,
  type FindResult,
} from '../src/index.js';
import { hit, NOW, staticProvider, tempHome, toolEntry } from './helpers.js';

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});
function home() {
  const t = tempHome();
  cleanups.push(t.cleanup);
  return t.dir;
}

function finder(tools = [] as ReturnType<typeof toolEntry>[]) {
  const p = staticProvider('pkg', 'package', [
    hit({ name: 'ffmpeg', license: 'GPL-3.0', os: ['windows'] }),
    hit({ name: 'HandBrake', license: 'GPL-2.0' }),
  ]);
  const f = new ToolFinder({
    home: home(),
    registry: { list: () => tools },
    packageProviders: [p],
    webProviders: [],
    os: 'windows',
    now: () => NOW,
  });
  return { f, p };
}

describe('P3-A.1 발동 시점 4가지 (모킹)', () => {
  it('① 체크리스트 분해: assist AI가 필요한 능력을 말하고, 도구 목록에 없을 때만 찾기', async () => {
    const { f, p } = finder([
      toolEntry({ name: 'pandoc', purpose: '문서 형식 바꾸기', capabilities: ['문서 형식 바꾸기'] }),
    ]);
    const results: FindResult[] = [];
    const hub = new ToolNeedHub(f, (r) => results.push(r));
    const asked: string[] = [];
    const ask: AssistAsk = async (engineId, q) => {
      asked.push(`${engineId}:${q.user}`);
      if (q.user.includes('소리'))
        return '{"needsTool": true, "capability": "동영상에서 소리만 뽑아내기", "why": "소리 파일이 필요해요"}';
      if (q.user.includes('문서')) return '{"needsTool": true, "capability": "문서 형식 바꾸기", "why": ""}';
      return '{"needsTool": false}';
    };
    const out = await hub.fromChecklist(
      [
        { id: '4.1', title: '폴더 만들기' },
        { id: '4.2', title: '동영상에서 소리 뽑기' },
        { id: '4.3', title: '문서를 PDF로 바꾸기' },
      ],
      { ask, engineId: 'codex', tools: [toolEntry({ name: 'pandoc', capabilities: ['문서 형식 바꾸기'] })] },
    );
    expect(asked).toHaveLength(3);
    expect(asked[0]).toMatch(/^codex:항목: 폴더 만들기/);
    expect(out).toHaveLength(1);
    expect(out[0]!.need).toMatchObject({
      source: 'checklist',
      requiredBy: { itemId: '4.2' },
      capability: '동영상에서 소리만 뽑아내기',
    });
    expect(results).toEqual(out);
    expect(p.queries).toEqual(['동영상에서 소리만 뽑아내기']);
  });

  it('② 에이전트 초안 빈 칸', async () => {
    const { f } = finder();
    const r = await new ToolNeedHub(f).fromGap({ nodeId: 'n4', capability: 'PDF에서 표 뽑기' });
    expect(r.need).toMatchObject({ source: 'agent-gap', requiredBy: { nodeId: 'n4' } });
  });

  it('③ /tools 찾아줘 · 채팅 요청 (아닌 말은 무시)', async () => {
    expect(parseToolsCommand('/tools 찾아줘 동영상에서 소리 뽑기')).toEqual({
      capability: '동영상에서 소리 뽑기',
      source: 'user',
    });
    expect(parseToolsCommand('/tools 동영상에서 소리 뽑기')!.capability).toBe('동영상에서 소리 뽑기');
    expect(parseToolsCommand('/tools 찾아줘: PDF 표 뽑기')!.capability).toBe('PDF 표 뽑기');
    expect(parseToolsCommand('동영상에서 소리 뽑는 도구 찾아줘')!.capability).toBe('동영상에서 소리 뽑는');
    expect(parseToolsCommand('PDF 표 뽑기 도구 추천해 주세요')!.capability).toBe('PDF 표 뽑기');
    expect(parseToolsCommand('/tools')).toBeUndefined();
    expect(parseToolsCommand('오늘 날씨 어때?')).toBeUndefined();
    const { f, p } = finder();
    const hub = new ToolNeedHub(f);
    const r = await hub.fromChat('/tools 찾아줘 동영상에서 소리 뽑기');
    expect(r!.need.source).toBe('user');
    expect(await hub.fromChat('안녕하세요')).toBeUndefined();
    expect(p.queries).toHaveLength(1);
  });

  it('④ 엔진 MCP 도구 tools.request → 카드, 엔진에는 요약만 (설치 도구 없음)', async () => {
    const { f } = finder();
    const seen: FindResult[] = [];
    const hub = new ToolNeedHub(f, (r) => seen.push(r));
    const t = tempHome();
    cleanups.push(t.cleanup);
    const server = createHarnessMcpServer(openSession({ dir: t.dir }), { tools: hub.mcpProvider() });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: 'engine', version: '0' });
    await client.connect(b);
    cleanups.push(() => client.close());
    const names = (await client.listTools()).tools.map((x) => x.name);
    expect(names).toContain(TOOLS_REQUEST_TOOL);
    expect(names.filter((n) => /install|execute/.test(n))).toEqual([]);
    const r = await client.callTool({
      name: 'tools.request',
      arguments: { capability: '동영상에서 소리 뽑기', itemId: '4.2' },
    });
    expect(r.structuredContent).toMatchObject({ status: 'waiting-user' });
    expect(seen[0]!.need).toMatchObject({ source: 'engine', requiredBy: { itemId: '4.2' } });
  });
});

describe('P3-A.3 도구 목록 먼저 매칭: 이미 있으면 검색 없이 "이미 있는 도구를 쓸게요"', () => {
  it('매칭되면 검색 호출 0건', async () => {
    const ff = toolEntry({
      name: 'ffmpeg',
      purpose: '동영상에서 소리만 뽑아내기',
      capabilities: ['cli', '동영상에서 소리만 뽑아내기'],
    });
    const { f, p } = finder([ff]);
    const r = await f.find({ capability: '동영상에서 소리만 뽑아내기' });
    expect(r).toMatchObject({ status: 'have', message: ALREADY_HAVE_MESSAGE, tool: { name: 'ffmpeg' } });
    expect(ALREADY_HAVE_MESSAGE).toBe('이미 있는 도구를 쓸게요.');
    expect(p.queries).toHaveLength(0);
    // 낱말 겹침으로도 매칭 (용도 글)
    const jq = toolEntry({ name: 'jq', purpose: 'JSON 파일 내용 뽑기·바꾸기', capabilities: ['cli'] });
    expect(matchRegistry('JSON 내용 뽑기', [jq])?.name).toBe('jq');
    // 안 맞으면 찾는다
    const r2 = await f.find({ capability: 'PDF 표 뽑기' });
    expect(r2.status).toBe('candidates');
    expect(p.queries).toHaveLength(1);
  });

  it('엔진 tools.request도 이미 있으면 그 도구 경로·사용법을 바로 돌려준다', async () => {
    const ff = toolEntry({ name: 'ffmpeg', capabilities: ['동영상에서 소리 뽑기'] });
    const { f, p } = finder([ff]);
    const out = await new ToolNeedHub(f).fromEngine({ capability: '동영상에서 소리 뽑기' });
    expect(out).toMatchObject({ status: 'have', tool: { command: 'C:\\Tools\\ffmpeg.exe' } });
    expect(p.queries).toHaveLength(0);
  });
});

describe('P3-A.5 필요 도구 판단 AI: assist.engine → judge.engine → 세션 엔진', () => {
  const engines = [
    { id: 'claude-code', detected: true, loggedIn: true },
    { id: 'codex', detected: true, loggedIn: true },
    { id: 'antigravity', detected: true, loggedIn: false },
  ];
  it('선택 순서', () => {
    expect(
      selectAssistEngine(
        { assistEngine: 'codex', judgeEngine: 'claude', sessionEngine: 'claude-code' },
        engines,
      ),
    ).toEqual({ engineId: 'codex', from: 'assist' });
    expect(
      selectAssistEngine({ assistEngine: '', judgeEngine: 'claude', sessionEngine: 'codex' }, engines),
    ).toEqual({ engineId: 'claude-code', from: 'judge' });
    // assist 엔진이 로그인 안 됨 → judge로
    expect(selectAssistEngine({ assistEngine: 'agy', judgeEngine: 'codex' }, engines)).toEqual({
      engineId: 'codex',
      from: 'judge',
    });
    expect(selectAssistEngine({ sessionEngine: 'codex' }, engines)).toEqual({
      engineId: 'codex',
      from: 'session',
    });
    expect(selectAssistEngine({ assistEngine: 'antigravity' }, engines)).toEqual({
      engineId: null,
      from: 'none',
    });
    expect(parseAssistSettings({ assist: { engine: 'codex' } })).toEqual({ engine: 'codex', model: '' });
    expect(parseAssistSettings({})).toEqual({ engine: '', model: '' });
  });

  it('질문에는 항목 제목만, 답이 깨지면 판단 없음', async () => {
    const qs: { system: string; user: string }[] = [];
    const ask: AssistAsk = async (_e, q) => (qs.push(q), 'not json');
    expect(await inferNeed(ask, 'codex', { title: '소리 뽑기' })).toBeUndefined();
    expect(qs[0]!.system).toMatch(/도구를 쓰지 말고/);
    expect(qs[0]!.user).toBe('항목: 소리 뽑기');
    const failing: AssistAsk = async () => {
      throw new Error('offline');
    };
    expect(await inferNeed(failing, 'codex', { title: 'x' })).toBeUndefined();
  });
});
