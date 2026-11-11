import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  InstallQueue,
  KIND_TIMEOUT_MS,
  createRunner,
  runTool,
  type InstallPlan,
  type RunOptions,
} from '../src/index.js';
import { WINGET_SHOW_JQ, approval, service, tempHome } from './helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((f) => f()));
const home = () => {
  const h = tempHome();
  cleanups.push(h.cleanup);
  return h.dir;
};

const JQ = {
  'winget show --id jqlang.jq': { stdout: WINGET_SHOW_JQ },
  'winget install --id jqlang.jq': { stdout: 'Successfully installed' },
  'winget list --id jqlang.jq': { stdout: 'jq jqlang.jq 1.7.1' },
  'powershell.exe -NoProfile -Command': {
    stdout: 'C:\\Users\\u\\AppData\\Local\\Microsoft\\WinGet\\Links\\jq.exe',
  },
  'winget uninstall --id jqlang.jq': { stdout: 'Successfully uninstalled' },
};

async function planOf(svc: ReturnType<typeof service>['svc'], kind: string, id: string, extra = {}) {
  const p = await svc.plan({ kind, target: { id, ...extra } });
  if ('unavailable' in p) throw new Error('unavailable');
  return p as InstallPlan;
}

describe('P2-E.1 실행 큐 (동시 1개) + 출력 스트리밍', () => {
  it('2건 연속 요청 시 순차 실행', async () => {
    const q = new InstallQueue();
    const log: string[] = [];
    let active = 0;
    let maxActive = 0;
    const job = (name: string) => async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      log.push(`${name}:start`);
      await new Promise((r) => setTimeout(r, 30));
      log.push(`${name}:end`);
      active--;
      return name;
    };
    const a = q.enqueue('a', job('a'), 10_000);
    const b = q.enqueue('b', job('b'), 10_000);
    expect(await Promise.all([a.done, b.done])).toEqual(['a', 'b']);
    expect(log).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
    expect(maxActive).toBe(1);
  });

  it('서비스: 두 설치가 순서대로 실행되고 출력이 스트림(터미널 패널)으로 나간다', async () => {
    const dir = home();
    const order: string[] = [];
    const { svc } = service(dir, (line) => {
      if (line.startsWith('npm view')) {
        const name = line.split(' ')[2]!.split('@')[0]!;
        return { stdout: JSON.stringify({ name, version: '1.0.0', bin: { [name]: 'x' } }) };
      }
      if (line.startsWith('npm i -g'))
        return async () => {
          order.push(`start:${line}`);
          await new Promise((r) => setTimeout(r, 30));
          order.push(`end:${line}`);
          return { stdout: `added 1 package (${line})\n` };
        };
      if (line.endsWith('--version')) return { stdout: '1.0.0' };
      if (line.startsWith('sh -lc')) return { stdout: '/home/u/.npm-global/bin/x\n' };
      return undefined;
    });
    const out: string[] = [];
    svc.onOutput((e) => out.push(`${e.jobId}:${e.data}`));
    const p1 = await planOf(svc, 'npm-cli', 'aaa');
    const p2 = await planOf(svc, 'npm-cli', 'bbb');
    const j1 = svc.execute(p1.id, approval);
    const j2 = svc.execute(p2.id, approval);
    await Promise.all([j1.done, j2.done]);
    expect(order).toEqual([
      'start:npm i -g aaa@1.0.0',
      'end:npm i -g aaa@1.0.0',
      'start:npm i -g bbb@1.0.0',
      'end:npm i -g bbb@1.0.0',
    ]);
    expect(svc.queue.order).toEqual([j1.id, j2.id]);
    expect(out.some((l) => l.startsWith(`${j1.id}:`) && l.includes('added 1 package'))).toBe(true);
    // 같은 계획은 두 번 실행할 수 없다
    expect(() => svc.execute(p1.id, approval)).toThrow('찾지 못했어요');
  });
});

