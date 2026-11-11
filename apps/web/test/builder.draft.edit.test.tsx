// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { emptyGraph, type BuilderGraph } from '../src/builder/graph.js';
import { inspectorReducer, type InspectorAction } from '../src/builder/inspector/model.js';
import { initHistory, withHistory } from '../src/builder/lego/history.js';
import { skillsOf } from '../src/builder/lego/model.js';
import { draftToGraph, graphToDraft, patchConflicts, touchedBy } from '../src/builder/draft/model.js';
import { CONFLICT_TEXT } from '../src/builder/draft/DraftCards.js';
import {
  criticToClaude,
  fakeDesignerApi,
  sampleDraft,
  sendChat,
  startChatAndSend,
} from './draft-fixtures.js';
import { blockTransfer, mockReactFlowDom } from './flow-mock.js';
import { diffDrafts } from '@harness-x/protocol';

beforeAll(mockReactFlowDom);
afterEach(cleanup);

const draftResponse = (d = sampleDraft()) => ({
  kind: 'draft' as const,
  draftId: '',
  version: 1,
  draft: d,
  notices: [],
  engineSuggestions: [],
});
const node = (id: string) => document.querySelector(`.hx-node[data-node-id="${id}"]`) as HTMLElement;
const chips = (id: string) =>
  [...node(id).querySelectorAll('.hx-skill-chip')].map((c) => c.getAttribute('data-skill'));
const engineOf = (id: string) => node(id).querySelector('.hx-engine-chip')!.getAttribute('data-engine');
const canvas = () => document.querySelector('.hx-canvas') as HTMLElement;
const run = (g: BuilderGraph, ...as: InspectorAction[]) => as.reduce(inspectorReducer, g);
const editApi = () => fakeDesignerApi({ design: [draftResponse()], edit: (d) => criticToClaude(d) });

describe('P4-E.1 캔버스 직접 수정: T-045 레고 조작을 초안 상태로 재실행', () => {
  const g0 = () => draftToGraph(sampleDraft());
  const sk = (g: BuilderGraph, id: string) => skillsOf(g.nodes.find((n) => n.id === id)!.spec);

  it('45.1/45.2 스킬 장착·분리·옮기기 → 초안에 반영 (reason 유지)', () => {
    const g = run(
      g0(),
      { type: 'attachSkill', nodeId: 'build', skill: 'compose-ui' },
      { type: 'attachSkill', nodeId: 'build', skill: 'compose-ui' },
      { type: 'detachSkill', nodeId: 'build', skill: 'ui-tokens' },
      { type: 'moveSkill', from: 'plan', to: 'critic', skill: 'plan-writer' },
    );
    expect(sk(g, 'build')).toEqual(['kotlin-compose', 'compose-ui']);
    expect(sk(g, 'critic')).toEqual(['ui-audit', 'plan-writer']);
    const d = graphToDraft(g, sampleDraft());
    expect(d.nodes.find((n) => n.id === 'build')!.reason).toBe(
      '말씀하신 대로 고치는 일은 codex에게 맡겼어요.',
    );
    expect(d.nodes.find((n) => n.id === 'plan')!.skills).toEqual([]);
  });

  it('45.3 엔진 교체 · 45.5 노드 추가·삭제·연결', () => {
    let g = run(g0(), { type: 'setEngine', nodeId: 'critic', engine: 'claude-code' });
    g = run(g, { type: 'addNode', nodeType: 'role', position: { x: 900, y: 0 } });
    g = run(g, { type: 'connect', from: 'critic', to: 'role' });
    let d = graphToDraft(g, sampleDraft());
    expect(d.nodes.map((n) => [n.id, n.engine])).toEqual([
      ['plan', 'claude-code'],
      ['build', 'codex'],
      ['critic', 'claude-code'],
      ['role', 'auto'],
    ]);
    expect(d.edges).toContainEqual({ from: 'critic', to: 'role' });
    g = run(g, { type: 'removeNodes', ids: ['critic'] });
    d = graphToDraft(g, sampleDraft());
    expect(d.nodes.map((n) => n.id)).toEqual(['plan', 'build', 'role']);
    expect(d.edges).toEqual([{ from: 'plan', to: 'build' }]);
    expect(d.gaps).toEqual([]); // 없어진 노드에 붙은 빈 칸도 빠진다
  });

  it('45.6 실행 취소/다시 실행', () => {
    const r = withHistory(inspectorReducer);
    let h = initHistory(g0());
    h = r(h, { type: 'attachSkill', nodeId: 'plan', skill: 'ui-audit' });
    h = r(h, { type: 'undo' });
    expect(sk(h.present, 'plan')).toEqual(['plan-writer']);
    h = r(h, { type: 'redo' });
    expect(sk(h.present, 'plan')).toEqual(['plan-writer', 'ui-audit']);
  });

  it('화면: 초안 노드에 스킬·엔진 블록을 놓으면 그대로 바뀐다 (Ctrl+Z 되돌리기)', async () => {
    await startChatAndSend(editApi());
    fireEvent.drop(node('plan'), { dataTransfer: blockTransfer('skill', 'ui-audit') });
    expect(chips('plan')).toEqual(['plan-writer', 'ui-audit']);
    fireEvent.drop(node('critic'), { dataTransfer: blockTransfer('engine', 'codex') });
    expect(engineOf('critic')).toBe('codex');
    fireEvent.drop(canvas(), { dataTransfer: blockTransfer('node', 'role'), clientX: 50, clientY: 50 });
    expect(canvas().getAttribute('data-node-count')).toBe('4');
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(canvas().getAttribute('data-node-count')).toBe('3');
    expect(node('plan').getAttribute('data-draft')).toBe('true');
  });
});

