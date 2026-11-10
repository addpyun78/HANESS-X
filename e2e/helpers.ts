import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChatMessage, ModelClient, ModelRequest, ModelTurn } from '@harness-x/kernel';

/** T-064 E2E 공용 도우미 */

export const E2E_DIR = fileURLToPath(new URL('.', import.meta.url));
export const fixture = (name: string) => join(E2E_DIR, 'fixtures', name);
export const repoPath = (rel: string) => join(E2E_DIR, '..', rel);

export function tempDir(prefix = 'hx-e2e-'): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** 마지막 도구 결과 메시지 (없으면 undefined) */
export function lastToolMessage(messages: ChatMessage[]): Extract<ChatMessage, { role: 'tool' }> | undefined {
  const m = messages.at(-1);
  return m?.role === 'tool' ? m : undefined;
}

let callSeq = 0;
/** 도구 호출 하나를 요청하는 모델 턴 */
export function callTool(name: string, args: Record<string, unknown>, text = ''): ModelTurn {
  return {
    text,
    toolCalls: [{ id: `call-${++callSeq}`, name, arguments: args }],
    usage: { inputTokens: 10, outputTokens: 5 },
  };
}

/** 도구 호출 없이 끝내는 모델 턴 */
export function reply(text: string): ModelTurn {
  return { text, toolCalls: [], usage: { inputTokens: 10, outputTokens: 5 } };
}

/**
 * 대본 모델: 호출마다 script(step, req)가 다음 턴을 돌려준다. 실제 모델 API는 부르지 않는다.
 * 받은 요청은 requests에 남는다.
 */
export function scriptedModel(script: (step: number, req: ModelRequest) => ModelTurn | Promise<ModelTurn>): {
  client: ModelClient;
  requests: ModelRequest[];
} {
  const requests: ModelRequest[] = [];
  return {
    requests,
    client: {
      async complete(req) {
        requests.push(req);
        return script(requests.length - 1, req);
      },
    },
  };
}