describe('P2-E.2 시간 제한 + 취소', () => {
  it('종류별 시간 제한 표', () => {
    expect(KIND_TIMEOUT_MS.winget).toBe(10 * 60_000);
    expect(KIND_TIMEOUT_MS['ollama-model']).toBe(60 * 60_000);
  });

  it('[취소] → 실제 프로세스 종료 (기본 실행기)', async () => {
    const run = createRunner('posix');
    const ctl = new AbortController();
    const started = Date.now();
    const p = run({ file: 'sleep', args: ['30'] }, { signal: ctl.signal });
    setTimeout(() => ctl.abort(), 100);
    const r = await p;
    expect(r.cancelled).toBe(true);
    expect(Date.now() - started).toBeLessThan(10_000);
    const t = await run({ file: 'sleep', args: ['30'] }, { timeoutMs: 100 });
    expect(t.timedOut).toBe(true);
  });

  it('서비스: 실행 중 취소 → 프로세스 abort + 임시 파일 정리, 대기 중 취소 → 실행 안 함', async () => {
    const dir = home();
    let aborted = false;
    const body = Buffer.from('x'.repeat(10));
    const { svc, runner } = service(
      dir,
      (line) => {
        if (line.startsWith('npm view'))
          return { stdout: JSON.stringify({ name: 'slow', version: '1.0.0', bin: { slow: 'x' } }) };
        if (line.startsWith('npm i -g'))
          return (_cmd, opts: RunOptions) =>
            new Promise((resolve) => {
              opts.signal?.addEventListener('abort', () => {
                aborted = true;
                resolve({ code: null, cancelled: true });
              });
            });
        return undefined;
      },
      { fetch: (async () => new Response(body)) as never },
    );
    const p1 = await planOf(svc, 'npm-cli', 'slow');
    const p2 = await planOf(svc, 'npm-cli', 'slow');
    const j1 = svc.execute(p1.id, approval);
    const j2 = svc.execute(p2.id, approval);
    await new Promise((r) => setTimeout(r, 20));
    expect(svc.cancel(j2.id)).toBe(true); // 대기 중
    expect(svc.cancel(j1.id)).toBe(true); // 실행 중
    const [d1, d2] = await Promise.all([j1.done, j2.done]);
    expect(aborted).toBe(true);
    expect(d1.status).toBe('cancelled');
    expect(d2.status).toBe('cancelled');
    expect(runner.calls.filter((c) => c.line.startsWith('npm i -g')).length).toBe(1);

    // 시간 초과 → 프로세스 abort + 임시 폴더 정리 (설치 화면 단계에서 멈춘 경우)
    const slow = service(
      dir,
      (line) => {
        if (line.includes('Get-AuthenticodeSignature')) return { stdout: 'Valid' };
        if (line.includes('Start-Process'))
          return (_c, opts: RunOptions) =>
            new Promise((res) =>
              opts.signal?.addEventListener('abort', () => res({ code: null, cancelled: true })),
            );
        if (line.startsWith('wslpath')) return { stdout: 'C:\\x.exe' };
        return undefined;
      },
      { fetch: (async () => new Response(body)) as never, timeouts: { 'direct-download': 300 } },
    ).svc;
    const dp = await planOf(slow, 'direct-download', 'https://example.com/setup.exe');
    const dj = await slow.execute(dp.id, approval).done;
    expect(dj.status).toBe('timeout');
    expect(existsSync(join(dir, 'tmp-downloads', dp.id))).toBe(false);
  });
});

describe('P2-E.3 검증 실패 → 쉬운 말 실패 카드 + [정리하기]', () => {
  it('실패 모킹', async () => {
    const dir = home();
    const { svc } = service(dir, {
      ...JQ,
      'winget list --id jqlang.jq': {
        code: 1,
        stdout: 'No installed package found matching input criteria.',
      },
    });
    const p = await planOf(svc, 'winget', 'jqlang.jq');
    const job = await svc.execute(p.id, approval).done;
    expect(job.status).toBe('verify-failed');
    expect(job.failure).toMatchObject({
      title: '설치가 끝나지 않았어요',
      message: '설치는 끝났지만 제대로 동작하는지 확인하지 못했어요.',
      canCleanup: true,
    });
    expect(job.failure!.cleanup[0]).toContain('지워요');
    expect(svc.registry.get('winget:jqlang.jq')).toBeUndefined();
    // 설치 자체가 실패해도 카드
    const { svc: s2 } = service(home(), {
      ...JQ,
      'winget install --id jqlang.jq': { code: 1, stderr: 'boom' },
    });
    const p2 = await planOf(s2, 'winget', 'jqlang.jq');
    const j2 = await s2.execute(p2.id, approval).done;
    expect(j2.status).toBe('failed');
    expect(j2.failure?.message).toBe('설치 도구가 실패를 알렸어요.');
  });
});

describe('P2-E.4 실패 정리(롤백) — 같은 승인 범위, 정리 내용 카드 표시', () => {
  it('롤백 테스트', async () => {
    const dir = home();
    const { svc, runner } = service(dir, { ...JQ, 'winget list --id jqlang.jq': { code: 1 } });
    const p = await planOf(svc, 'winget', 'jqlang.jq');
    const job = await svc.execute(p.id, { gestureId: 'g-original' }).done;
    expect(job.failure?.cleanup).toEqual(['설치하다 남은 jq을(를) 지워요.', '받은 임시 파일을 지워요.']);
    const cleaned = await svc.cleanup(job.id);
    expect(cleaned.status).toBe('cleaned');
    expect(runner.calls.at(-1)!.line).toBe('winget uninstall --id jqlang.jq -e --silent');
    // 같은 승인 범위(같은 클릭 토큰 id)로 기록, 두 번은 못 한다
    const recs = svc.log.read();
    expect(recs.at(-1)).toMatchObject({ action: 'rollback', gestureId: 'g-original' });
    await expect(svc.cleanup(job.id)).rejects.toThrow('찾지 못했어요');
    // 성공한 작업은 정리 대상이 아님
    const { svc: ok } = service(home(), JQ);
    const j = await ok.execute((await planOf(ok, 'winget', 'jqlang.jq')).id, approval).done;
    await expect(ok.cleanup(j.id)).rejects.toThrow();
  });
});