describe('P4-E.4 변경 강조: 노란색 + "바뀐 점" + [적용] [취소] (적용 전 미리보기)', () => {
  it('미리보기 → 취소: 캔버스는 원래대로, 버전 그대로', async () => {
    const api = editApi();
    await startChatAndSend(api);
    await sendChat('검사는 claude로 바꿔줘');
    const box = screen.getByRole('region', { name: '바뀐 점' });
    expect(
      within(box).getByText('"검사 담당"를 맡는 AI가 "antigravity"에서 "claude-code"로 바뀌어요.'),
    ).toBeTruthy();
    // 미리보기: 바뀐 노드·엔진 칩 노란색, 캔버스에 바뀐 모습
    expect(node('critic').getAttribute('data-changed')).toBe('true');
    expect(node('critic').querySelector('.hx-engine-chip')!.getAttribute('data-changed')).toBe('true');
    expect(node('build').hasAttribute('data-changed')).toBe(false);
    expect(engineOf('critic')).toBe('claude-code');
    fireEvent.click(within(box).getByText('취소'));
    expect(engineOf('critic')).toBe('antigravity');
    expect(node('critic').hasAttribute('data-changed')).toBe(false);
    expect(api.store.get('draft-1')!.versions).toHaveLength(1);
  });

  it('미리보기 → 적용: 캔버스 반영 + 새 버전 v2', async () => {
    const api = editApi();
    await startChatAndSend(api);
    await sendChat('검사는 claude로 바꿔줘');
    fireEvent.click(within(screen.getByRole('region', { name: '바뀐 점' })).getByText('적용'));
    expect(engineOf('critic')).toBe('claude-code');
    expect(screen.queryByRole('region', { name: '바뀐 점' })).toBeNull();
    await vi.waitFor(() =>
      expect(api.store.get('draft-1')!.versions.map((v) => v.source)).toEqual(['ai', 'ai-patch']),
    );
    await vi.waitFor(() => expect(screen.getByText('초안 v2 · 아직 저장 안 됨')).toBeTruthy());
  });

  it('거부된 패치는 쉬운 말 사유만 보이고 미리보기 없음', async () => {
    const api = fakeDesignerApi({
      design: [draftResponse()],
      edit: () => ({
        ok: false,
        message: '이 변경은 적용하지 않았어요.',
        reasons: ['목록에 없는 것을 쓰려고 해요: "gpt-9"'],
      }),
    });
    await startChatAndSend(api);
    await sendChat('검사는 gpt-9로');
    expect(screen.queryByRole('region', { name: '바뀐 점' })).toBeNull();
    expect(screen.getByText(/목록에 없는 것을 쓰려고 해요/)).toBeTruthy();
  });
});

describe('P4-E.5 사람 수정 보호: 직접 고친 칸을 AI 패치가 바꾸면 확인', () => {
  it('충돌 계산: 사람이 critic 엔진을 고쳤으면 그 변경이 충돌', () => {
    const touched = new Set(touchedBy({ type: 'setEngine', nodeId: 'critic', engine: 'codex' }));
    const before = sampleDraft();
    const ch = criticToClaude(before);
    if (!ch.ok) throw new Error();
    expect(patchConflicts(ch.changes, touched)).toHaveLength(1);
    expect(
      patchConflicts(ch.changes, new Set(touchedBy({ type: 'attachSkill', nodeId: 'critic', skill: 'x' }))),
    ).toEqual([]);
    expect(
      touchedBy({ type: 'patchNode', nodeId: 'plan', patch: { label: 'x', permission: 'full' } }),
    ).toEqual(['plan/role', 'plan/permission']);
  });

  it('화면: 엔진을 직접 바꾼 뒤 AI가 같은 칸을 바꾸려 하면 "직접 고치신 부분을 바꾸려고 해요. 바꿀까요?"', async () => {
    const api = editApi();
    await startChatAndSend(api);
    fireEvent.drop(node('critic'), { dataTransfer: blockTransfer('engine', 'codex') });
    await sendChat('검사는 claude로 바꿔줘');
    const box = screen.getByRole('region', { name: '바뀐 점' });
    expect(within(box).getByRole('alert').textContent).toBe(CONFLICT_TEXT);
    fireEvent.click(within(box).getByText('네, 바꿀게요'));
    expect(engineOf('critic')).toBe('claude-code');
  });

  it('직접 고치지 않은 칸이면 확인 없이 [적용]', async () => {
    await startChatAndSend(editApi());
    fireEvent.drop(node('plan'), { dataTransfer: blockTransfer('skill', 'ui-audit') });
    await sendChat('검사는 claude로 바꿔줘');
    expect(within(screen.getByRole('region', { name: '바뀐 점' })).queryByRole('alert')).toBeNull();
  });
});

