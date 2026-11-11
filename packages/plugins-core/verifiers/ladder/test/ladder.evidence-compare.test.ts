import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AcceptanceSchema } from '@harness-x/checklist-ledger';
import { afterAll, describe, expect, it } from 'vitest';
import { defaultAcceptanceRunner } from '../src/evidence.js';

const root = mkdtempSync(join(tmpdir(), 'hx-ladder-evcmp-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const ctx = { artifactPath: root, root, kind: 'dir' as const };
const run = (a: unknown) => defaultAcceptanceRunner(AcceptanceSchema.parse(a), ctx);

describe('T-100 D.6 내용 증거 실행기가 비교기를 쓴다', () => {
  it('종료코드는 exitCode 비교기', async () => {
    const ok = await run({ type: 'command', run: 'exit 0' });
    expect(ok).toMatchObject({ ok: true, compare: { kind: 'exitCode', verdict: 'equal' } });
    const bad = await run({ type: 'command', run: 'exit 3' });
    expect(bad).toMatchObject({ ok: false, compare: { kind: 'exitCode', verdict: 'different' } });
  });

  it('기대 출력은 compare.kind(없으면 추론) 비교기 — CRLF·공백 차이는 통과, 값이 다르면 실패', async () => {
    const crlf = await run({
      type: 'command',
      run: "printf 'Tests: 12 passed  \\r\\n'",
      expectOutput: 'Tests: 12 passed',
    });
    expect(crlf).toMatchObject({ ok: true, compare: { kind: 'text', verdict: 'equal' } });
    const num = await run({
      type: 'command',
      run: 'echo 1,000',
      expectOutput: '1000',
      compare: { kind: 'number' },
    });
    expect(num.ok).toBe(true);
    const wrong = await run({ type: 'command', run: 'echo 500', expectOutput: '200' });
    expect(wrong).toMatchObject({
      ok: false,
      compare: { kind: 'number', verdict: 'different', next: 'fail' },
    });
    // 의미 판단이 필요한 차이는 아직 통과시키지 않는다(next: semantic — judge 체인 연결은 E.14)
    const sem = await run({ type: 'command', run: 'echo 작업이 끝났습니다', expectOutput: '완료' });
    expect(sem).toMatchObject({ ok: false, compare: { verdict: 'uncertain', next: 'semantic' } });
  });

  it('심볼은 text 비교기(contains) — 연속 공백 차이도 찾는다', async () => {
    writeFileSync(join(root, 'Main.kt'), 'class  MainActivity : AppCompatActivity()\r\n');
    expect((await run({ type: 'symbol', symbol: 'class MainActivity' })).ok).toBe(true);
    expect((await run({ type: 'symbol', symbol: 'class LoginActivity' })).ok).toBe(false);
  });
});
