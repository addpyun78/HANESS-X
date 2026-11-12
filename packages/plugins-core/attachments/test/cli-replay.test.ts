import { join } from 'node:path';
import { createAntigravityEngine } from '@harness-x/engine-antigravity';
import { CLAUDE_ATTACHMENT_HINT, createClaudeCodeEngine } from '@harness-x/engine-claude-code';
import { buildExecArgs, createCodexEngine, turnInput } from '@harness-x/engine-codex';
import { afterEach, describe, expect, it } from 'vitest';
import { FAKE_CLI, attachmentTrio, replayArgv } from './engine-trio.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

/** `--` 뒤 마지막 인자 = 프롬프트 */
const promptOf = (argv: string[]) => argv[argv.lastIndexOf('--') + 1]!;

describe('1D.3 CLI 엔진: 프롬프트에 첨부 목록(이름·종류·원본 경로·글 형태 경로), 그림 옵션이 있으면 그 옵션', () => {
  it('claude-code 리플레이: 목록 + Read로 직접 보라는 안내, 그림 옵션 없음', async () => {
    const t = await attachmentTrio();
    cleanups.push(t.cleanup);
    const engine = createClaudeCodeEngine({ command: process.execPath, prefixArgs: [FAKE_CLI] });
    const argv = await replayArgv(
      engine,
      { sessionId: 's', prompt: '첨부를 보고 정리해 주세요', cwd: t.root, attachments: t.list },
      join(t.root, 'argv.jsonl'),
    );
    const p = promptOf(argv);
    expect(p.startsWith('첨부를 보고 정리해 주세요\n\n## 첨부 파일')).toBe(true);
    expect(p).toContain(CLAUDE_ATTACHMENT_HINT);
    for (const a of t.list) {
      expect(p).toContain(`- ${a.originalName} (id ${a.id}, 종류 ${a.kind}`);
      expect(p).toContain(`  - 원본: ${a.storedPath}`);
    }
    const xlsxText = t.list[2]!.representations.find((r) => r.form === 'text')!;
    expect(p).toContain(`  - 글 형태: ${xlsxText.path}`);
    expect(p).toMatch(/화면\.jpg .*직접 전달/);
    expect(argv).not.toContain('--image');
  });

  it('codex 리플레이(exec): 그림은 --image, PDF·XLSX는 글 형태 경로', async () => {
    const t = await attachmentTrio();
    cleanups.push(t.cleanup);
    const engine = createCodexEngine({
      command: process.execPath,
      prefixArgs: [FAKE_CLI],
      transport: 'exec',
    });
    const argv = await replayArgv(
      engine,
      { sessionId: 's', prompt: '정리', cwd: t.root, attachments: t.list },
      join(t.root, 'argv.jsonl'),
    );
    const img = t.list[0]!;
    expect(argv.slice(argv.indexOf('--image'), argv.indexOf('--image') + 2)).toEqual([
      '--image',
      img.storedPath,
    ]);
    expect(argv.filter((x) => x === '--image')).toHaveLength(1);
    const p = promptOf(argv);
    expect(p).toMatch(/보고서\.pdf .*글 형태/);
    expect(p).toMatch(/매물\.xlsx .*글 형태/);
    // app-server 경로도 같은 그림을 localImage로
    expect(turnInput({ prompt: 'x', images: [img.storedPath] })).toEqual([
      { type: 'text', text: 'x', text_elements: [] },
      { type: 'localImage', path: img.storedPath },
    ]);
    expect(buildExecArgs({ prompt: 'x', cwd: '/w', images: ['/a.png'], resumeId: 'r1' }).join(' ')).toContain(
      '--image /a.png resume r1 -- x',
    );
  });

  it('antigravity 리플레이: 목록 + 경로를 직접 열라는 안내', async () => {
    const t = await attachmentTrio();
    cleanups.push(t.cleanup);
    const engine = createAntigravityEngine({ command: process.execPath, prefixArgs: [FAKE_CLI] });
    const argv = await replayArgv(
      engine,
      { sessionId: 's', prompt: '정리', cwd: t.root, attachments: t.list },
      join(t.root, 'argv.jsonl'),
    );
    const all = argv.join('\n');
    expect(all).toContain('## 첨부 파일');
    for (const a of t.list) expect(all).toContain(a.storedPath);
  });

  it('첨부가 없으면 프롬프트는 그대로', async () => {
    const t = await attachmentTrio();
    cleanups.push(t.cleanup);
    const engine = createClaudeCodeEngine({ command: process.execPath, prefixArgs: [FAKE_CLI] });
    const argv = await replayArgv(
      engine,
      { sessionId: 's', prompt: '안녕', cwd: t.root },
      join(t.root, 'a.jsonl'),
    );
    expect(promptOf(argv)).toBe('안녕');
  });
});
