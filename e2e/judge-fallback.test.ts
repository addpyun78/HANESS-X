import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { openSessionApprovals } from '@harness-x/approvals';
import { ChecklistLedger, loadDefaultGlossary } from '@harness-x/checklist-ledger';
import { defaultCompareCtx } from '@harness-x/comparators';
import { createJudgeChain, type JudgeEngineInfo, type JudgeSpawn } from '@harness-x/judge';
import { createComparePipeline } from '@harness-x/verifier-ladder';
import { describe, expect, it } from 'vitest';
import { repoPath, tempDir } from './helpers.js';

/**
 * T-100 G.3 E2E — 판정 AI 넘어가기
 *   ② 로컬 Ollama(127.0.0.1 가짜 서버)가 켜져 있으면 Ollama가 판정
 *   Ollama를 끄면 → ③ 로그인된 구독 엔진(codex, 녹화 리플레이 실행기)으로 넘어감
 *   구독 엔진도 끄면(로그아웃) → ④ 승인 카드 "판정해 줄 AI가 연결돼 있지 않아요"
 * 실제 엔진·외부 네트워크 호출 없음 (Ollama는 루프백 가짜 서버, codex는 녹화 출력 재생).
 */

const YES_JSON = JSON.stringify({
  same_meaning: 'yes',
  difference_kind: 'equivalent',
  plain_reason: '같은 뜻이에요.',
});

/** 가짜 Ollama: GET /api/tags · POST /api/chat */
async function fakeOllama(): Promise<{ url: string; chats: () => number; close: () => Promise<void> }> {
  let chats = 0;
  const server: Server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen2.5-coder:7b' }] }));
    if (req.url === '/api/chat') {
      chats++;
      req.resume();
      return req.on('end', () => res.end(JSON.stringify({ message: { content: YES_JSON } })));
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    chats: () => chats,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

describe('G.3 Ollama 끄고 판정 → ③ 구독 엔진, 그것도 끄면 승인 카드', () => {
  it('Ollama → (끔) codex 구독 엔진 → (로그아웃) 승인 카드', async () => {
    const tmp = tempDir('hx-e2e-g3-');
    const ollama = await fakeOllama();
    let ollamaUrl = ollama.url;
    try {
      const sessionId = 's-g3';
      const ws = tmp.dir;
      const opened = openSessionApprovals(ws, sessionId, { remindDelaysMs: [] });
      const ledger = new ChecklistLedger({ dir: opened.dir, sessionId });
      ledger.create([
        {
          id: '1',
          title: '저장 결과 안내 문구',
          artifactId: 'art.save-message',
          acceptance: [{ type: 'command', run: 'true' }],
        },
      ]);

      // 엔진 상태 (engine-scanner 감지 + 로그인) — 바꿔 가며 끈다
      const codex: JudgeEngineInfo = {
        id: 'codex',
        detected: true,
        loggedIn: true,
        authMode: 'subscription',
      };
      const spawned: string[][] = [];
      const replay = readFileSync(
        repoPath('packages/plugins-core/verifiers/judge/fixtures/replays/codex.stdout'),
        'utf8',
      );
      const spawn: JudgeSpawn = async (command, args) => {
        spawned.push([command, ...args]);
        return { code: 0, stdout: replay, stderr: '' };
      };
      const chain = createJudgeChain(
        { samples: 3 },
        {
          listEngines: () => [codex],
          get ollamaBaseUrl() {
            return ollamaUrl;
          },
          spawn,
          baseEnv: { PATH: '/usr/bin' },
        },
      );
      const pipeline = createComparePipeline({
        judge: chain,
        approvals: opened.store,
        dictionary: opened.dictionary,
        sessionId,
      });
      const ctx = defaultCompareCtx({ workspaceRoot: ws, glossary: loadDefaultGlossary() });
      const compare = (expected: string, actual: string) =>
        pipeline.compare({
          kind: 'text',
          expected,
          actual,
          ctx,
          itemId: '1',
          itemTitle: '저장 결과 안내 문구',
        });

      // ② Ollama 켜짐 → Ollama가 판정
      const viaLocal = await compare('완료', '작업이 끝났습니다');
      expect(viaLocal).toMatchObject({ status: 'pass', judge: { engineId: 'ollama', verdict: 'equal' } });
      expect(ollama.chats()).toBe(3);
      expect(spawned).toHaveLength(0);

      // Ollama 끔 → ③ 로그인된 구독 엔진(codex)으로 넘어감
      await ollama.close();
      const viaEngine = await compare('저장 끝', '저장을 마쳤어요');
      expect(viaEngine).toMatchObject({
        status: 'pass',
        aiJudged: true,
        judge: { engineId: 'codex', verdict: 'equal', samples: 3 },
        evidence: { compare: { level: 'semantic', judgeEngine: 'codex' }, ai_judged: true },
      });
      expect(spawned).toHaveLength(3);
      expect(spawned[0]!.slice(0, 2)).toEqual(['codex', 'exec']);
      expect(opened.store.pending()).toEqual([]);

      // 구독 엔진도 끔(로그아웃) → ④ 승인 카드
      codex.loggedIn = false;
      ollamaUrl = 'http://127.0.0.1:9'; // 꺼진 포트
      const none = await compare('마감', '마무리했습니다');
      expect(none.status).toBe('awaiting');
      expect(none.judge).toMatchObject({ verdict: 'unavailable', reason: 'no-judge' });
      expect(spawned).toHaveLength(3);
      const pending = opened.store.pending();
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({ kind: 'no-judge', itemId: '1', sessionId });
      // 항목은 사람 결정을 기다린다 (자동으로 통과·실패시키지 않는다)
      expect(ledger.item('1').status).toBe('todo');
      opened.store.dispose();
    } finally {
      await ollama.close().catch(() => {});
      tmp.cleanup();
    }
  });
});