describe('P4-E.6 초안 버전: v1, v2… 보기·되돌리기', () => {
  it('v3 → v1 되돌리기', async () => {
    let n = 0;
    const api = fakeDesignerApi({
      design: [draftResponse()],
      edit: (d) => {
        const next = structuredClone(d);
        next.nodes.find((x) => x.id === 'critic')!.engine = ++n === 1 ? 'claude-code' : 'codex';
        return { ok: true, draft: next, changes: diffDrafts(d, next), patch: [] };
      },
    });
    await startChatAndSend(api);
    for (const text of ['검사는 claude로', '검사는 codex로']) {
      await sendChat(text);
      fireEvent.click(within(screen.getByRole('region', { name: '바뀐 점' })).getByText('적용'));
      await vi.waitFor(() =>
        expect(screen.queryByText(/아직 저장 안 됨/)!.textContent).not.toContain('v1 ·'),
      );
    }
    await vi.waitFor(() => expect(screen.getByText('초안 v3 · 아직 저장 안 됨')).toBeTruthy());
    expect(engineOf('critic')).toBe('codex');
    fireEvent.click(screen.getByText('버전 기록 (3)'));
    const list = screen.getByRole('list', { name: '버전 목록' });
    fireEvent.click(within(list).getByText('v1 보기'));
    expect(screen.getByLabelText('v1 내용').textContent).toContain('계획 담당 → 고치기 담당 → 검사 담당');
    fireEvent.click(within(list).getByText('v1로 되돌리기'));
    await vi.waitFor(() => expect(engineOf('critic')).toBe('antigravity'));
    await vi.waitFor(() => expect(screen.getByText('초안 v4 · 아직 저장 안 됨')).toBeTruthy());
    expect(api.store.get('draft-1')!.versions.map((v) => v.source)).toEqual([
      'ai',
      'ai-patch',
      'ai-patch',
      'revert',
    ]);
  });
});

describe('P4-E.7 실행 취소/다시 실행에 AI 패치도 한 단계', () => {
  it('패치 1건 = 되돌리기 1단계 (replace는 기록, load는 기록을 비움)', () => {
    const r = withHistory(inspectorReducer);
    let h = initHistory(emptyGraph());
    h = r(h, { type: 'load', graph: draftToGraph(sampleDraft()) });
    expect(h.past).toHaveLength(0);
    const ch = criticToClaude(sampleDraft());
    if (!ch.ok) throw new Error();
    h = r(h, { type: 'replace', graph: draftToGraph(ch.draft, h.present) });
    expect(h.past).toHaveLength(1);
    h = r(h, { type: 'undo' });
    expect(graphToDraft(h.present, sampleDraft()).nodes[2]!.engine).toBe('antigravity');
  });

  it('화면: 적용 → Ctrl+Z 한 번에 패치 전으로, Ctrl+Y로 다시', async () => {
    await startChatAndSend(editApi());
    fireEvent.drop(node('plan'), { dataTransfer: blockTransfer('skill', 'ui-audit') });
    await sendChat('검사는 claude로 바꿔줘');
    fireEvent.click(within(screen.getByRole('region', { name: '바뀐 점' })).getByText('적용'));
    expect(engineOf('critic')).toBe('claude-code');
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(engineOf('critic')).toBe('antigravity');
    expect(chips('plan')).toEqual(['plan-writer', 'ui-audit']); // 앞 단계는 그대로
    fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
    expect(engineOf('critic')).toBe('claude-code');
  });
});

describe('P4-E.8 YAML 보기에서 고친 내용도 초안 버전으로', () => {
  it('YAML 수정 → 그래프에 적용 → 새 버전(source yaml)', async () => {
    const api = editApi();
    await startChatAndSend(api);
    fireEvent.click(screen.getByRole('tab', { name: 'YAML 보기' }));
    const ta = screen.getByLabelText('pipeline.yaml') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: ta.value.replace('engine: antigravity', 'engine: codex') } });
    await act(async () => {
      fireEvent.click(screen.getByText('그래프에 적용'));
    });
    expect(engineOf('critic')).toBe('codex');
    await vi.waitFor(() =>
      expect(api.store.get('draft-1')!.versions.map((v) => v.source)).toEqual(['ai', 'yaml']),
    );
    expect(api.store.get('draft-1')!.versions[1]!.draft.nodes[2]!.engine).toBe('codex');
    await vi.waitFor(() => expect(screen.getByText('초안 v2 · 아직 저장 안 됨')).toBeTruthy());
  });
});
