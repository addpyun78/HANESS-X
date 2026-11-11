import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOOLS_SETTINGS,
  parseToolNeed,
  parseToolsSettings,
  requiredByLabel,
  ToolNeedSchema,
  ToolsSettingsSchema,
} from '../src/index.js';

describe('P3-A.2 ToolNeed { capability, why, requiredBy(itemId|nodeId), constraints{os, offline, budget} }', () => {
  it('항목·노드 둘 다 받고 기본값을 채운다', () => {
    const a = parseToolNeed({
      capability: '동영상에서 소리만 뽑아내기',
      why: '4.2 항목에 필요해요',
      requiredBy: { itemId: '4.2' },
      constraints: { os: 'wsl' },
    });
    expect(a.constraints).toEqual({ os: 'wsl', offline: false, budget: 'free-first' });
    expect(a.source).toBe('user');
    expect(requiredByLabel(a.requiredBy)).toBe('항목 4.2');
    const b = parseToolNeed({
      capability: 'PDF에서 표 뽑기',
      requiredBy: { nodeId: 'n3' },
      constraints: { os: 'windows', offline: true, budget: 'free-only' },
      source: 'agent-gap',
    });
    expect(b.requiredBy).toEqual({ nodeId: 'n3' });
    expect(b.why).toBe('');
  });

  it('잘못된 값은 거부: 빈 능력 설명, 80자 초과, 모르는 OS·예산, itemId+nodeId 동시, 모르는 필드', () => {
    const base = { capability: '소리 뽑기', constraints: { os: 'windows' } };
    expect(ToolNeedSchema.safeParse(base).success).toBe(true);
    expect(ToolNeedSchema.safeParse({ ...base, capability: ' ' }).success).toBe(false);
    expect(ToolNeedSchema.safeParse({ ...base, capability: '가'.repeat(81) }).success).toBe(false);
    expect(ToolNeedSchema.safeParse({ ...base, constraints: { os: 'mac' } }).success).toBe(false);
    expect(
      ToolNeedSchema.safeParse({ ...base, constraints: { os: 'windows', budget: 'cheap' } }).success,
    ).toBe(false);
    expect(ToolNeedSchema.safeParse({ ...base, requiredBy: { itemId: '1', nodeId: 'n' } }).success).toBe(
      false,
    );
    expect(ToolNeedSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(ToolNeedSchema.safeParse({ capability: '소리 뽑기' }).success).toBe(false);
  });
});

describe('P3-A.4 설정 tools.budget = free-only | free-first(기본) | any', () => {
  it('기본 free-first, 세 값 허용, 그 밖은 거부', () => {
    expect(DEFAULT_TOOLS_SETTINGS.budget).toBe('free-first');
    expect(parseToolsSettings({}).budget).toBe('free-first');
    for (const b of ['free-only', 'free-first', 'any'] as const)
      expect(parseToolsSettings({ tools: { budget: b } }).budget).toBe(b);
    expect(() => parseToolsSettings({ tools: { budget: 'paid-only' } })).toThrow();
    expect(ToolsSettingsSchema.safeParse({ budget: 'any', unknownKey: 1 }).success).toBe(false);
    expect(parseToolsSettings({ budget: 'any' })).toEqual({ budget: 'any', searxng: '', brave: false });
  });
});
