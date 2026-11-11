import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  INSTALL_KINDS,
  InstallKindSchema,
  InstallPlanSchema,
  bootstrapPlan,
  detectTools,
  kindAvailability,
  makePlan,
  mockRunner,
  parseCommand,
  toNativeCommand,
  type InstallKind,
  type InstallPlan,
  type InstallerAdapter,
  type InstallOutcome,
  type InstalledRecord,
  type InstallTarget,
  type ProgressFn,
  type VerifyOutcome,
} from '../src/index.js';
import type { KindAvailability } from '../src/detect.js';
import { table } from './helpers.js';

describe('P2-A.2 InstallKind 열거', () => {
  it('17종이 정확히 정의된다', () => {
    expect([...INSTALL_KINDS]).toEqual([
      'winget',
      'scoop',
      'choco',
      'npm-cli',
      'python-cli',
      'cargo',
      'go',
      'ollama-model',
      'mcp-local',
      'mcp-remote',
      'harness-plugin',
      'skill',
      'vscode-ext',
      'docker-image',
      'wsl-apt',
      'direct-download',
      'api-service',
    ]);
    expectTypeOf<InstallKind>().toEqualTypeOf<(typeof INSTALL_KINDS)[number]>();
    expectTypeOf<'winget'>().toMatchTypeOf<InstallKind>();
    expectTypeOf<'pip'>().not.toMatchTypeOf<InstallKind>();
    expect(InstallKindSchema.safeParse('pip').success).toBe(false);
  });
});

const VALID = {
  id: 'plan_1',
  kind: 'winget',
  name: 'jq',
  version: '1.7.1',
  source: { url: 'https://jqlang.github.io/jq', publisher: 'jqlang', verified: true },
  pricing: { tier: 'free', note: '무료예요.', checkedAt: '2026-11-11T00:00:00.000Z', sourceUrl: 'https://x' },
  license: { id: 'MIT', plain: '누구나 무료로 쓸 수 있어요.' },
  sizeMB: 1,
  etaSec: 30,
  needsAdmin: false,
  needsRestart: false,
  changes: ['jq를 설치해요.'],
  risks: [],
  commands: [
    'winget install --id jqlang.jq -e --silent --accept-package-agreements --accept-source-agreements',
  ],
  uninstall: { commands: ['winget uninstall --id jqlang.jq -e --silent'] },
  verify: { cmd: 'winget list --id jqlang.jq -e', expect: 'jqlang.jq' },
  target: 'jqlang.jq',
};

describe('P2-A.3 InstallPlan 스키마 (Zod)', () => {
  it('A.3 필드를 모두 받는다 + 기본값(host·action·interactive)', () => {
    const p = InstallPlanSchema.parse(VALID);
    expect(p.action).toBe('install');
    expect(p.host).toBe('windows');
    expect(p.interactive).toBe(false);
    for (const k of [
      'id',
      'kind',
      'name',
      'version',
      'source',
      'pricing',
      'license',
      'sizeMB',
      'etaSec',
      'needsAdmin',
      'needsRestart',
      'changes',
      'risks',
      'commands',
      'uninstall',
      'verify',
    ])
      expect(p).toHaveProperty(k);
  });
  it('pricing.tier는 free|freemium|paid|trial|unknown만', () => {
    for (const tier of ['free', 'freemium', 'paid', 'trial', 'unknown'])
      expect(InstallPlanSchema.safeParse({ ...VALID, pricing: { ...VALID.pricing, tier } }).success).toBe(
        true,
      );
    expect(
      InstallPlanSchema.safeParse({ ...VALID, pricing: { ...VALID.pricing, tier: 'cheap' } }).success,
    ).toBe(false);
  });
  it('필수 필드 누락·모르는 필드 거부', () => {
    const { pricing: _p, ...noPricing } = VALID;
    void _p;
    expect(InstallPlanSchema.safeParse(noPricing).success).toBe(false);
    expect(InstallPlanSchema.safeParse({ ...VALID, extra: 1 }).success).toBe(false);
    expect(InstallPlanSchema.safeParse({ ...VALID, changes: [''] }).success).toBe(false);
  });
  it('makePlan은 무료 여부를 모르면 unknown으로 채운다', () => {
    const p = makePlan({
      kind: 'npm-cli',
      name: 'x',
      version: '1',
      target: 'x',
      source: { url: '', publisher: '', verified: false },
      needsAdmin: false,
      changes: ['x'],
      risks: [],
      commands: [],
      uninstall: { commands: [] },
      verify: { cmd: '', expect: '' },
    });
    expect(p.pricing.tier).toBe('unknown');
    expect(p.license.id).toBe('unknown');
  });
  it('원문 명령 ↔ argv (셸 해석 없음)', () => {
    expect(parseCommand('winget install --id "Git.Git" -e')).toEqual([
      'winget',
      'install',
      '--id',
      'Git.Git',
      '-e',
    ]);
    expect(parseCommand('a "b c" ""')).toEqual(['a', 'b c', '']);
  });
});

