import { checkPlainKorean } from '@harness-x/approvals';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CON_TEMPLATE,
  PREVIOUS_CHOICE_LABEL,
  REASON_TEMPLATE,
  rankToolCandidates,
  reasonsFor,
  ToolFinder,
} from '../src/index.js';
import { cand, hit, NOW, staticProvider, tempHome } from './helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

const paidPage = (u: string) => ({
  url: u,
  tier: 'paid' as const,
  note: '돈을 내야 쓸 수 있어요.',
  checkedAt: NOW.toISOString(),
});

describe('P3-C.1 정렬: 신뢰 > 예산 적합 > 설치 쉬움 > OS 호환 > 최근 유지보수', () => {
  const names = (l: { name: string }[]) => l.map((c) => c.name);

  it('신뢰 등급이 가장 먼저 (공식 > 일반 > 주의)', () => {
    const caution = cand({
      name: 'old',
      license: 'MIT',
      lastRelease: '2020-01-01T00:00:00Z',
      installMethod: { kind: 'npm-cli', id: 'old', label: 'n' },
    });
    const normal = cand({
      name: 'normal',
      packageRepo: false,
      pricingPage: paidPage('https://n.example.com/pricing'),
    });
    const official = cand({
      name: 'official',
      packageRepo: false,
      installMethod: { kind: 'winget', id: 'A.B', label: 'w' },
    });
    expect(caution.trust.level).toBe('주의');
    expect(names(rankToolCandidates([caution, normal, official], 'free-first', 'windows'))).toEqual([
      'official',
      'normal',
      'old',
    ]);
  });

  it('같은 신뢰면 예산 적합 (free-first: 무료 > 무료+유료 > 모름 > 체험판 > 유료, any면 무시)', () => {
    const mk = (name: string, tier?: 'paid' | 'trial' | 'freemium') =>
      cand({
        name,
        packageRepo: !tier && name === 'free',
        ...(name === 'free' ? { license: 'MIT' } : {}),
        ...(tier ? { pricingPage: { ...paidPage(`https://${name}.example.com/pricing`), tier } } : {}),
      });
    const list = [
      mk('paid', 'paid'),
      mk('trial', 'trial'),
      mk('unknown'),
      mk('freemium', 'freemium'),
      mk('free'),
    ];
    expect(names(rankToolCandidates(list, 'free-first', 'windows'))).toEqual([
      'free',
      'freemium',
      'unknown',
      'trial',
      'paid',
    ]);
    expect(names(rankToolCandidates(list, 'any', 'windows'))).toEqual(names(list));
  });

  it('그다음 설치 쉬움 (winget·공식 마켓 우선) → OS 호환 → 최근 유지보수', () => {
    const npm = cand({
      name: 'npm',
      license: 'MIT',
      installMethod: { kind: 'npm-cli', id: 'n', label: 'n' },
      os: ['windows'],
    });
    const vsc = cand({
      name: 'vsc',
      license: 'MIT',
      installMethod: { kind: 'vscode-ext', id: 'v', label: 'v' },
      os: ['windows'],
    });
    const scoop = cand({
      name: 'scoop',
      license: 'MIT',
      installMethod: { kind: 'scoop', id: 's', label: 's' },
      os: ['windows'],
    });
    expect(names(rankToolCandidates([npm, vsc, scoop], 'free-first', 'windows'))).toEqual([
      'scoop',
      'vsc',
      'npm',
    ]);
    const osKnown = cand({ name: 'known', license: 'MIT', os: ['windows'] });
    const osUnknown = cand({ name: 'unknownos', license: 'MIT' });
    expect(names(rankToolCandidates([osUnknown, osKnown], 'free-first', 'windows'))).toEqual([
      'known',
      'unknownos',
    ]);
    const fresh = cand({ name: 'fresh', packageRepo: false, lastRelease: '2026-10-01T00:00:00Z' });
    const stale = cand({ name: 'stale', packageRepo: false, lastRelease: '2026-01-01T00:00:00Z' });
    const none = cand({ name: 'none', packageRepo: false });
    const arch = cand({ name: 'arch', packageRepo: false, archived: true });
    expect(names(rankToolCandidates([arch, none, stale, fresh], 'any', 'windows'))).toEqual([
      'fresh',
      'stale',
      'none',
      'arch',
    ]);
  });
});

