import { afterEach, describe, expect, it } from 'vitest';
import {
  ChocoAdapter,
  CargoAdapter,
  GoAdapter,
  NpmAdapter,
  PythonCliAdapter,
  ScoopAdapter,
  WingetAdapter,
  kindAvailability,
  mockRunner,
  parseWingetShow,
  parseWingetTable,
  type AdapterContext,
  type InstallProgress,
} from '../src/index.js';
import { WINGET_SHOW_JQ, approval, service, table, tempHome } from './helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((f) => f()));

function ctx(replies: Parameters<typeof mockRunner>[0], t = table({ winget: {}, npm: { host: 'linux' } })) {
  const runner = mockRunner(replies);
  const c: AdapterContext = { runner, platform: 'wsl', detection: () => t };
  return { c, runner };
}

describe('P2-B.1 winget (기본)', () => {
  it('winget show 결과로 계획: 라이선스·약관 문구, 설치·제거 명령 원문', async () => {
    const { c, runner } = ctx({ 'winget show --id jqlang.jq': { stdout: WINGET_SHOW_JQ } });
    const a = new WingetAdapter(c);
    const p = await a.plan({ id: 'jqlang.jq' });
    expect(p).toMatchObject({
      kind: 'winget',
      name: 'jq',
      version: '1.7.1',
      target: 'jqlang.jq',
      host: 'windows',
    });
    expect(p.license).toEqual({ id: 'MIT', plain: '누구나 무료로 쓸 수 있어요.' });
    expect(p.pricing.tier).toBe('free');
    expect(p.risks.join(' ')).toContain('약관');
    expect(p.commands).toEqual([
      'winget install --id jqlang.jq -e --silent --accept-package-agreements --accept-source-agreements',
    ]);
    expect(p.uninstall.commands).toEqual(['winget uninstall --id jqlang.jq -e --silent']);
    expect(runner.calls[0]!.cmd.host).toBe('windows');
  });

  it('승인 후 실행 → 검증 → 등록, 제거는 winget uninstall --id (모킹)', async () => {
    const h = tempHome();
    cleanups.push(h.cleanup);
    const { svc, runner } = service(h.dir, {
      'winget show --id jqlang.jq': { stdout: WINGET_SHOW_JQ },
      'winget install --id jqlang.jq': { stdout: 'Successfully installed\r\n' },
      'winget list --id jqlang.jq': { stdout: 'Name Id Version\n---\njq jqlang.jq 1.7.1\n' },
      'powershell.exe -NoProfile -Command': {
        stdout: 'C:\\Users\\u\\AppData\\Local\\Microsoft\\WinGet\\Links\\jq.exe\r\n',
      },
      'winget uninstall --id jqlang.jq': { stdout: 'Successfully uninstalled\r\n' },
    });
    const plan = await svc.plan({ kind: 'winget', target: { id: 'jqlang.jq' } });
    if ('unavailable' in plan) throw new Error('unavailable');
    const job = await svc.execute(plan.id, approval).done;
    expect(job.status).toBe('installed');
    expect(svc.registry.get('winget:jqlang.jq')?.command).toBe(
      'C:\\Users\\u\\AppData\\Local\\Microsoft\\WinGet\\Links\\jq.exe',
    );
    const un = svc.uninstallPlan('winget:jqlang.jq');
    const j2 = await svc.execute(un.id, { gestureId: 'g2' }).done;
    expect(j2.status).toBe('removed');
    expect(runner.calls.map((x) => x.line)).toContain('winget uninstall --id jqlang.jq -e --silent');
    // 실제 설치 명령은 원문 그대로 1회만
    expect(runner.calls.filter((x) => x.line.startsWith('winget install')).length).toBe(1);
  });

  it('search/list 표 해석, 없는 패키지는 쉬운 말 오류', async () => {
    const rows = parseWingetTable(
      'Name            Id              Version Source\r\n--------------------------------------------\r\njq              jqlang.jq       1.7.1   winget\r\nGit             Git.Git         2.47.0  winget\r\n',
    );
    expect(rows).toEqual([
      { name: 'jq', id: 'jqlang.jq', version: '1.7.1', source: 'winget' },
      { name: 'Git', id: 'Git.Git', version: '2.47.0', source: 'winget' },
    ]);
    expect(parseWingetShow('No package found')).toBeUndefined();
    const { c } = ctx({});
    await expect(new WingetAdapter(c).plan({ id: 'nope.nope' })).rejects.toThrow('찾지 못했어요');
    await expect(new WingetAdapter(c).plan({ id: 'a & calc' })).rejects.toThrow('올바르지');
  });
});