describe('P2-A.4 InstallerAdapter 인터페이스 (타입)', () => {
  it('kind·available·plan·install·verify·uninstall', () => {
    expectTypeOf<InstallerAdapter['kind']>().toEqualTypeOf<InstallKind>();
    expectTypeOf<InstallerAdapter['available']>().returns.toEqualTypeOf<
      KindAvailability | Promise<KindAvailability>
    >();
    expectTypeOf<InstallerAdapter['plan']>().parameters.toEqualTypeOf<[InstallTarget]>();
    expectTypeOf<InstallerAdapter['plan']>().returns.toEqualTypeOf<Promise<InstallPlan>>();
    expectTypeOf<InstallerAdapter['install']>().parameter(0).toEqualTypeOf<InstallPlan>();
    expectTypeOf<InstallerAdapter['install']>().parameter(1).toEqualTypeOf<ProgressFn>();
    expectTypeOf<InstallerAdapter['install']>().returns.toEqualTypeOf<Promise<InstallOutcome>>();
    expectTypeOf<InstallerAdapter['verify']>().returns.toEqualTypeOf<Promise<VerifyOutcome>>();
    expectTypeOf<InstallerAdapter['uninstall']>().parameter(0).toEqualTypeOf<InstalledRecord>();
    // 최소 구현이 인터페이스를 만족
    const a: InstallerAdapter = {
      kind: 'skill',
      available: () => ({ available: true }),
      plan: async () => InstallPlanSchema.parse(VALID),
      install: async () => ({ ok: true, status: 'installed', message: '', output: '' }),
      verify: async () => ({ ok: true, output: '' }),
      uninstall: async () => ({ ok: true, status: 'removed', message: '', output: '' }),
    };
    expect(a.kind).toBe('skill');
  });
});

describe('P2-A.5 설치 도구 감지기 (모킹 감지 표)', () => {
  it('WSL: Windows 도구는 cmd.exe /c where, 리눅스 도구는 which + 버전', async () => {
    const runner = mockRunner((line, cmd) => {
      if (line === 'where winget')
        return { stdout: 'C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps\\winget.exe\r\n' };
      if (line === 'winget --version') return { stdout: 'v1.29.380\r\n' };
      if (line === 'which npm' && cmd.host === 'linux') return { stdout: '/usr/bin/npm\n' };
      if (line === 'npm --version') return { stdout: '10.8.2\n' };
      if (line === 'which code')
        return { stdout: '/mnt/c/Users/u/AppData/Local/Programs/Microsoft VS Code/bin/code\n' };
      if (line === 'where code')
        return { stdout: 'C:\\Users\\u\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd\r\n' };
      if (line === 'code --version') return { stdout: '1.141.1\nabc\nx64\n' };
      if (line === 'where go') return { stdout: 'C:\\Program Files\\Go\\bin\\go.exe\r\n' };
      if (line === 'go version') return { stdout: 'go version go1.26.1 windows/amd64\r\n' };
      return undefined; // 없음
    });
    const t = await detectTools({ runner, platform: 'wsl' });
    expect(t.winget).toMatchObject({ available: true, host: 'windows', version: '1.29.380' });
    expect(t.npm).toMatchObject({ available: true, host: 'linux', path: '/usr/bin/npm', version: '10.8.2' });
    expect(t.code).toMatchObject({ available: true, host: 'windows', version: '1.141.1' });
    expect(t.go).toMatchObject({ available: true, host: 'windows', version: '1.26.1' });
    expect(t.scoop.available).toBe(false);
    expect(t.choco.available).toBe(false);
    // 버전 확인은 버전 플래그만
    expect(runner.calls.every((c) => /^(where|which) |--version$|^go version$/.test(c.line))).toBe(true);
  });

  it('없으면 어댑터 unavailable + 그 설치 도구를 먼저 설치하는 계획 제안', () => {
    const t = table({ winget: {} });
    const npm = kindAvailability('npm-cli', t);
    expect(npm.available).toBe(false);
    if (npm.available) throw new Error();
    expect(npm.missing).toEqual(['npm']);
    expect(npm.bootstrap?.commands[0]).toContain('winget install --id OpenJS.NodeJS.LTS');
    expect(npm.bootstrap?.kind).toBe('winget');
    const py = kindAvailability('python-cli', t);
    expect(py.available).toBe(false);
    if (!py.available) expect(py.bootstrap?.target).toBe('astral-sh.uv');
    // winget도 없으면 제안할 계획이 없다
    expect(bootstrapPlan('npm', table({}))).toBeUndefined();
    expect(kindAvailability('winget', t).available).toBe(true);
    expect(kindAvailability('api-service', table({})).available).toBe(true);
  });

  it('WSL에서 Windows 명령은 cmd.exe /c, powershell.exe는 직접', () => {
    expect(toNativeCommand({ file: 'winget', args: ['list'], host: 'windows' }, 'wsl')).toEqual({
      file: 'cmd.exe',
      args: ['/c', 'winget', 'list'],
    });
    expect(toNativeCommand({ file: 'powershell.exe', args: ['-c', 'x'], host: 'windows' }, 'wsl').file).toBe(
      'powershell.exe',
    );
    expect(toNativeCommand({ file: 'npm', args: ['-v'], host: 'linux' }, 'windows')).toEqual({
      file: 'wsl.exe',
      args: ['-e', 'npm', '-v'],
    });
    expect(() => toNativeCommand({ file: 'winget', args: [], host: 'windows' }, 'posix')).toThrow();
  });
});
