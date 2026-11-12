import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { killGroup, killTreeCommand, runLineProcess, spawnGroup, eventFactory } from '../src/proc.js';
import { STOP_NOW_GRACE_MS } from '../src/stop.js';

/** 프로세스 그룹에 남은 프로세스 id (리눅스 ps) */
function groupMembers(pgid: number): number[] {
  try {
    const out = execFileSync('ps', ['-o', 'pid=', '-g', String(pgid)], { encoding: 'utf8' });
    return out
      .split('\n')
      .map((l) => Number(l.trim()))
      .filter((n) => n > 0);
  } catch {
    return []; // ps는 결과가 없으면 1로 끝난다
  }
}

async function until(fn: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!fn() && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
}

describe('2A.4 지금 멈추기 — Windows taskkill 인자 (스냅샷)', () => {
  it('Windows는 자식 트리까지 /T /F, 그 밖은 프로세스 그룹 신호', () => {
    expect(killTreeCommand(4321, 'win32')).toMatchInlineSnapshot(`
      {
        "args": [
          "/pid",
          "4321",
          "/T",
          "/F",
        ],
        "file": "taskkill",
      }
    `);
    expect(killTreeCommand(4321, 'linux')).toBeUndefined();
    expect(killTreeCommand(4321, 'darwin')).toBeUndefined();
    expect(STOP_NOW_GRACE_MS).toBe(3000);
  });
});

describe.skipIf(process.platform === 'win32')('2A.4 지금 멈추기 — 리눅스 프로세스 그룹 (실제)', () => {
  it('자식·손자 프로세스를 띄운 셸을 멈추면 그룹 잔존 0개', async () => {
    const child = spawnGroup('sh', ['-c', 'sleep 300 & sleep 300 & (sleep 300 &) ; echo ready; wait'], {
      cwd: process.cwd(),
    });
    await new Promise<void>((r) => child.stdout!.once('data', () => r()));
    const pgid = child.pid!;
    await until(() => groupMembers(pgid).length >= 4);
    expect(groupMembers(pgid).length).toBeGreaterThanOrEqual(4); // sh + sleep 3개
    await killGroup(child);
    await until(() => groupMembers(pgid).length === 0);
    expect(groupMembers(pgid)).toEqual([]);
  });

  it('SIGTERM을 무시하면 3초 뒤 강제 종료(SIGKILL), 잔존 0개', async () => {
    // trap '' TERM: 셸과 그 자식이 모두 SIGTERM을 무시 (무시 설정은 자식에게 이어진다)
    const child = spawnGroup('sh', ['-c', "trap '' TERM; sleep 300 & sleep 300 & echo ready; wait"], {
      cwd: process.cwd(),
    });
    await new Promise<void>((r) => child.stdout!.once('data', () => r()));
    const pgid = child.pid!;
    await until(() => groupMembers(pgid).length >= 3);
    const t0 = Date.now();
    await killGroup(child);
    const took = Date.now() - t0;
    expect(took).toBeGreaterThanOrEqual(STOP_NOW_GRACE_MS - 100);
    expect(took).toBeLessThan(STOP_NOW_GRACE_MS + 3000);
    expect(child.signalCode).toBe('SIGKILL');
    await until(() => groupMembers(pgid).length === 0);
    expect(groupMembers(pgid)).toEqual([]);
  });

  it('엔진 interrupt(runLineProcess) → 그룹 종료, turn_end interrupted, 잔존 0개', async () => {
    const run = runLineProcess({
      command: 'sh',
      args: ['-c', 'sleep 300 & sleep 300 & echo \'{"ready":true}\'; wait'],
      cwd: process.cwd(),
      event: eventFactory({ sessionId: 's', engineId: 'fake' }),
      parser: {
        line: () => [],
        finish: () => [{ type: 'turn_end', reason: 'completed' }],
        sessionId: () => undefined,
      },
    });
    await new Promise((r) => setTimeout(r, 300));
    const pids = execFileSync('ps', ['-eo', 'pgid=,pid=,args='], { encoding: 'utf8' });
    const pgid = Number(
      pids
        .split('\n')
        .find((l) => l.includes('sleep 300 & sleep 300'))
        ?.trim()
        .split(/\s+/)[0],
    );
    expect(pgid).toBeGreaterThan(0);
    await run.interrupt();
    const events = [];
    for await (const e of run.events) events.push(e);
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', reason: 'interrupted' });
    await until(() => groupMembers(pgid).length === 0);
    expect(groupMembers(pgid)).toEqual([]);
  });
});
