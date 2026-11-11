// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
// 쉬운 말 검사기(H.6) — 패키지 index는 node 전용 모듈을 함께 싣으므로 검사기 파일만 가져온다
import { checkPlainKorean } from '../../../packages/plugins-core/approvals/src/plain-korean.js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SummaryCard } from '../src/builder/draft/DraftCards.js';
import { draftChecklist } from '../src/builder/draft/model.js';
import { FORGE_PREFILL_KEY, takeForgePrefill } from '../src/builder/draft/forge-handoff.js';
import { DRAFT_CATALOG, fakeDesignerApi, sampleDraft, startChatAndSend } from './draft-fixtures.js';
import { mockReactFlowDom } from './flow-mock.js';
import { renderApp } from './app-fixtures.js';
import { pickerData } from './toolpicker-fixtures.js';

beforeAll(mockReactFlowDom);
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const draftResponse = (d = sampleDraft()) => ({
  kind: 'draft' as const,
  draftId: '',
  version: 1,
  draft: d,
  notices: [],
  engineSuggestions: [],
});

const nodeEl = (id: string) => document.querySelector(`.hx-node[data-node-id="${id}"]`) as HTMLElement;
const allText = (el: Element) =>
  [...el.querySelectorAll('h3, h4, li, p, span, button, legend')]
    .filter((x) => x.children.length === 0 || x.tagName === 'LI')
    .map((x) => x.textContent!.trim())
    .filter(Boolean);

describe('P4-C.10 빈 칸: 쉬운 말 + 빨간 점선 노드 + [도구 찾기] [Forge로 만들기] [이 칸 빼기]', () => {
  it('gaps 렌더 스냅샷 · [도구 찾기]는 주입된 onFindTool(gap)을 부른다', async () => {
    const api = fakeDesignerApi({ design: [draftResponse()] });
    const onFindTool = vi.fn();
    await startChatAndSend(api, undefined, { onFindTool });
    const layer = screen.getByRole('list', { name: '빈 칸' });
    expect(layer.closest('.hx-canvas')).toBeTruthy();
    const gap = layer.querySelector('.hx-gap-node')!;
    expect(gap.outerHTML).toMatchInlineSnapshot(
      `"<li class="hx-gap-node" data-gap-id="gap-1" data-node-id="critic"><span class="hx-gap-node__title">빈 칸: 화면 스크린샷 두 장을 비교하는 기능</span><span class="hx-gap-node__actions"><button type="button" class="hx-insp-btn">도구 찾기</button><button type="button" class="hx-insp-btn hx-insp-btn--ghost">Forge로 만들기</button><button type="button" class="hx-insp-btn hx-insp-btn--ghost">이 칸 빼기</button></span></li>"`,
    );
    fireEvent.click(within(layer).getByText('도구 찾기'));
    expect(onFindTool).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'gap-1', need: '화면 스크린샷 두 장을 비교하는 기능' }),
    );
  });

  it('BuilderPage 기본 연결: [도구 찾기] → Part 3 openToolPickerForGap → 도구 고르기 카드가 캔버스에 뜬다', async () => {
    const d = pickerData();
    const find = vi.fn(async () => ({
      status: 'candidates' as const,
      need: d.need,
      candidates: d.candidates,
      notices: [],
    }));
    const api = fakeDesignerApi({ design: [draftResponse()] });
    await startChatAndSend(api, undefined, { toolPicker: { find } });
    fireEvent.click(screen.getByText('도구 찾기'));
    expect(find).toHaveBeenCalledWith({
      capability: '화면 스크린샷 두 장을 비교하는 기능',
      nodeId: 'critic',
    });
    const picker = await screen.findByLabelText('도구 고르기');
    expect(picker.closest('.hx-canvas')).toBeTruthy();
    expect(within(picker).getByText(d.candidates[0]!.name)).toBeTruthy();
  });

  it('[이 칸 빼기] → 빈 칸이 사라지고 새 버전으로 남는다 (자동으로 새로 만들지 않음)', async () => {
    const api = fakeDesignerApi({ design: [draftResponse()] });
    await startChatAndSend(api);
    fireEvent.click(screen.getByText('이 칸 빼기'));
    await vi.waitFor(() => expect(screen.queryByRole('list', { name: '빈 칸' })).toBeNull());
    await vi.waitFor(() => expect(api.store.get('draft-1')!.versions.at(-1)!.draft.gaps).toEqual([]));
  });
});

