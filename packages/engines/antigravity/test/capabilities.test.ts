import { selectStopStrategy } from '@harness-x/protocol';
import { describe, expect, it } from 'vitest';
import { ANTIGRAVITY_CAPABILITIES, antigravityEngine } from '../src/engine.js';

describe('16.3 네이티브 Stop 훅 없음', () => {
  it('capabilities.nativeStopHook=false', () => {
    expect(antigravityEngine.capabilities).toEqual(ANTIGRAVITY_CAPABILITIES);
    expect(antigravityEngine.capabilities.nativeStopHook).toBe(false);
  });

  it('체크리스트 엔진의 Stop 경로 선택: antigravity → 하네스 측 재주입, 네이티브 훅 엔진 → native-hook', () => {
    expect(selectStopStrategy(antigravityEngine.capabilities)).toBe('harness-reinject');
    expect(selectStopStrategy({ ...antigravityEngine.capabilities, nativeStopHook: true })).toBe(
      'native-hook',
    );
  });
});