describe('P2-B.2 scoop', () => {
  it('사용자 폴더 설치(관리자 불필요), scoop install/uninstall (모킹)', async () => {
    const t = table({ scoop: {} });
    const { c, runner } = ctx(
      {
        'scoop info ripgrep': {
          stdout:
            'Name        : ripgrep\nVersion     : 14.1.1\nWebsite     : https://github.com/BurntSushi/ripgrep\nLicense     : MIT\n',
        },
        'scoop install ripgrep': { stdout: 'ripgrep was installed successfully!' },
        'scoop prefix ripgrep': { stdout: 'C:\\Users\\u\\scoop\\apps\\ripgrep\\current' },
        'scoop uninstall ripgrep': { stdout: 'ripgrep was uninstalled.' },
      },
      t,
    );
    const a = new ScoopAdapter(c);
    expect(a.available().available).toBe(true);
    const p = await a.plan({ id: 'ripgrep' });
    expect(p).toMatchObject({ needsAdmin: false, version: '14.1.1', commands: ['scoop install ripgrep'] });
    expect(p.changes.join(' ')).toContain('관리자 권한은 필요 없어요');
    const log: InstallProgress[] = [];
    expect((await a.install(p, (x) => log.push(x))).ok).toBe(true);
    expect((await a.verify(p)).ok).toBe(true);
    const r = await a.uninstall({
      id: 'scoop:ripgrep',
      kind: 'scoop',
      name: 'ripgrep',
      version: '14.1.1',
      target: 'ripgrep',
    });
    expect(r).toMatchObject({ ok: true, status: 'removed' });
    expect(runner.calls.map((x) => x.line)).toEqual([
      'scoop info ripgrep',
      'scoop install ripgrep',
      'scoop prefix ripgrep',
      'scoop uninstall ripgrep',
    ]);
    expect(log.map((x) => x.data).join('')).toContain('$ scoop install ripgrep');
  });
});

describe('P2-B.3 npm 전역 CLI', () => {
  const view = (scripts?: Record<string, string>) => ({
    stdout: JSON.stringify({
      name: 'some-cli',
      version: '2.3.4',
      license: 'MIT',
      bin: { 'some-cli': 'bin/cli.js' },
      ...(scripts ? { scripts } : {}),
      dist: { unpackedSize: 2_097_152 },
    }),
  });
  it('버전 고정 npm i -g <pkg>@<ver>, 스크립트 없으면 경고 없음', async () => {
    const { c } = ctx({ 'npm view some-cli@latest --json': view({ test: 'vitest' }) });
    const p = await new NpmAdapter(c).plan({ id: 'some-cli' });
    expect(p.commands).toEqual(['npm i -g some-cli@2.3.4']);
    expect(p.host).toBe('linux');
    expect(p.sizeMB).toBe(2);
    expect(p.risks).toEqual([]);
    expect(NpmAdapter.hasScriptWarning(p)).toBe(false);
  });
  it('postinstall이 있으면 카드 경고 + --ignore-scripts 선택지', async () => {
    const { c } = ctx({ 'npm view some-cli@2.3.4 --json': view({ postinstall: 'node setup.js' }) });
    const a = new NpmAdapter(c);
    const p = await a.plan({ id: 'some-cli', version: '2.3.4' });
    expect(NpmAdapter.hasScriptWarning(p)).toBe(true);
    expect(p.risks[0]).toContain('postinstall');
    expect(p.commands[0]).not.toContain('--ignore-scripts');
    const p2 = await a.plan({ id: 'some-cli', version: '2.3.4', options: { ignoreScripts: true } });
    expect(p2.commands).toEqual(['npm i -g some-cli@2.3.4 --ignore-scripts']);
    expect(p2.risks[0]).toContain('끄고 설치해요');
  });
});