describe('P2-E.5 installs.jsonl — 1건 = 1기록', () => {
  it('시각·계획 원문·승인 토큰 id·결과·출력 요약', async () => {
    const dir = home();
    const { svc } = service(dir, {
      ...JQ,
      'winget install --id jqlang.jq': { stdout: 'ok sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789' },
    });
    const p = await planOf(svc, 'winget', 'jqlang.jq');
    await svc.execute(p.id, { gestureId: 'g-123' }).done;
    const lines = readFileSync(join(dir, 'tools', 'installs.jsonl'), 'utf8')
      .trim()
      .split('\n');
    expect(lines.length).toBe(1);
    const rec = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(rec).toMatchObject({
      action: 'install',
      gestureId: 'g-123',
      result: { ok: true, status: 'installed' },
    });
    expect(typeof rec.ts).toBe('string');
    expect((rec.plan as InstallPlan).commands).toEqual(p.commands);
    expect(String(rec.output)).toContain('ok');
    expect(String(rec.output)).not.toContain('abcdefghijklmnopqrstuvwxyz0123456789');
    // 두 번째 작업 → 두 번째 줄
    await svc.execute(svc.uninstallPlan('winget:jqlang.jq').id, { gestureId: 'g-456' }).done;
    expect(
      readFileSync(join(dir, 'tools', 'installs.jsonl'), 'utf8')
        .trim()
        .split('\n').length,
    ).toBe(2);
  });
});

describe('P2-E.6 Windows PATH 문제: 절대 경로 저장·사용', () => {
  it('PATH 미갱신 상태에서도 실행 성공', async () => {
    const dir = home();
    const ABS = 'C:\\Users\\u\\AppData\\Local\\Microsoft\\WinGet\\Links\\jq.exe';
    const { svc, runner } = service(dir, (line) => {
      for (const [k, v] of Object.entries(JQ))
        if (line.startsWith(k) && !line.startsWith('powershell')) return v;
      // 레지스트리의 새 PATH로 찾는 PowerShell 스크립트일 때만 경로를 돌려준다
      if (line.startsWith('powershell.exe') && line.includes("GetEnvironmentVariable('Path','User')"))
        return { stdout: `${ABS}\r\n` };
      if (line === `${ABS} --version`) return { stdout: 'jq-1.7.1' };
      if (line.startsWith('jq ')) return undefined; // 현재 프로세스 PATH에는 아직 없음 → 실패
      return undefined;
    });
    const p = await planOf(svc, 'winget', 'jqlang.jq');
    await svc.execute(p.id, approval).done;
    const entry = svc.registry.get('winget:jqlang.jq')!;
    expect(entry.command).toBe(ABS);
    // 이름으로 실행하면 실패, 도구 목록의 절대 경로로 실행하면 성공
    expect((await runner({ file: 'jq', args: ['--version'], host: 'windows' })).code).not.toBe(0);
    const r = await runTool(runner, entry, ['--version']);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('jq-1.7.1');
    expect(runner.calls.at(-1)!.cmd).toMatchObject({ file: ABS, host: 'windows' });
  });
});

describe('P2-E.7 제거 E2E', () => {
  it('[지우기] → 제거 계획 → 승인(토큰 종류 uninstall) → uninstall → 도구 목록에서 삭제', async () => {
    const dir = home();
    const { svc, runner } = service(dir, JQ);
    const p = await planOf(svc, 'winget', 'jqlang.jq');
    await svc.execute(p.id, approval).done;
    expect(svc.tools().tools.map((t) => t.id)).toEqual(['winget:jqlang.jq']);
    const un = svc.uninstallPlan('winget:jqlang.jq');
    expect(un).toMatchObject({
      action: 'uninstall',
      toolId: 'winget:jqlang.jq',
      commands: ['winget uninstall --id jqlang.jq -e --silent'],
    });
    expect(svc.gestureKindFor(un.id)).toBe('uninstall');
    expect(un.changes.join(' ')).toContain('지워요');
    const job = await svc.execute(un.id, { gestureId: 'g-un' }).done;
    expect(job.status).toBe('removed');
    expect(svc.tools().tools).toEqual([]);
    expect(runner.calls.filter((c) => c.line.startsWith('winget uninstall')).length).toBe(1);
    expect(() => svc.uninstallPlan('winget:jqlang.jq')).toThrow('찾지 못했어요');
  });
});

