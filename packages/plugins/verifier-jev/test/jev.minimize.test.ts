import {
  DataMinimizationError,
  minimizeJudgeState,
  sameArtifactQuestion,
  stripCodeBlocks,
  type JudgeState,
} from '@harness-x/protocol';
import { describe, expect, it } from 'vitest';
import { JevClient } from '../src/index.js';

const SOURCE = 'class MainActivity : AppCompatActivity() {\n  override fun onCreate() { secretToken() }\n}';

/** 엔진·사다리가 실수로 소스를 섞어 넘긴 상태 */
const leaky = {
  itemTitle: '모바일 앱 스캐폴드\n```kotlin\n' + SOURCE + '\n```\n`val x = 1` 포함',
  expectedPath: 'harness/mobile',
  actualPath: 'ai/mobile',
  candidates: ['ai/mobile'],
  fileNames: ['ai/mobile/MainActivity.kt', 'line\nbreak.kt'],
  symbols: ['MainActivity', 'onCreate', 'fun onCreate() { secretToken() }'],
  content: SOURCE,
  diff: '+' + SOURCE,
  checks: [{ type: 'symbol', output: SOURCE }],
};

async function sentBody(state: unknown): Promise<string> {
  let body = '';
  const f = (async (_u: string, init: RequestInit) => {
    body = String(init.body);
    return new Response(JSON.stringify({ noul: 0.5, confidence: 0.5 }));
  }) as unknown as typeof fetch;
  await new JevClient({ endpoint: 'https://jev.example/v1', fetch: f }).judge(
    sameArtifactQuestion(),
    state as JudgeState,
  );
  return body;
}

describe('전송 데이터 최소화: 경로·파일명·심볼 목록·항목 제목만', () => {
  it('요청 본문에 코드 블록·소스 본문이 없다', async () => {
    const body = await sentBody(leaky);
    expect(body).not.toContain('```');
    expect(body).not.toContain('`');
    expect(body).not.toContain('secretToken');
    expect(body).not.toContain('AppCompatActivity');
    expect(body).not.toContain('val x');
    const user = JSON.parse(JSON.parse(body).messages[1].content);
    expect(Object.keys(user.state).sort()).toEqual(
      ['actualPath', 'candidates', 'expectedPath', 'fileNames', 'itemTitle', 'symbols'].sort(),
    );
    expect(user.state).toEqual({
      itemTitle: '모바일 앱 스캐폴드 포함',
      expectedPath: 'harness/mobile',
      actualPath: 'ai/mobile',
      candidates: ['ai/mobile'],
      fileNames: ['MainActivity.kt'],
      symbols: ['MainActivity', 'onCreate'],
    });
  });

  it('경로에 코드가 섞이면 거부 (전송하지 않음)', async () => {
    let called = false;
    const f = (async () => {
      called = true;
      return new Response('{}');
    }) as unknown as typeof fetch;
    const c = new JevClient({ endpoint: 'https://jev.example/v1', fetch: f });
    await expect(
      c.judge(sameArtifactQuestion(), {
        ...minimizeJudgeState({ itemTitle: 't', expectedPath: 'a' }),
        actualPath: 'ai/mobile\n' + SOURCE,
      }),
    ).rejects.toThrow(DataMinimizationError);
    expect(called).toBe(false);
  });

  it('stripCodeBlocks', () => {
    expect(stripCodeBlocks('a ```js\nx()\n``` b ~~~\ny\n~~~ c `z` d')).toBe('a b c d');
    expect(stripCodeBlocks('열린 울타리 ```\n코드')).toBe('열린 울타리');
    expect(() => minimizeJudgeState({ itemTitle: '```x```', expectedPath: 'a' })).toThrow(
      DataMinimizationError,
    );
  });
});