describe('P2-B.4 Python CLI: uv tool 우선, 없으면 pipx, 전역 pip 금지', () => {
  it('선택 로직', async () => {
    const both = new PythonCliAdapter(ctx({}, table({ uv: { host: 'linux' }, pipx: { host: 'linux' } })).c);
    expect((await both.plan({ id: 'ruff' })).commands).toEqual(['uv tool install ruff']);
    expect(both.uninstallCommands({ target: 'ruff' })).toEqual(['uv tool uninstall ruff']);
    const pipxOnly = new PythonCliAdapter(ctx({}, table({ pipx: { host: 'linux' } })).c);
    expect((await pipxOnly.plan({ id: 'yt-dlp', version: '2026.1.1' })).commands).toEqual([
      'pipx install yt-dlp==2026.1.1',
    ]);
    const winUv = new PythonCliAdapter(ctx({}, table({ uv: { host: 'windows' } })).c);
    expect((await winUv.plan({ id: 'ruff' })).host).toBe('windows');
    const none = new PythonCliAdapter(ctx({}, table({})).c);
    await expect(none.plan({ id: 'ruff' })).rejects.toThrow('uv');
    const av = kindAvailability('python-cli', table({ winget: {} }));
    expect(av.available).toBe(false);
    // 어떤 경우에도 pip install은 만들지 않는다
    for (const a of [both, pipxOnly, winUv])
      for (const cmd of (await a.plan({ id: 'ruff' })).commands) expect(cmd).not.toMatch(/\bpip3? install/);
  });
});

describe('P2-B.5 cargo / go install: 설치 도구가 있을 때만 후보', () => {
  it('감지 연동: 없으면 검색 후보에 없음, 있으면 나타남', async () => {
    const h = tempHome();
    cleanups.push(h.cleanup);
    const replies = { 'winget search ripgrep': { stdout: '' } };
    const without = service(h.dir, replies, { detection: table({ winget: {} }) }).svc;
    const r1 = await without.search('ripgrep');
    expect(r1.candidates.map((c) => c.kind)).not.toContain('cargo');
    const withCargo = service(h.dir, replies, {
      detection: table({ winget: {}, cargo: { host: 'windows' } }),
    }).svc;
    const r2 = await withCargo.search('ripgrep');
    expect(r2.candidates.map((c) => c.kind)).toContain('cargo');
    const withGo = service(h.dir, {}, { detection: table({ go: {} }) }).svc;
    expect((await withGo.search('github.com/junegunn/fzf')).candidates.map((c) => c.kind)).toEqual(['go']);
    expect((await without.search('github.com/junegunn/fzf')).candidates.map((c) => c.kind)).not.toContain(
      'go',
    );
    // 어댑터 직접 호출도 도구가 없으면 거부
    await expect(new CargoAdapter(ctx({}, table({})).c).plan({ id: 'ripgrep' })).rejects.toThrow('cargo');
    await expect(new GoAdapter(ctx({}, table({})).c).plan({ id: 'github.com/junegunn/fzf' })).rejects.toThrow(
      'go',
    );
    const cp = await new CargoAdapter(ctx({}, table({ cargo: {} })).c).plan({
      id: 'ripgrep',
      version: '14.1.1',
    });
    expect(cp.commands).toEqual(['cargo install ripgrep --locked --version 14.1.1']);
    const gp = await new GoAdapter(ctx({}, table({ go: {} })).c).plan({ id: 'github.com/junegunn/fzf' });
    expect(gp.commands).toEqual(['go install github.com/junegunn/fzf@latest']);
  });
});

describe('P2-B.15 choco: 기본 꺼짐', () => {
  it('기본 비활성, 설정에서 켤 때만', async () => {
    const t = table({ choco: {} });
    const off = new ChocoAdapter({ runner: mockRunner({}), platform: 'wsl', detection: () => t });
    expect(off.available().available).toBe(false);
    expect(kindAvailability('choco', t).available).toBe(false);
    await expect(off.plan({ id: 'git' })).rejects.toThrow('꺼져 있어요');
    const on = new ChocoAdapter({
      runner: mockRunner({}),
      platform: 'wsl',
      detection: () => t,
      settings: { chocoEnabled: true },
    });
    expect(on.available().available).toBe(true);
    const p = await on.plan({ id: 'git' });
    expect(p).toMatchObject({ needsAdmin: true, commands: ['choco install git -y'] });
    // 서비스 기본값도 꺼짐
    const h = tempHome();
    cleanups.push(h.cleanup);
    const svc = service(h.dir, {}, { detection: t }).svc;
    expect(await svc.plan({ kind: 'choco', target: { id: 'git' } })).toMatchObject({ unavailable: true });
  });
});