describe('P3-C.2 추천 이유 1~2문장 + 아쉬운 점 1문장, 쉬운 말 검사 통과', () => {
  const fixtures = [
    cand({
      name: 'ffmpeg',
      license: 'GPL-3.0',
      installMethod: { kind: 'winget', id: 'Gyan.FFmpeg', label: 'w' },
      os: ['windows'],
    }),
    cand({
      name: 'HandBrake',
      license: 'GPL-2.0',
      installMethod: { kind: 'winget', id: 'HandBrake.HandBrake', label: 'w' },
    }),
    cand({
      name: 'Adobe Media Encoder',
      packageRepo: false,
      pricingPage: paidPage('https://www.adobe.com/pricing'),
    }),
    cand({ name: 'whisper', installMethod: { kind: 'ollama-model', id: 'whisper', label: 'o' } }),
    cand({
      name: 'moviepy',
      license: 'MIT',
      installMethod: { kind: 'python-cli', id: 'moviepy', label: 'p' },
    }),
    cand({
      name: 'trialware',
      packageRepo: false,
      pricingPage: { ...paidPage('https://t.example.com/pricing'), tier: 'trial' },
    }),
    cand({
      name: 'old-tool',
      license: 'MIT',
      archived: true,
      installMethod: { kind: 'npm-cli', id: 'o', label: 'n' },
    }),
  ];

  it('스냅샷 + 전부 검사 통과', () => {
    const out = fixtures.map((c) => ({ name: c.name, ...reasonsFor(c) }));
    for (const o of out) {
      expect(checkPlainKorean(o.reason).ok, o.reason).toBe(true);
      expect(checkPlainKorean(o.con).ok, o.con).toBe(true);
      expect(o.reason.split(/(?<=요\.)\s*/).filter(Boolean).length).toBeLessThanOrEqual(2);
    }
    expect(out).toMatchSnapshot();
  });

  it('AI가 준 문장이 검사에서 떨어지면 템플릿으로 대체', () => {
    const c = {
      ...fixtures[0]!,
      pros: ['This tool uses a regex based parser with hashing'],
      cons: ['JSON schema가 복잡하다'],
    };
    const r = reasonsFor({
      ...c,
      installMethods: [],
      pricing: { ...c.pricing, tier: 'unknown' },
      trust: { level: '일반', reasons: [] },
    });
    expect(r.replaced).toBe(true);
    expect(r.reason).toBe(REASON_TEMPLATE);
    expect(checkPlainKorean(r.con).ok).toBe(true);
    const ok = reasonsFor({
      ...fixtures[0]!,
      pros: ['가장 많이 쓰여요.'],
      cons: ['화면 없이 명령으로만 써요.'],
    });
    expect(ok).toEqual({ reason: '가장 많이 쓰여요.', con: '화면 없이 명령으로만 써요.', replaced: false });
    expect(checkPlainKorean(CON_TEMPLATE).ok).toBe(true);
  });
});

describe('P3-C.7 같은 필요가 다시 나오면 "지난번에 고른 도구"를 맨 위에', () => {
  it('재요청 시 이전 선택이 맨 위 + previous 표시 (결과에 없어도 기록에서)', async () => {
    const t = tempHome();
    cleanups.push(t.cleanup);
    const results = [
      hit({
        name: 'ffmpeg',
        license: 'MIT',
        installMethod: { kind: 'winget', id: 'Gyan.FFmpeg', label: 'w' },
      }),
      hit({ name: 'HandBrake', license: 'MIT' }),
      hit({ name: 'Audacity', license: 'MIT' }),
    ];
    const f = new ToolFinder({
      home: t.dir,
      packageProviders: [staticProvider('pkg', 'package', results)],
      webProviders: [],
      os: 'windows',
      now: () => NOW,
    });
    const r1 = await f.find({ capability: '동영상에서 소리 뽑기' });
    if (r1.status !== 'candidates') throw new Error('x');
    expect(r1.candidates.some((c) => c.previous)).toBe(false);
    f.recordChoice('동영상에서 소리 뽑기', [r1.candidates.find((c) => c.name === 'Audacity')!]);
    const r2 = await f.find({ capability: '동영상에서  소리 뽑기!' });
    if (r2.status !== 'candidates') throw new Error('x');
    expect(r2.candidates[0]).toMatchObject({ name: 'Audacity', previous: true });
    expect(r2.candidates.filter((c) => c.previous)).toHaveLength(1);
    expect(r2.candidates.find((c) => c.recommended)!.name).toBe('ffmpeg');
    // 다른 필요에는 표시 없음
    const r3 = await f.find({ capability: 'PDF 표 뽑기' });
    expect(r3.status === 'candidates' && r3.candidates.some((c) => c.previous)).toBe(false);
    expect(PREVIOUS_CHOICE_LABEL).toBe('지난번에 고른 도구');
  });
});
