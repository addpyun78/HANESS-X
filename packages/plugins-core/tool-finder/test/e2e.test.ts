import { nextInstruction } from '@harness-x/checklist-ledger';
import {
  INSTALL_TOOLS,
  InstallService,
  mockRunner,
  renderInstalledToolsSkill,
  type DetectionTable,
  type InstallPlan,
} from '@harness-x/installer';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AutoResume,
  planSelected,
  TOOL_RESUMED,
  ToolFinder,
  ToolNeedHub,
  wingetProvider,
  type FindResult,
} from '../src/index.js';
import { fakeFetch, ledgerWith, NOW, tempHome, toolEntry, WINGET_SEARCH, wingetShow } from './helpers.js';

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

const FFMPEG_SHOW = wingetShow(
  'Gyan.FFmpeg',
  'FFmpeg',
  'GPL-3.0',
  'https://ffmpeg.org',
  'Audio and video converter',
);
const HANDBRAKE_SHOW = wingetShow(
  'HandBrake.HandBrake',
  'HandBrake',
  'GPL-2.0',
  'https://handbrake.fr',
  'Video transcoder',
);
const FFMPEG_EXE = 'C:\\Users\\u\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe';

function detection(): DetectionTable {
  return Object.fromEntries(
    INSTALL_TOOLS.map((n) => [
      n,
      n === 'winget'
        ? { name: n, available: true, host: 'windows', path: 'C:\\bin\\winget.exe' }
        : { name: n, available: false },
    ]),
  ) as DetectionTable;
}

/** 모킹 세계: winget(검색·조회·설치·확인), 사용자 AI 웹 검색, Adobe 가격 페이지. 실제 네트워크·설치 0건 */
function world() {
  const t = tempHome('hx-tf-e2e-');
  cleanups.push(t.cleanup);
  const runner = mockRunner({
    'winget search': { stdout: WINGET_SEARCH },
    'winget show --id Gyan.FFmpeg': { stdout: FFMPEG_SHOW },
    'winget show --id HandBrake.HandBrake': { stdout: HANDBRAKE_SHOW },
    'winget install --id Gyan.FFmpeg': { stdout: 'Successfully installed' },
    'winget list --id Gyan.FFmpeg': { stdout: 'FFmpeg Gyan.FFmpeg 7.1' },
    'powershell.exe -NoProfile -Command': { stdout: FFMPEG_EXE },
  });
  const svc = new InstallService({ home: t.dir, runner, platform: 'wsl', detection: detection() });
  const fetch = fakeFetch({ 'https://www.adobe.com/pricing': '<h2>Media Encoder</h2><p>US$22.99/mo</p>' });
  const webQueries: string[] = [];
  const finder = new ToolFinder({
    home: t.dir,
    registry: svc.registry,
    packageProviders: [wingetProvider],
    userAiSearch: async (q) => {
      webQueries.push(q);
      return [
        { title: 'Adobe Media Encoder | Adobe', url: 'https://www.adobe.com/products/media-encoder.html' },
      ];
    },
    runner,
    fetch,
    os: 'wsl',
    now: () => NOW,
  });
  const ledger = ledgerWith(t.dir, [
    ['4.1', '작업 폴더 만들기'],
    ['4.2', '동영상에서 소리 뽑기'],
    ['4.3', '설명서 쓰기'],
  ]);
  const auto = new AutoResume({ registry: svc.registry, ledgers: () => [ledger] });
  cleanups.push(auto.start());
  const cards: FindResult[] = [];
  const hub = new ToolNeedHub(finder, (r) => cards.push(r), ledger);
  return { t, runner, svc, fetch, finder, ledger, auto, hub, cards, webQueries };
}

async function approveAndInstall(svc: InstallService, plan: unknown) {
  const p = plan as InstallPlan;
  // 사람이 계획 카드에서 [설치] (클릭 토큰 id만 기록)
  return svc.execute(p.id, { gestureId: 'g-human-click' }).done;
}