describe('P4-C.11 [Forge로 만들기] → Forge 화면 입력창에 빈 칸 설명이 채워짐 (자동 실행 금지)', () => {
  it('빌더에서 누르면 /forge 설명을 채워 두고 메인 화면으로 이동', async () => {
    location.hash = '#/builder/new';
    const api = fakeDesignerApi({ design: [draftResponse()] });
    await startChatAndSend(api);
    fireEvent.click(screen.getByText('Forge로 만들기'));
    expect(location.hash).toBe('#/');
    expect(sessionStorage.getItem(FORGE_PREFILL_KEY)).toBe('/forge 화면 스크린샷 두 장을 비교하는 기능');
    cleanup();

    const app = renderApp();
    const input = (await screen.findByLabelText('지시 입력')) as HTMLTextAreaElement;
    await vi.waitFor(() => expect(input.value).toBe('/forge 화면 스크린샷 두 장을 비교하는 기능'));
    // 보내지 않았다: 세션을 만드는 요청 0건
    expect(app.calls.filter((c) => c.method === 'POST')).toEqual([]);
    expect(takeForgePrefill()).toBeUndefined(); // 한 번만 채운다
  });
});

describe('P4-D.1 초안 상태: 상단 띠 "초안 v1 · 아직 저장 안 됨" + 노드 테두리 점선', () => {
  it('스냅샷', async () => {
    const api = fakeDesignerApi({ design: [draftResponse()] });
    await startChatAndSend(api);
    expect(
      screen.getByRole('status', { name: '초안 상태' }).querySelector('.hx-draft-banner__text')!.textContent,
    ).toBe('초안 v1 · 아직 저장 안 됨');
    expect(['plan', 'build', 'critic'].map((id) => nodeEl(id).getAttribute('data-draft'))).toEqual([
      'true',
      'true',
      'true',
    ]);
  });
});

describe('P4-D.2 조립 애니메이션: 0.2초 간격으로 나타남, 끄기 가능', () => {
  it('켜면 노드가 순서대로 나타난다', async () => {
    const api = fakeDesignerApi({ design: [draftResponse()] });
    await startChatAndSend(api, undefined, { animate: true });
    const hidden = () => ['plan', 'build', 'critic'].filter((id) => nodeEl(id).hasAttribute('data-hidden'));
    // 처음에는 모두 숨김 → 0.2초마다 하나씩 (앞에서부터)
    expect(hidden().length).toBeGreaterThanOrEqual(2);
    expect(hidden().at(-1)).toBe('critic');
    await act(() => new Promise((r) => setTimeout(r, 250)));
    expect(hidden().length).toBeLessThanOrEqual(2);
    expect(hidden()).not.toContain('plan');
    await vi.waitFor(() => expect(hidden()).toEqual([]), { timeout: 2000 });
  });

  it('끄기 옵션(animate=false · 설정 hx.builder.animation=off)이면 바로 다 보인다', async () => {
    const api = fakeDesignerApi({ design: [draftResponse()] });
    await startChatAndSend(api, undefined, { animate: false });
    expect(document.querySelectorAll('.hx-node[data-hidden]')).toHaveLength(0);
    cleanup();
    localStorage.setItem('hx.builder.animation', 'off');
    const { animationEnabled } = await import('../src/builder/draft/useDraftSession.js');
    expect(animationEnabled()).toBe(false);
    localStorage.removeItem('hx.builder.animation');
    expect(animationEnabled()).toBe(true);
  });
});

describe('P4-D.3 요약 카드: summary + 쓰는 AI + 필요한 권한(쉬운 말)', () => {
  it('H.6 쉬운 말 검사 통과 스냅샷', () => {
    render(<SummaryCard draft={sampleDraft()} />);
    const card = screen.getByRole('region', { name: '초안 요약' });
    const texts = allText(card);
    expect(texts).toMatchInlineSnapshot(`
      [
        "이 에이전트는 이런 일을 해요",
        "임장노트 화면 디자인을 살펴보고 고쳐요.",
        "먼저 계획을 세우고 codex가 화면을 고쳐요.",
        "마지막으로 다른 AI가 결과를 한 번 더 검사해요.",
        "일을 맡을 AI 목록",
        "claude-code",
        "codex",
        "antigravity",
        "필요한 권한",
        "프로젝트 폴더 안의 파일을 고칠 수 있어요",
        "프로젝트 폴더 안의 파일을 읽기만 해요",
        "구독 범위 안에서 한 번에 10분 정도 걸려요.",
      ]
    `);
    const engineIds = new Set(['claude-code', 'codex', 'antigravity']);
    for (const t of texts.filter((x) => !engineIds.has(x)))
      expect(checkPlainKorean(t, { label: !/[요다]\.?$/.test(t) }).ok, t).toBe(true);
  });

  it('대화 패널에 카드가 붙는다', async () => {
    const api = fakeDesignerApi({ design: [draftResponse()] });
    await startChatAndSend(api);
    expect(
      within(screen.getByRole('list', { name: '대화' })).getByRole('region', { name: '초안 요약' }),
    ).toBeTruthy();
  });
});

