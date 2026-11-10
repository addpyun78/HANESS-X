import type { ModelClient, ModelRequest } from '@harness-x/kernel';
import type { EngineClientFactory, EscalationCase } from '../src/escalate.js';

export const CASE: EscalationCase = {
  itemId: '1',
  artifactId: 'art.mobile-app',
  itemTitle: '모바일 앱 스캐폴드',
  expectedPath: 'harness/mobile',
  actualPath: 'ai/mobile',
  reason: 'L4 불확실 → L5 (p=0.75)',
  writerEngineId: 'claude-code',
  symbols: ['MainActivity'],
};

/** 엔진별 모킹 ModelClient — 질문 종류(answerSchema.required[0])에 따라 답한다 */
export function mockEngines(
  ids: string[],
  reply: (kind: 'noul' | 'choice', engineId: string, attempt: number) => string,
) {
  const calls: { engineId: string; req: ModelRequest }[] = [];
  const factory: EngineClientFactory = {
    engineIds: () => ids,
    client(engineId): ModelClient {
      return {
        async complete(req) {
          calls.push({ engineId, req });
          const user = JSON.parse(req.messages[1]!.content as string);
          const kind = user.answerSchema.required[0] as 'noul' | 'choice';
          const attempt = req.messages.length > 2 ? 1 : 0;
          return { text: reply(kind, engineId, attempt), toolCalls: [] };
        },
      };
    },
  };
  return { factory, calls };
}
