// @features F-073
import { describe, expect, it } from 'vitest';
import { ToolCandidateSchema, parseCandidate, rawToCandidate } from '../src/index.js';
import { hit, NOW } from './helpers.js';

const valid = {
  id: 'ffmpeg',
  name: 'FFmpeg',
  summary: '동영상·소리 변환 도구',
  pricing: {
    tier: 'free',
    note: '오픈소스라 무료예요.',
    sourceUrl: 'https://github.com/microsoft/winget-pkgs/tree/master/manifests/g/Gyan/FFmpeg',
    checkedAt: NOW.toISOString(),
  },
  license: 'LGPL-2.1-or-later',
  officialUrl: 'https://ffmpeg.org',
  installMethods: [{ kind: 'winget', id: 'Gyan.FFmpeg', label: 'Windows 공식 앱 저장소' }],
  os: ['windows'],
  maintenance: { lastRelease: '2026-10-01T00:00:00Z', archived: false },
  trust: { level: '공식', reasons: ['Windows 공식 앱 저장소예요.'] },
  pros: [],
  cons: [],
};

describe('P3-B.4 ToolCandidate 정규화 스키마', () => {
  it('필수 필드가 모두 있으면 통과 (sources 기본 [])', () => {
    expect(parseCandidate(valid).sources).toEqual([]);
  });

  it('pricing.sourceUrl·checkedAt 없음/빈 값, 모르는 등급·설치 종류·OS·신뢰 등급, 모르는 필드 → 거부', () => {
    const bad = [
      { ...valid, pricing: { ...valid.pricing, sourceUrl: '' } },
      { ...valid, pricing: { ...valid.pricing, checkedAt: '' } },
      { ...valid, pricing: { tier: 'free', note: '' } },
      { ...valid, pricing: { ...valid.pricing, tier: 'cheap' } },
      { ...valid, installMethods: [{ kind: 'apt-get', id: 'x', label: 'x' }] },
      { ...valid, os: ['android'] },
      { ...valid, trust: { level: '최고', reasons: [] } },
      { ...valid, maintenance: { lastRelease: null } },
      { ...valid, extra: true },
    ];
    for (const b of bad) expect(ToolCandidateSchema.safeParse(b).success).toBe(false);
  });

  it('공급자 결과 → 후보: 이름 열쇠·설치 방법·OS·신뢰 등급 채움', () => {
    const c = rawToCandidate(
      hit({
        name: 'FFmpeg',
        providerId: 'winget',
        license: 'LGPL-2.1-or-later',
        installMethod: { kind: 'winget', id: 'Gyan.FFmpeg', label: 'Windows 공식 앱 저장소' },
        os: ['windows'],
        verifiedPublisher: true,
      }),
      NOW,
    )!;
    expect(ToolCandidateSchema.parse(c)).toEqual(c);
    expect(c).toMatchObject({
      id: 'ffmpeg',
      license: 'LGPL-2.1-or-later',
      os: ['windows'],
      trust: { level: '공식' },
      sources: ['winget'],
      maintenance: { lastRelease: null, archived: false },
    });
  });
});
