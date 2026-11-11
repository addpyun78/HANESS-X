import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parsePipeline } from '@harness-x/protocol';
import { Dispatcher, type DispatchRunInput } from '@harness-x/kernel';
import type { InstallPlan, RunOptions } from '../src/index.js';
import { WINGET_SHOW_JQ, approval, service, tempHome } from './helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((f) => f()));
const home = () => {
  const h = tempHome();
  cleanups.push(h.cleanup);
  return h.dir;
};

async function planOf(svc: ReturnType<typeof service>['svc'], kind: string, id: string) {
  const p = await svc.plan({ kind, target: { id } });
  if ('unavailable' in p) throw new Error('unavailable');
  return p as InstallPlan;
}

describe('2A.5 설치 진행 중 정지 → 중단 가능한 지점에서 멈추고 정리', () => {
  it('설치 명령 실행 중: 프로세스 abort + 임시 폴더 정리, 대기 중 작업은 시작 안 함', async () => {
    const dir = home();
    let aborted = false;
    const body = Buffer.from('x'.repeat(10));
    const { svc, runner } = service(
      dir,
      (line) => {
        if (line.includes('Get-AuthenticodeSignature')) return { stdout: 'Valid' };
        if (line.includes('Start-Process'))
          return (_c, opts: RunOptions) =>
            new Promise((res) =>
              opts.signal?.addEventListener('abort', () => {
                aborted = true;
                res({ code: null, cancelled: true });
              }),
            );
        if (line.startsWith('wslpath')) return { stdout: 'C:\\x.exe' };
        return undefined;
      },
      { fetch: (async () => new Response(body)) as never },
    );
    const p1 = await planOf(svc, 'direct-download', 'https://example.com/setup.exe');
    const p2 = await planOf(svc, 'direct-download', 'https://example.com/other.exe');
    const j1 = svc.execute(p1.id, approval);
    const j2 = svc.execute(p2.id, approval);
    // 설치 화면(Start-Process) 단계까지 기다린다
    for (let i = 0; i < 100 && !runner.calls.some((c) => c.line.includes('Start-Process')); i++)
      await new Promise((r) => setTimeout(r, 10));
    const stopped = await svc.stopAll();
    expect(aborted).toBe(true);
    expect(stopped.map((j) => [j.id, j.status]).sort()).toEqual(
      [
        [j1.id, 'cancelled'],
        [j2.id, 'cancelled'],
      ].sort(),
    );
    expect(runner.calls.filter((c) => c.line.includes('Start-Process'))).toHaveLength(1);
    expect(existsSync(join(dir, 'tmp-downloads', p1.id))).toBe(false);
    expect(existsSync(join(dir, 'tmp-downloads', p2.id))).toBe(false);
    expect(await svc.stopAll()).toEqual([]); // 더 멈출 것 없음
  });

  it('설치 명령이 끝나 확인·등록 중이면 끝까지 마친다 (반쯤 등록 없음)', async () => {
    const dir = home();
    let releaseVerify!: () => void;
    const verifyGate = new Promise<void>((r) => (releaseVerify = r));
    let verifying = false;
    const { svc } = service(dir, (line) => {
      if (line.startsWith('winget show --id jqlang.jq')) return { stdout: WINGET_SHOW_JQ };
      if (line.startsWith('winget install --id jqlang.jq')) return { stdout: 'Successfully installed' };
      if (line.startsWith('winget list --id jqlang.jq'))
        return async () => {
          verifying = true;
          await verifyGate;
          return { stdout: 'jq jqlang.jq 1.7.1' };
        };
      if (line.startsWith('powershell.exe -NoProfile -Command'))
        return { stdout: 'C:\\Users\\u\\AppData\\Local\\Microsoft\\WinGet\\Links\\jq.exe' };
      return undefined;
    });
    const p = await planOf(svc, 'winget', 'jqlang.jq');
    const j = svc.execute(p.id, approval);
    for (let i = 0; i < 200 && !verifying; i++) await new Promise((r) => setTimeout(r, 10));
    expect(verifying).toBe(true);
    const stop = svc.stopAll();
    releaseVerify();
    const [done] = await stop;
    expect(done!.id).toBe(j.id);
    expect(done!.status).toBe('installed');
    expect(svc.registry.get('winget:jqlang.jq')).toBeDefined();
  });

  it('커널 전체 정지가 설치 정지 훅도 부른다', async () => {
    const d = new Dispatcher({
      resolve: () => ({
        name: 'a',
        command: '/a',
        displayName: 'A',
        pipeline: parsePipeline({ name: 'a', nodes: [{ id: 'n', type: 'role' }], edges: [] }),
      }),
      run: async (i: DispatchRunInput) => {
        await new Promise<void>((r) => i.signal.addEventListener('abort', () => r(), { once: true }));
        return { status: 'error' };
      },
    });
    let installStopped = 0;
    d.addStopAllHook(async () => {
      installStopped++;
    });
    d.dispatch({ agent: 'a', prompt: 'x' });
    const rs = await d.stopAll();
    expect(rs).toHaveLength(1);
    expect(installStopped).toBe(1);
  });
});
