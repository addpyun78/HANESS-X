import {
  DEVIATION_KINDS,
  JudgeStateSchema,
  deviationKindQuestion,
  sameArtifactQuestion,
} from '@harness-x/protocol';
import { describe, expect, it } from 'vitest';
import { JevClient, jevRequestBody } from '../src/index.js';

const state = JudgeStateSchema.parse({
  itemTitle: '모바일 앱 스캐폴드',
  expectedPath: 'harness/mobile',
  actualPath: 'ai/mobile',
  candidates: ['ai/mobile', 'ai/mobile-old'],
  fileNames: ['MainActivity.kt', 'build.gradle.kts'],
  symbols: ['MainActivity', 'onCreate'],
});

describe('질문 템플릿 2종 (요청 스냅샷)', () => {
  it('same_artifact (noul)', () => {
    const q = sameArtifactQuestion();
    expect(q.kind).toBe('noul');
    expect(jevRequestBody(q, state)).toMatchSnapshot();
  });

  it('deviation_kind (choice: equivalent/relocated-ok/wrong-target/missing)', () => {
    const q = deviationKindQuestion();
    expect(q.choices).toEqual(['equivalent', 'relocated-ok', 'wrong-target', 'missing']);
    expect(q.choices).toEqual([...DEVIATION_KINDS]);
    expect(jevRequestBody(q, state)).toMatchSnapshot();
  });

  it('실제 전송 본문 = 스냅샷 본문', async () => {
    const bodies: unknown[] = [];
    const f = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ choice: 'equivalent', confidence: 0.9 }));
    }) as unknown as typeof fetch;
    const c = new JevClient({ endpoint: 'https://jev.example/v1', fetch: f });
    expect(await c.judge(deviationKindQuestion(), state)).toEqual({ choice: 'equivalent', confidence: 0.9 });
    expect(bodies[0]).toEqual(jevRequestBody(deviationKindQuestion(), state));
  });
});
