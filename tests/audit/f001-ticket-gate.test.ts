// @features F-001
// T-102 B.23.F-001 기능 고정: 작업 게이트(scripts/ticket-gate.mjs) — 진행 중 티켓에 미완료가 있으면 종료코드 2,
// 진척 없이 다시 멈추면 0(사람에게 넘김), 미완료가 없으면 0
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const gate = fileURLToPath(new URL('../../scripts/ticket-gate.mjs', import.meta.url));
let dir = '';
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

function setup(ticket: string) {
  dir = mkdtempSync(join(tmpdir(), 'hx-gate-'));
  mkdirSync(join(dir, 'scripts'));
  mkdirSync(join(dir, 'docs', 'tickets'), { recursive: true });
  cpSync(gate, join(dir, 'scripts', 'ticket-gate.mjs'));
  writeFileSync(join(dir, 'docs', 'tickets', 'T-900.md'), ticket);
}
const run = (input: object) =>
  spawnSync(process.execPath, [join(dir, 'scripts', 'ticket-gate.mjs')], {
    input: JSON.stringify(input),
    encoding: 'utf8',
  });

describe('F-001 작업 게이트 (현재 동작 고정)', () => {
  it('status: doing + 미완료 → 2, 같은 수로 다시 멈추면 0, 다 끝나면 0', () => {
    setup('status: doing\n\n- [x] 1.1 끝남\n- [ ] 1.2 남음\n');
    const a = run({});
    expect(a.status).toBe(2);
    expect(a.stderr).toContain('1.2 남음');
    expect(run({ stop_hook_active: true }).status).toBe(0);
    writeFileSync(
      join(dir, 'docs', 'tickets', 'T-900.md'),
      'status: doing\n\n- [x] 1.1 끝남\n- [x] 1.2 끝남\n',
    );
    expect(run({}).status).toBe(0);
  });
  it('status: done 티켓의 미완료는 막지 않는다', () => {
    setup('status: done\n\n- [ ] 1.2 남음\n');
    expect(run({}).status).toBe(0);
  });
});
