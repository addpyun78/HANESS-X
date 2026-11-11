import { describe, expect, it } from 'vitest';
import { pipeline } from './runner-helpers.js';
import { runWithStages } from './stages-run.js';

const TWO = (a: string, b: string) =>
  pipeline({
    name: 'two',
    nodes: [
      { id: 'plan', type: 'role', engine: a },
      { id: 'build', type: 'role', engine: b },
    ],
    edges: [{ from: 'plan', to: 'build' }],
  });

const sliceOf = (prompt: string) =>
  prompt.slice(0, prompt.indexOf('</harness-checklist>') + '</harness-checklist>'.length);
/** 줄 머리(형식) */
const keys = (slice: string) =>
  slice.split('\n').map((l) =>
    l
      .replace(/[:：].*$/, '')
      .replace(/plan|build/g, 'X')
      .replace(/\d+/g, 'N'),
  );

async function replay(a: string, b: string) {
  const { r, calls, tree } = await runWithStages({
    pipeline: TWO(a, b),
    engines: [a, b],
    outputs: (node) => ({ summary: '맡은 일을 마쳤어요.', value: node }),
  });
  expect(r.status).toBe('completed');
  return { calls, tree };
}

describe('4C.3 단계마다 엔진이 달라도 슬라이스가 같은 형식', () => {
  it('claude → codex 리플레이: 두 단계 모두 같은 형식의 슬라이스를 받고, 엔진을 바꿔도 내용이 같다', async () => {
    const one = await replay('claude-code', 'codex');
    expect(one.calls.map((c) => c.engineId)).toEqual(['claude-code', 'codex']);
    const [p1, p2] = one.calls.map((c) => sliceOf(c.prompt));
    expect(p1!.startsWith('<harness-checklist>\n단계 1/2: plan 단계')).toBe(true);
    expect(p2!.startsWith('<harness-checklist>\n단계 2/2: build 단계')).toBe(true);
    expect(p2).toContain('앞 단계 요약:\n- plan: 맡은 일을 마쳤어요.');
    expect(p2).toContain('받은 값: {"summary":"맡은 일을 마쳤어요.","value":"plan"}');
    // 앞 단계 요약·받은 값 줄을 빼면 형식(줄 머리)이 같다
    const strip = (k: string[]) => k.filter((x) => !['앞 단계 요약', '- X', '받은 값'].includes(x));
    expect(strip(keys(p2!))).toEqual(keys(p1!));
    // 엔진을 바꿔(codex → claude) 다시 돌려도 슬라이스 글자가 같다
    const two = await replay('codex', 'claude-code');
    expect(two.calls.map((c) => sliceOf(c.prompt))).toEqual([p1, p2]);
    expect(one.tree.stages.map((s) => s.engineId)).toEqual(['claude-code', 'codex']);
  });
});
