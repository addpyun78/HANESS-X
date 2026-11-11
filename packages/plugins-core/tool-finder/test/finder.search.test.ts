import { afterEach, describe, expect, it } from 'vitest';
import {
  FEW_NOTICE,
  filterByOs,
  MAX_CANDIDATES,
  mergeCandidates,
  NO_FREE_NOTICE,
  SEARCH_CACHE_TTL_MS,
  selectCandidates,
  ToolFinder,
  checkedLabel,
} from '../src/index.js';
import { cand, hit, NOW, staticProvider, tempHome } from './helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});
function home() {
  const t = tempHome();
  cleanups.push(t.cleanup);
  return t.dir;
}

const winget = (name: string, license = 'MIT') =>
  hit({
    name,
    license,
    providerId: 'winget',
    installMethod: { kind: 'winget', id: `X.${name}`, label: 'Windows 공식 앱 저장소' },
    os: ['windows'],
  });

describe('P3-B.2 기본 순서: ① 패키지 저장소 → ② 웹 검색으로 보충', () => {
  it('저장소 결과가 충분하면 웹은 부르지 않는다', async () => {
    const log: string[] = [];
    const pkg = staticProvider('pkg', 'package', [winget('a'), winget('b'), winget('c')], log);
    const web = staticProvider('web', 'web', [hit({ name: 'w', packageRepo: false })], log);
    const r = await new ToolFinder({
      home: home(),
      packageProviders: [pkg],
      webProviders: [web],
      os: 'windows',
      now: () => NOW,
    }).find({ capability: '소리 뽑기' });
    expect(log).toEqual(['pkg']);
    expect(r.status === 'candidates' && r.searched).toEqual(['pkg']);
  });

  it('부족하면 저장소들 다음에 웹 공급자 순서대로 보충, 저장소 후보가 먼저', async () => {
    const log: string[] = [];
    const pkg1 = staticProvider('winget', 'package', [winget('ffmpeg')], log);
    const pkg2 = staticProvider('npm', 'package', [], log);
    const web1 = staticProvider(
      'user-ai-web',
      'web',
      [hit({ name: 'Adobe Media Encoder', packageRepo: false })],
      log,
    );
    const web2 = staticProvider('searxng', 'web', [], log);
    const r = await new ToolFinder({
      home: home(),
      packageProviders: [pkg1, pkg2],
      webProviders: [web1, web2],
      os: 'windows',
      now: () => NOW,
    }).find({ capability: '소리 뽑기' });
    if (r.status !== 'candidates') throw new Error('x');
    expect(r.searched).toEqual(['winget', 'npm', 'user-ai-web', 'searxng']);
    expect(log.indexOf('user-ai-web')).toBeGreaterThan(log.indexOf('npm'));
    expect(r.candidates.map((c) => c.name)).toEqual(['ffmpeg', 'Adobe Media Encoder']);
  });

  it('free-only 예산이면 웹 보충 안 함(웹 결과는 무료 확인이 안 되므로)', async () => {
    const log: string[] = [];
    await new ToolFinder({
      home: home(),
      packageProviders: [staticProvider('pkg', 'package', [winget('a')], log)],
      webProviders: [staticProvider('web', 'web', [], log)],
      os: 'windows',
      now: () => NOW,
    }).find({ capability: '소리 뽑기', constraints: { budget: 'free-only' } });
    expect(log).toEqual(['pkg']);
  });
});

describe('P3-B.6 중복 병합 · 후보 2~5개 · free-first 무료 최소 1개 시도', () => {
  it('같은 도구(저장소 여러 곳)는 하나로: 설치 방법·출처 합침, 가격 충돌은 unknown', () => {
    const a = cand({
      name: 'FFmpeg',
      license: 'GPL-3.0',
      providerId: 'winget',
      installMethod: { kind: 'winget', id: 'Gyan.FFmpeg', label: 'w' },
      os: ['windows'],
    });
    const b = cand({
      name: 'ffmpeg',
      license: 'GPL-3.0',
      providerId: 'npm',
      installMethod: { kind: 'npm-cli', id: 'ffmpeg', label: 'n' },
      os: ['linux'],
    });
    const c = cand({ name: 'Tool X', license: 'MIT' });
    const d = cand({
      name: 'tool-x',
      packageRepo: false,
      pricingPage: {
        url: 'https://x.example.com/pricing',
        tier: 'paid',
        note: '',
        checkedAt: NOW.toISOString(),
      },
    });
    const m = mergeCandidates([a, c, b, d]);
    expect(m).toHaveLength(2);
    expect(m[0]!.installMethods.map((x) => x.kind)).toEqual(['winget', 'npm-cli']);
    expect(m[0]!.os).toEqual(['windows', 'linux']);
    expect(m[0]!.sources).toEqual(['winget', 'npm']);
    expect(m[1]!.pricing.tier).toBe('unknown');
  });

  it('최대 5개, free-first면 상위 5개에 무료가 없을 때 무료 하나를 끼워 넣음', () => {
    const paid = Array.from({ length: 7 }, (_, i) =>
      cand({
        name: `paid${i}`,
        packageRepo: false,
        pricingPage: {
          url: `https://p${i}.example.com/pricing`,
          tier: 'paid',
          note: '',
          checkedAt: NOW.toISOString(),
        },
      }),
    );
    const free = cand({ name: 'freebie', license: 'MIT' });
    const s = selectCandidates([...paid, free], 'free-first');
    expect(s.candidates).toHaveLength(MAX_CANDIDATES);
    expect(s.candidates.at(-1)!.name).toBe('freebie');
    expect(s.notices).toEqual([]);
    expect(selectCandidates([...paid, free], 'any').candidates.map((c) => c.name)).not.toContain('freebie');
    expect(selectCandidates([...paid, free], 'free-only').candidates.map((c) => c.name)).toEqual(['freebie']);
  });

  it('무료가 하나도 없으면 "무료로 쓸 수 있는 걸 못 찾았어요", 1개뿐이면 적다고 안내', () => {
    const p = cand({ name: 'p', packageRepo: false });
    const s = selectCandidates([p, cand({ name: 'q', packageRepo: false })], 'free-first');
    expect(s.notices).toEqual([NO_FREE_NOTICE]);
    expect(selectCandidates([p], 'free-first').notices).toEqual([NO_FREE_NOTICE, FEW_NOTICE]);
    expect(selectCandidates([p, p], 'any').notices).toEqual([]);
  });
});

