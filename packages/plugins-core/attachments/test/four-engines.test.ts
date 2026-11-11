import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAntigravityEngine } from '@harness-x/engine-antigravity';
import { createClaudeCodeEngine } from '@harness-x/engine-claude-code';
import { createCodexEngine } from '@harness-x/engine-codex';
import { ollamaEngine } from '@harness-x/engine-openai-compat';
import type { Attachment } from '@harness-x/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openaiText, startMock } from '../../../engines/openai-compat/test/mock-server.js';
import { AttachmentStore, ConversionQueue, DEFAULT_CONVERTERS } from '../src/index.js';
import { FAKE_CLI, replayArgv } from './engine-trio.js';
import { fakeTools, tempProject } from './helpers.js';

/** 1F.2 같은 첨부 3종(그림·PDF·XLSX)을 4개 엔진에 — 픽스처 파일 그대로 */
const DIR = fileURLToPath(new URL('../../../../fixtures/attachments/files', import.meta.url));
const NAMES = ['gps.jpg', 'report.pdf', 'three-sheets.xlsx'];

const p = tempProject('hx-four-');
const list: Attachment[] = [];
beforeAll(async () => {
  const store = new AttachmentStore({ projectRoot: p.root });
  const q = new ConversionQueue({ store, converters: DEFAULT_CONVERTERS, context: { tools: fakeTools() } });
  for (const n of NAMES) {
    const { attachment } = await store.add('s', { name: n, path: join(DIR, n) });
    list.push(await q.enqueue(attachment));
  }
});
afterAll(() => p.cleanup());

const opts = () => ({
  sessionId: 's',
  prompt: '첨부 3개를 보고 요약해 주세요',
  cwd: p.root,
  attachments: list,
});

/** 엔진이 받은 내용에 세 첨부가 모두 들어 있는지 (이름 + 원본 경로) */
function expectAllThree(received: string) {
  for (const a of list) {
    expect(received).toContain(a.originalName);
    expect(received).toContain(a.storedPath);
  }
}

describe('1F.2 4개 엔진(claude·codex·agy·로컬)에 같은 첨부 3종 전달 리플레이', () => {
  it('claude-code: 세 첨부 모두 목록에, 그림·PDF는 Read로 직접', async () => {
    const argv = await replayArgv(
      createClaudeCodeEngine({ command: process.execPath, prefixArgs: [FAKE_CLI] }),
      opts(),
      join(p.root, 'claude.jsonl'),
    );
    const prompt = argv.at(-1)!;
    expectAllThree(prompt);
    expect(prompt).toMatch(/gps\.jpg .*직접 전달/);
    expect(prompt).toMatch(/report\.pdf .*직접 전달/);
    expect(prompt).toMatch(/three-sheets\.xlsx .*글 형태/);
  });

  it('codex: 그림은 --image, PDF·XLSX는 글 형태', async () => {
    const argv = await replayArgv(
      createCodexEngine({ command: process.execPath, prefixArgs: [FAKE_CLI], transport: 'exec' }),
      opts(),
      join(p.root, 'codex.jsonl'),
    );
    expectAllThree(argv.at(-1)!);
    expect(argv[argv.indexOf('--image') + 1]).toBe(list[0]!.storedPath);
    expect(argv.at(-1)).toMatch(/report\.pdf .*글 형태/);
  });

  it('antigravity: 세 첨부 모두 목록에', async () => {
    const argv = await replayArgv(
      createAntigravityEngine({ command: process.execPath, prefixArgs: [FAKE_CLI] }),
      opts(),
      join(p.root, 'agy.jsonl'),
    );
    expectAllThree(argv.join('\n'));
  });

  it('로컬(Ollama llava): 그림은 image_url, PDF·XLSX는 글 내용까지', async () => {
    const mock = await startMock(() => ({ chunks: openaiText('세 개 다 봤어요') }));
    try {
      const engine = ollamaEngine({ baseUrl: `${mock.url}/v1`, toolMode: 'native' });
      const run = engine.run({ ...opts(), model: 'llava' });
      for await (const _e of run.events) {
        /* 다 읽기 */
      }
      const user = (
        mock.requests[0]!.body as { messages: { role: string; content: unknown }[] }
      ).messages.find((m) => m.role === 'user')!;
      const parts = user.content as { type: string; text?: string; image_url?: { url: string } }[];
      expect(parts.map((x) => x.type)).toEqual(['text', 'image_url']);
      expect(parts[1]!.image_url!.url.startsWith('data:image/jpeg;base64,')).toBe(true);
      expectAllThree(parts[0]!.text!);
      expect(parts[0]!.text).toContain('Annual report 2026 summary');
      expect(parts[0]!.text).toContain('| 마포 | 12 |');
    } finally {
      await mock.close();
    }
  });
});