describe('P3-D.1 설치 성공 → 도구 목록 등록 → 기다리던 항목 자동 재개 → AI가 다음 턴에 바로 사용 (E2E 모킹)', () => {
  it('blocked → doing, 도구 목록에 필요 태그, 다음 턴 지시·installed-tools 스킬에 ffmpeg 절대 경로', async () => {
    const w = world();
    w.ledger.transition('4.2', 'doing');
    const r = await w.hub.fromEngine({ capability: '동영상에서 소리 뽑기', itemId: '4.2' });
    expect(r.status).toBe('waiting-user');
    expect(w.ledger.item('4.2').status).toBe('blocked');
    const card = w.cards[0]!;
    if (card.status !== 'candidates') throw new Error('x');
    const ffmpeg = card.candidates.find((c) => c.name === 'FFmpeg')!;
    const [sel] = await planSelected(w.svc, card.need, [ffmpeg], w.auto);
    const job = await approveAndInstall(w.svc, sel!.plan);
    expect(job.status).toBe('installed');
    // 도구 목록 등록 + 필요 태그
    const entry = w.svc.registry.get('winget:Gyan.FFmpeg')!;
    expect(entry.command).toBe(FFMPEG_EXE);
    expect(entry.capabilities).toContain('동영상에서 소리 뽑기');
    // 자동 재개
    const it2 = w.ledger.item('4.2');
    expect(it2.status).toBe('doing');
    expect(it2.evidence.at(-1)).toMatchObject({ kind: TOOL_RESUMED, toolId: 'winget:Gyan.FFmpeg' });
    // AI 다음 턴: 지시문 + 설치된 도구 스킬
    expect(nextInstruction(it2, 3)).toContain(FFMPEG_EXE);
    expect(renderInstalledToolsSkill(w.svc.registry.list())).toContain(FFMPEG_EXE);
    // 같은 필요를 다시 요청하면 검색 없이 이미 있는 도구
    const before = w.runner.calls.length;
    const again = await w.finder.find({ capability: '동영상에서 소리 뽑기' });
    expect(again.status).toBe('have');
    expect(w.runner.calls.length).toBe(before);
  });

  it('다른 도구가 설치되면 재개하지 않는다', async () => {
    const w = world();
    w.ledger.transition('4.2', 'doing');
    await w.hub.fromEngine({ capability: '동영상에서 소리 뽑기', itemId: '4.2' });
    w.svc.registry.upsert(toolEntry({ name: 'Other', id: 'winget:Other.Tool' }));
    expect(w.ledger.item('4.2').status).toBe('blocked');
  });
});

describe('P3-D.4 E2E: "동영상에서 소리 뽑기" → 도구 없음 → 후보 3개(무료 2, 유료 1) → ffmpeg 선택 → 계획 카드 승인 → 설치 → 재개·완료', () => {
  it('전체 흐름 (모킹)', async () => {
    const w = world();
    // 엔진이 항목 4.2 시작 → 도구가 없다 → tools.request
    w.ledger.transition('4.2', 'doing');
    expect(w.svc.registry.list()).toHaveLength(0);
    await w.hub.fromEngine({ capability: '동영상에서 소리 뽑기', itemId: '4.2' });
    const card = w.cards[0]!;
    if (card.status !== 'candidates') throw new Error('후보 없음');
    // 후보 3개: 무료 2 (저장소 오픈소스), 유료 1 (가격 페이지 확인)
    expect(card.candidates.map((c) => [c.name, c.pricing.tier])).toEqual([
      ['FFmpeg', 'free'],
      ['HandBrake', 'free'],
      ['Adobe Media Encoder', 'paid'],
    ]);
    expect(card.candidates.filter((c) => c.recommended).map((c) => c.name)).toEqual(['FFmpeg']);
    expect(card.candidates.find((c) => c.name === 'Adobe Media Encoder')!.pricing.sourceUrl).toBe(
      'https://www.adobe.com/pricing',
    );
    for (const c of card.candidates) {
      expect(c.pricing.sourceUrl).toMatch(/^https:\/\//);
      expect(c.checkedLabel).toBe('11/11 확인');
      expect(c.reason.length).toBeGreaterThan(0);
    }
    expect(card.searched).toEqual(['winget', 'user-ai-web']);
    expect(w.webQueries).toEqual(['동영상에서 소리 뽑기']);
    // 기다리는 동안 항목은 blocked, 독립 항목은 진행 가능
    expect(w.ledger.item('4.2').status).toBe('blocked');
    expect(w.ledger.currentItem()?.id).toBe('4.1');
    // 사람이 ffmpeg 선택 → 계획 카드 1장 → 승인
    const ffmpeg = card.candidates.find((c) => c.name === 'FFmpeg')!;
    w.finder.recordChoice(card.need.capability, [ffmpeg]);
    const plans = await planSelected(w.svc, card.need, [ffmpeg], w.auto);
    expect(plans).toHaveLength(1);
    const plan = plans[0]!.plan as InstallPlan;
    expect(plan).toMatchObject({ kind: 'winget', target: 'Gyan.FFmpeg' });
    // 승인 전에는 설치 명령 0건
    expect(w.runner.calls.filter((c) => c.line.startsWith('winget install'))).toHaveLength(0);
    const job = await approveAndInstall(w.svc, plan);
    expect(job.status).toBe('installed');
    expect(w.runner.calls.filter((c) => c.line.startsWith('winget install'))).toHaveLength(1);
    // 항목 자동 재개 → 엔진이 제출 → 완료
    expect(w.ledger.item('4.2').status).toBe('doing');
    w.ledger.transition('4.2', 'verifying', {
      evidence: { kind: 'command', summary: 'ffmpeg -i in.mp4 -vn out.mp3 → exit 0' },
    });
    w.ledger.transition('4.2', 'done');
    expect(w.ledger.item('4.2').status).toBe('done');
    // 네트워크는 모킹 fetch 하나뿐, 가격 페이지 1회만
    expect(w.fetch.calls).toEqual(['https://www.adobe.com/pricing']);
  });
});