describe('P3-B.7 Windows/WSL 호환 필터 (현재 사용자 환경 기준)', () => {
  const win = cand({
    name: 'winonly',
    os: ['windows'],
    installMethod: { kind: 'winget', id: 'A.B', label: 'w' },
  });
  const mac = cand({ name: 'maconly', os: ['mac'] });
  const lin = cand({
    name: 'linux-cli',
    os: ['linux'],
    installMethod: { kind: 'wsl-apt', id: 'x', label: 'apt' },
  });
  const any = cand({
    name: 'npm-tool',
    os: ['windows', 'linux', 'mac'],
    installMethod: { kind: 'npm-cli', id: 'n', label: 'n' },
  });
  const unknown = cand({ name: 'web-tool', packageRepo: false });
  const names = (os: 'windows' | 'wsl' | 'posix') =>
    filterByOs([win, mac, lin, any, unknown], os).map((c) => c.name);

  it('OS 불일치 후보 제외', () => {
    expect(names('windows')).toEqual(['winonly', 'npm-tool', 'web-tool']);
    expect(names('wsl')).toEqual(['winonly', 'linux-cli', 'npm-tool', 'web-tool']);
    expect(names('posix')).toEqual(['maconly', 'linux-cli', 'npm-tool', 'web-tool']);
  });

  it('환경에서 못 쓰는 설치 방법만 남으면 제외 (posix에서 winget만 있는 후보)', () => {
    const both = cand({
      name: 'both',
      os: ['windows', 'linux'],
      installMethod: { kind: 'winget', id: 'A.B', label: 'w' },
    });
    expect(filterByOs([both], 'posix')).toEqual([]);
    expect(filterByOs([both], 'wsl')).toHaveLength(1);
  });

  it('finder가 사용자 환경으로 거른다', async () => {
    const r = await new ToolFinder({
      home: home(),
      packageProviders: [
        staticProvider('pkg', 'package', [
          hit({ name: 'maconly', license: 'MIT', os: ['mac'] }),
          hit({ name: 'ok', license: 'MIT', os: ['windows'] }),
        ]),
      ],
      webProviders: [],
      os: 'windows',
      now: () => NOW,
    }).find({ capability: '소리 뽑기' });
    expect(r.status === 'candidates' && r.candidates.map((c) => c.name)).toEqual(['ok']);
  });
});

describe('P3-B.8 검색 결과 7일 캐시 (가격 확인 날짜 표시)', () => {
  it('7일 안에는 공급자를 다시 부르지 않고, 지나면 다시 찾는다. 확인 날짜는 첫 검색 날짜 그대로', async () => {
    const dir = home();
    let now = NOW;
    const p = staticProvider('pkg', 'package', [winget('ffmpeg'), winget('handbrake')]);
    const f = new ToolFinder({
      home: dir,
      packageProviders: [p],
      webProviders: [],
      os: 'windows',
      now: () => now,
    });
    const r1 = await f.find({ capability: '소리 뽑기' });
    now = new Date(NOW.getTime() + 6 * 24 * 3600 * 1000);
    const r2 = await new ToolFinder({
      home: dir,
      packageProviders: [p],
      webProviders: [],
      os: 'windows',
      now: () => now,
    }).find({
      capability: '소리  뽑기',
    });
    expect(p.queries).toHaveLength(1);
    if (r1.status !== 'candidates' || r2.status !== 'candidates') throw new Error('x');
    expect(r1.fromCache).toBe(false);
    expect(r2.fromCache).toBe(true);
    expect(r2.searched).toEqual([]);
    expect(r2.candidates[0]!.pricing.checkedAt).toBe(NOW.toISOString());
    expect(r2.candidates[0]!.checkedLabel).toBe('11/11 확인');
    now = new Date(NOW.getTime() + SEARCH_CACHE_TTL_MS + 1000);
    const r3 = await f.find({ capability: '소리 뽑기' });
    expect(p.queries).toHaveLength(2);
    expect(r3.status === 'candidates' && r3.fromCache).toBe(false);
    // 예산이 다르면 다른 열쇠
    await f.find({ capability: '소리 뽑기', constraints: { budget: 'any' } });
    expect(p.queries).toHaveLength(3);
    expect(checkedLabel('bad')).toBe('확인 날짜 없음');
  });
});