describe('P2-E.8 업데이트 확인 (주 1회, 조회만)', () => {
  it('자동 업데이트 0건 — 업데이트도 계획(승인 필요)으로만', async () => {
    const dir = home();
    let now = new Date('2026-11-11T00:00:00Z');
    const show = (v: string) => ({ stdout: WINGET_SHOW_JQ.replace('Version: 1.7.1', `Version: ${v}`) });
    let latest = '1.7.1';
    const { svc, runner } = service(
      dir,
      (line) => {
        if (line.startsWith('winget show')) return show(latest);
        for (const [k, v] of Object.entries(JQ)) if (line.startsWith(k)) return v;
        return undefined;
      },
      { now: () => now },
    );
    await svc.execute((await planOf(svc, 'winget', 'jqlang.jq')).id, approval).done;
    latest = '1.8.0';
    const installsBefore = runner.calls.filter((c) => c.line.startsWith('winget install')).length;
    const r = await svc.checkUpdates();
    expect(r.skipped).toBe(false);
    expect(r.updates).toHaveLength(1);
    expect(r.updates[0]).toMatchObject({ action: 'update', toolId: 'winget:jqlang.jq', version: '1.8.0' });
    expect(r.updates[0]!.commands[0]).toContain('--version 1.8.0');
    expect(svc.gestureKindFor(r.updates[0]!.id)).toBe('update');
    // 조회만: 설치 명령은 늘지 않았다
    expect(runner.calls.filter((c) => c.line.startsWith('winget install')).length).toBe(installsBefore);
    expect(svc.registry.get('winget:jqlang.jq')!.version).toBe('1.7.1');
    // 주 1회: 3일 뒤 다시 부르면 건너뜀, 8일 뒤에는 다시 조회
    now = new Date('2026-11-14T00:00:00Z');
    expect((await svc.checkUpdates()).skipped).toBe(true);
    now = new Date('2026-11-19T00:00:00Z');
    expect((await svc.checkUpdates()).skipped).toBe(false);
    // 사람이 승인해야 업데이트된다
    const up = (await svc.checkUpdates({ force: true })).updates[0]!;
    const job = await svc.execute(up.id, { gestureId: 'g-up' }).done;
    expect(job.status).toBe('installed');
    expect(svc.registry.get('winget:jqlang.jq')!.version).toBe('1.8.0');
  });
});

describe('P2-E.9 기존 설치 가져오기 (사용자 확인 후)', () => {
  it('winget list · npm ls -g · ollama list · code --list-extensions → 고른 것만 "이미 있던 도구"로', async () => {
    const dir = home();
    const { svc } = service(dir, {
      'winget list --accept-source-agreements': {
        stdout:
          'Name   Id         Version Source\n-----------------------------------\nGit    Git.Git    2.47.0  winget\nFoo    ARP\\Foo    1.0\n',
      },
      'npm ls -g --depth=0 --json': {
        stdout: JSON.stringify({
          dependencies: { npm: { version: '10.8.2' }, prettier: { version: '3.3.3' } },
        }),
      },
      'ollama list': {
        stdout: 'NAME          ID      SIZE   MODIFIED\nqwen3:8b      abc     5.2 GB 2 days ago\n',
      },
      'code --list-extensions --show-versions': { stdout: 'fwcd.kotlin@0.2.36\n' },
    });
    const scan = await svc.importScan();
    expect(scan.candidates.map((c) => c.id).sort()).toEqual([
      'npm-cli:prettier',
      'ollama-model:qwen3:8b',
      'vscode-ext:fwcd.kotlin',
      'winget:Git.Git',
    ]);
    // 스캔만으로는 등록되지 않는다
    expect(svc.tools().tools).toEqual([]);
    const r = svc.importTools(['winget:Git.Git', 'ollama-model:qwen3:8b'], { gestureId: 'g-imp' });
    expect(r.imported.map((t) => [t.id, t.origin, t.version])).toEqual([
      ['winget:Git.Git', 'imported', '2.47.0'],
      ['ollama-model:qwen3:8b', 'imported', '8b'],
    ]);
    expect(svc.tools().tools.length).toBe(2);
    expect(
      svc.log
        .read()
        .filter((x) => x.action === 'import')
        .every((x) => x.gestureId === 'g-imp'),
    ).toBe(true);
    // 다시 스캔하면 이미 가져온 것은 빠진다
    expect((await svc.importScan()).candidates.map((c) => c.id)).not.toContain('winget:Git.Git');
  });
});