describe('P4-D.4 인스펙터 "AI가 이렇게 정한 이유"', () => {
  it('노드를 선택하면 그 노드의 reason이 보인다', async () => {
    const api = fakeDesignerApi({ design: [draftResponse()] });
    await startChatAndSend(api);
    expect(screen.queryByRole('region', { name: 'AI가 이렇게 정한 이유' })).toBeNull();
    fireEvent.click(nodeEl('build'));
    const box = await screen.findByRole('region', { name: 'AI가 이렇게 정한 이유' });
    expect(box.textContent).toContain('말씀하신 대로 고치는 일은 codex에게 맡겼어요.');
  });
});

describe('P4-D.6 저장 전 점검표: 스키마 / 자산 / 엔진 로그인 / 권한 / 빈 칸', () => {
  it('스냅샷 (각 줄 쉬운 말)', async () => {
    const api = fakeDesignerApi({ design: [draftResponse()] });
    await startChatAndSend(api);
    const panel = screen.getByRole('region', { name: '저장 전 점검표' });
    const rows = [...panel.querySelectorAll('li')].map((li) => `${li.dataset.ok}|${li.textContent!.trim()}`);
    expect(rows).toMatchInlineSnapshot(`
      [
        "true|✓ 초안 모양이 알맞아요.",
        "true|✓ 쓰는 스킬과 도구가 모두 있어요.",
        "true|✓ 쓰는 AI가 모두 로그인돼 있어요.",
        "true|✓ 필요한 만큼만 고칠 수 있게 돼 있어요.",
        "false|! 빈 칸이 1개 있어요. 채워야 실행할 수 있어요.",
      ]
    `);
  });

  it('문제가 있으면 줄마다 쉬운 말로 알려 준다', () => {
    const d = sampleDraft();
    d.nodes[0]!.skills.push('ghost-skill');
    d.nodes[0]!.engine = 'gemini';
    d.nodes[0]!.permission = 'full';
    const rows = draftChecklist(d, {
      engineHealth: { gemini: 'needs-login' },
      knownSkills: new Set(DRAFT_CATALOG.skills.map((s) => s.id)),
      knownTools: new Set(),
      schemaOk: false,
    });
    expect(rows.map((r) => r.ok)).toEqual([false, false, false, false, false]);
    for (const r of rows) expect(checkPlainKorean(r.text).ok, r.text).toBe(true);
  });
});

describe('P4-D.5 초안 상태에서도 시험 실행 (T-046.4 재사용, 결과는 초안에 저장 안 됨)', () => {
  it('시험 실행 후 저장 API·클릭 토큰 0회, 초안 버전·작업 상태 그대로 → 레지스트리 미등록', async () => {
    const api = fakeDesignerApi({ design: [draftResponse()] });
    await startChatAndSend(api, undefined, { dryRunStepMs: 0 });
    const before = JSON.stringify(api.store.get('draft-1'));
    fireEvent.click(screen.getByRole('tab', { name: '시험 실행' }));
    fireEvent.click(screen.getByText('시험 실행', { selector: 'button.hx-insp-btn' }));
    await vi.waitFor(() =>
      expect(
        ['plan', 'build', 'critic'].map((id) =>
          nodeEl(id).querySelector('.hx-run-badge')?.getAttribute('data-status'),
        ),
      ).toEqual(['completed', 'completed', 'completed']),
    );
    expect(api.saveAgent).not.toHaveBeenCalled();
    expect(api.gestureToken).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 20));
    expect(JSON.stringify(api.store.get('draft-1'))).toBe(before);
    expect(screen.getByText('초안 v1 · 아직 저장 안 됨')).toBeTruthy();
  });
});
