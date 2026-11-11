import { afterEach, describe, expect, it } from 'vitest';
import type { AgentDraft } from '@harness-x/protocol';
// 디스패처는 커널 내부 모듈 (cli.ts가 쓴다)
import { Dispatcher } from '../../../kernel/src/dispatch.js';
import { closeDesignerServers, startDesignerServer } from './designer-server.js';
import { sampleDraft } from './designer-helpers.js';

afterEach(closeDesignerServers);

/**
 * P4-G.5 수정 E2E (서버 쪽, 실제 API 서버 + 실제 레지스트리, 설계 엔진만 리플레이)
 * 초안 → "검사는 claude로" → 미리보기(패치) → 적용(새 버전) → 캔버스 직접 수정(새 버전) → 저장(클릭 토큰) → / 목록 → 실행
 * 화면 쪽 같은 흐름은 apps/web/test/builder.draft.e2e.test.tsx
 */
describe('P4-G.5 수정 E2E', () => {
  it('초안 → 말로 고치기 → 적용 → 캔버스 수정 → 저장 → / 목록에서 실행', async () => {
    const t = await startDesignerServer({
      replies: [sampleDraft(), { patch: [{ op: 'replace', path: '/nodes/2/engine', value: 'claude-code' }] }],
    });
    // 1) 초안
    const d1 = await t.design();
    expect(d1.draft.nodes[2]!.engine).toBe('antigravity');
    // 2) 말로 고치기 → 미리보기 (아직 적용 안 됨)
    const preview = (
      await t.req('POST', '/api/builder/edit', { draft: d1.draft, instruction: '검사는 claude로' })
    ).body as { ok: boolean; draft: AgentDraft; changes: { message: string }[] };
    expect(preview.ok).toBe(true);
    expect(preview.changes[0]!.message).toContain('"claude-code"로 바뀌어요');
    expect(
      ((await t.req('GET', `/api/builder/drafts/${d1.draftId}`)).body.versions as unknown[]).length,
    ).toBe(1);
    // 3) [적용] → v2
    await t.req('PUT', `/api/builder/drafts/${d1.draftId}`, {
      draft: preview.draft,
      version: true,
      source: 'ai-patch',
      note: preview.changes[0]!.message,
    });
    // 4) 캔버스 직접 수정: 스킬 하나 더 + 빈 칸 빼기 → v3
    const edited: AgentDraft = {
      ...preview.draft,
      gaps: [],
      nodes: preview.draft.nodes.map((n) =>
        n.id === 'build' ? { ...n, skills: [...n.skills, 'ui-audit'] } : n,
      ),
    };
    const rec = (
      await t.req('PUT', `/api/builder/drafts/${d1.draftId}`, {
        draft: edited,
        version: true,
        source: 'canvas',
      })
    ).body as { versions: { v: number; source: string }[] };
    expect(rec.versions.map((v) => v.source)).toEqual(['ai', 'ai-patch', 'canvas']);
    // 5) 저장 (사람 클릭 토큰)
    const saved = await t.req(
      'POST',
      '/api/agents/save',
      { draftId: d1.draftId, draft: edited },
      { 'x-harness-gesture': await t.token() },
    );
    expect(saved).toMatchObject({ status: 201, body: { command: '/design-review', status: 'ready' } });
    // 6) / 목록에 등장
    expect(await t.list()).toContain('design-review');
    const reg = t.registry.get('/design-review')!;
    expect(reg.pipeline.nodes.map((n) => [n.id, 'engine' in n ? n.engine : undefined])).toEqual([
      ['plan', 'claude-code'],
      ['build', 'codex'],
      ['critic', 'claude-code'],
    ]);
    // 7) / 목록에서 실행 (디스패처 → 실행기)
    const ran: string[][] = [];
    const disp = new Dispatcher({
      resolve: (name) => {
        const a = t.registry.get(name);
        return a
          ? {
              name: a.name,
              command: a.command,
              displayName: a.agent.displayName,
              ...(a.agent.status ? { status: a.agent.status } : {}),
              pipeline: a.pipeline,
            }
          : undefined;
      },
      run: async (i) => {
        ran.push(i.pipeline.nodes.map((n) => n.id));
        return { status: 'completed' };
      },
    });
    const s = disp.dispatch({ agent: '/design-review', prompt: '로그인 화면 검수해 줘' });
    expect(s.status).toBe('running');
    await new Promise((r) => setTimeout(r, 50));
    expect(ran).toEqual([['plan', 'build', 'critic']]);
  });
});
