import { ATTACHMENTS_FIELD_SCHEMA, type Attachment, type EngineRunOptions } from '@harness-x/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { PipelineRunner } from '../src/index.js';
import { fakeEngine, pipeline, tmpWorkspace } from './runner-helpers.js';

let ws: ReturnType<typeof tmpWorkspace>;
afterEach(() => ws?.cleanup());

const att = (n: number, kind: Attachment['kind'], name: string): Attachment => ({
  id: `att_${String(n).padStart(12, '0')}`,
  sha256: String(n).padStart(64, '0'),
  originalName: name,
  sizeBytes: 100,
  mime: kind === 'image' ? 'image/png' : 'application/pdf',
  kind,
  storedPath: `/proj/.harness-x/attachments/s/${String(n).padStart(12, '0')}/original`,
  representations: [],
  warnings: [],
  status: 'ready',
});

describe('1D.7 에이전트 파이프라인: 첨부는 세션 자산 → 첫 단계에 목록, 뒤 단계는 MCP, inputSchema.attachments', () => {
  it('3단계 리플레이', async () => {
    ws = tmpWorkspace();
    const seen: { node: string; opts: EngineRunOptions }[] = [];
    const engine = fakeEngine('claude-code', (opts) => {
      seen.push({ node: opts.env?.HARNESS_X_NODE ?? '', opts });
      return { text: '{"ok":true}' };
    });
    const list = [att(1, 'image', '화면.png'), att(2, 'pdf', '기획서.pdf')];
    const p = pipeline({
      name: 'three',
      nodes: [
        { id: 'plan', type: 'role', engine: 'claude-code' },
        { id: 'build', type: 'role', engine: 'claude-code' },
        {
          id: 'review',
          type: 'role',
          engine: 'claude-code',
          inputSchema: { type: 'object', properties: { attachments: ATTACHMENTS_FIELD_SCHEMA } },
        },
      ],
      edges: [
        { from: 'plan', to: 'build' },
        { from: 'build', to: 'review' },
      ],
    });
    const r = await new PipelineRunner({
      engines: { 'claude-code': engine },
      workspace: ws.dir,
      harnessMcp: { command: 'harness-mcp' },
      attachments: { list, dir: '/proj/.harness-x/attachments/s' },
    }).run(p, { request: '첨부대로 만들어 주세요' });
    expect(r.status).toBe('completed');
    const byNode = Object.fromEntries(seen.map((s) => [s.node, s.opts]));
    // 첫 단계: 엔진 입력에 첨부 목록 (엔진이 자기 방식으로 전달)
    expect(byNode.plan!.attachments?.map((a) => a.id)).toEqual(list.map((a) => a.id));
    // 뒤 단계: 엔진 입력에는 없고 MCP로 읽는다
    expect(byNode.build!.attachments).toBeUndefined();
    expect(byNode.review!.attachments).toBeUndefined();
    for (const o of Object.values(byNode)) {
      const harness = o.mcpServers?.find((m) => m.name === 'harness');
      expect(harness?.args?.join(' ')).toContain('--attachments /proj/.harness-x/attachments/s');
    }
    // inputSchema에 attachments를 선언한 노드는 입력 값으로도 받는다
    const reviewPrompt = r.visits.find((v) => v.nodeId === 'review')!.prompts[0]!;
    expect(reviewPrompt).toContain('"name": "화면.png"');
    expect(reviewPrompt).toContain('"path": "/proj/.harness-x/attachments/s/000000000001/original"');
    const buildPrompt = r.visits.find((v) => v.nodeId === 'build')!.prompts[0]!;
    expect(buildPrompt).not.toContain('화면.png');
  });

  it('첨부가 없으면 아무것도 바뀌지 않는다', async () => {
    ws = tmpWorkspace();
    const seen: EngineRunOptions[] = [];
    const engine = fakeEngine('claude-code', (opts) => (seen.push(opts), { text: 'ok' }));
    await new PipelineRunner({ engines: { 'claude-code': engine }, workspace: ws.dir }).run(
      pipeline({ name: 'one', nodes: [{ id: 'a', type: 'role' }], edges: [] }),
      'x',
    );
    expect(seen[0]!.attachments).toBeUndefined();
  });
});
