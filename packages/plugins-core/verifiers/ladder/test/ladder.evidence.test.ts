import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { AcceptanceSchema, loadDefaultGlossary, type Acceptance } from '@harness-x/checklist-ledger';
import { afterEach, describe, expect, it } from 'vitest';
import { checkContentEvidence, type AcceptanceRunner } from '../src/evidence.js';
import { runLadder } from '../src/ladder.js';

const glossary = loadDefaultGlossary();
const acc = (a: unknown): Acceptance => AcceptanceSchema.parse(a);

function workspace(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'hx-ladder-ev-'));
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), c);
  }
  return root;
}

describe('25.4 L3 내용 증거', () => {
  let root = '';
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('위치만 다른 픽스처 → relocated (후보 경로에서 acceptance 재실행)', async () => {
    root = workspace({
      'ai/mobile/MainActivity.kt': 'class MainActivity : AppCompatActivity()',
      'ai/mobile/app.json': '{"name":"mobile","version":1}',
      'ai/web/index.ts': 'export {}',
    });
    const acceptance = [
      acc({ type: 'symbol', symbol: 'class MainActivity' }),
      acc({ type: 'file_exists', file: 'MainActivity.kt' }),
      acc({ type: 'schema', file: 'app.json', requiredKeys: ['name'] }),
      acc({ type: 'command', run: 'test -f {path}/MainActivity.kt && test {rel} = ai/mobile' }),
      acc({ type: 'llm', prompt: '디자인이 맞는가' }),
    ];
    const r = await runLadder({
      expected: { path: '하네스/모바일', kind: 'dir' },
      changes: [
        { path: join(root, 'ai/mobile/MainActivity.kt'), change: 'create' },
        { path: join(root, 'ai/mobile/app.json'), change: 'create' },
        { path: join(root, 'ai/web/index.ts'), change: 'create' },
      ],
      acceptance,
      root,
      glossary,
    });
    expect(r).toMatchObject({ level: 3, verdict: 'relocated', actualPath: 'ai/mobile', escalate: true });
    expect(r.checks?.map((c) => [c.type, c.ok, c.skipped ?? false])).toEqual([
      ['symbol', true, false],
      ['file_exists', true, false],
      ['schema', true, false],
      ['command', true, false],
      ['llm', false, true],
    ]);
    expect(r.confidence).toBeGreaterThan(0.5);
    expect(r.confidence).toBeLessThanOrEqual(0.9);
  });

  it('후보가 acceptance를 통과하지 못하면 wrong', async () => {
    root = workspace({ 'ai/mobile/Other.kt': 'class Other' });
    const r = await runLadder({
      expected: { path: '하네스/모바일', kind: 'dir' },
      changes: [join(root, 'ai/mobile/Other.kt')],
      acceptance: [acc({ type: 'symbol', symbol: 'class MainActivity' })],
      root,
      glossary,
    });
    expect(r).toMatchObject({ level: 3, verdict: 'wrong', escalate: false });
    expect(r.candidates[0]?.path).toBe('ai/mobile');
  });

  it('주입한 실행기로 후보 경로가 넘어간다', async () => {
    root = workspace({ 'src/LoginScreen.kt': 'x' });
    const seen: string[] = [];
    const runner: AcceptanceRunner = async (a, ctx) => {
      seen.push(ctx.artifactPath);
      return { type: a.type, ok: ctx.artifactPath.endsWith('src/LoginScreen.kt'), detail: 'mock' };
    };
    const r = await runLadder({
      expected: { path: 'harness/mobile/login-screen.kt', kind: 'file' },
      changes: ['src/LoginScreen.kt'],
      acceptance: [acc({ type: 'test', run: 'pnpm test login' })],
      root,
      glossary,
      runner,
    });
    expect(r).toMatchObject({ verdict: 'relocated', actualPath: 'src/LoginScreen.kt' });
    expect(seen).toEqual([join(root, 'src/LoginScreen.kt')]);
  });

  it('명령 실패·스키마 키 누락은 실패로 기록', async () => {
    root = workspace({ 'a/app.json': '{"x":1}' });
    const ev = await checkContentEvidence(
      [
        acc({ type: 'schema', file: 'app.json', requiredKeys: ['name'] }),
        acc({ type: 'command', run: 'exit 3' }),
      ],
      { artifactPath: join(root, 'a'), root, kind: 'dir' },
    );
    expect(ev.ok).toBe(false);
    expect(ev.outcomes.map((o) => o.ok)).toEqual([false, false]);
    expect(ev.outcomes[1]!.detail).toContain('exit 3');
  });
});
