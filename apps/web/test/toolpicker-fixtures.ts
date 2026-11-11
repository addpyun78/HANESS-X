import type { PickerCandidateData, ToolPickerData } from '../src/panels/ToolPicker/model.js';

const T = '2026-11-11T09:00:00.000Z';

/** jsdom 환경에서는 import.meta.url이 file:이 아닐 수 있어 저장소 루트(cwd) 기준으로 맞춘다 */
const cssUrl = new URL('../src/panels/ToolPicker/toolpicker.css', import.meta.url);
export const TOOLPICKER_CSS_FILE =
  cssUrl.protocol === 'file:'
    ? decodeURIComponent(cssUrl.pathname)
    : `${process.cwd()}${decodeURIComponent(cssUrl.pathname)}`;

export function pickerCandidate(
  p: Partial<PickerCandidateData> & { id: string; name: string },
): PickerCandidateData {
  return {
    summary: '',
    pricing: {
      tier: 'free',
      note: '오픈소스라 무료예요.',
      sourceUrl: `https://example.org/${p.id}`,
      checkedAt: T,
    },
    license: 'MIT',
    officialUrl: '',
    installMethods: [{ kind: 'winget', id: `X.${p.id}`, label: 'Windows 공식 앱 저장소' }],
    os: ['windows'],
    maintenance: { lastRelease: null, archived: false },
    trust: { level: '공식', reasons: [] },
    pros: [],
    cons: [],
    sources: ['winget'],
    reason: '가장 많이 쓰이고, 설치·삭제가 쉬워요.',
    con: '화면 없이 명령으로만 써요.',
    installLabel: 'Windows 공식 앱 저장소',
    checkedLabel: '11/11 확인',
    recommended: false,
    previous: false,
    ...p,
  };
}

/** 설계서 화면 그대로: ffmpeg(추천·무료) · HandBrake(무료) · Adobe Media Encoder(유료) */
export function pickerData(over: Partial<ToolPickerData> = {}): ToolPickerData {
  return {
    id: 'tool-picker-1',
    need: {
      capability: '동영상에서 소리만 뽑아내기',
      why: '',
      requiredBy: { itemId: '4.2' },
      constraints: { os: 'wsl', offline: false, budget: 'free-first' },
      source: 'engine',
    },
    candidates: [
      pickerCandidate({ id: 'ffmpeg', name: 'ffmpeg', recommended: true, summary: '동영상·소리 변환 도구' }),
      pickerCandidate({
        id: 'handbrake',
        name: 'HandBrake',
        reason: '화면이 있어서 직접 눈으로 볼 수 있어요.',
        con: '소리만 뽑는 기능은 조금 찾아야 해요.',
      }),
      pickerCandidate({
        id: 'adobemediaencoder',
        name: 'Adobe Media Encoder',
        pricing: {
          tier: 'paid',
          note: '월 구독이 필요해요.',
          sourceUrl: 'https://www.adobe.com/pricing',
          checkedAt: T,
        },
        installMethods: [],
        installLabel: '공식 사이트에서 직접 받기',
        reason: '이미 Adobe를 쓰고 있다면 편해요.',
        con: '돈을 내야 쓸 수 있어요.',
        trust: { level: '일반', reasons: [] },
      }),
    ],
    recommendedId: 'ffmpeg',
    notices: [],
    ...over,
  };
}
