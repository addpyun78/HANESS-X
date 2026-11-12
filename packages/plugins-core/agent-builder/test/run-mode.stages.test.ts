import { describe, expect, it } from 'vitest';
import { StageTracker } from '../src/runner/stages.js';
import { THREE } from './stages-pipelines.js';

// T-101 3번 ↔ 4번: 실제 세션 모드가 단계 실행기에 들어간다 (4B.3 decideLock·4F.7 renderAutoSummary)

const tracker = (mode?: 'plan' | 'normal' | 'auto') =>
  new StageTracker({ sessionId: 's1', agent: { name: 'three', pipeline: THREE }, ...(mode ? { mode } : {}) });

describe('3번 모드 → 단계 실행기', () => {
  it('모드를 넘기면 그 모드, 없으면 일반', () => {
    expect(tracker('auto').mode).toBe('auto');
    expect(tracker().mode).toBe('normal');
  });

  it('오토면 끝난 뒤 요약을 단계별로 묶고, 일반이면 한 줄씩', () => {
    const auto = tracker('auto');
    auto.start();
    const s = auto.autoSummary([{ text: '설치는 사람이 직접 해야 해서 하지 않았어요.' }]);
    expect(s).toContain('## 끝난 뒤 요약');
    expect(s).toContain('## 돌아오면 확인할 것');
    const normal = tracker('normal');
    normal.start();
    expect(normal.autoSummary([{ text: 'a' }])).toBe('- a');
  });
});
