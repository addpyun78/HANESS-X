import { readFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { HookBus } from '@harness-x/kernel';
import { installToolFirstRunGate } from '@harness-x/permission-gate';
import { allowedFile, installCli } from '../src/index.js';
import { WINGET_SHOW_JQ, service, tempHome } from './helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((f) => f()));
const home = () => {
  const h = tempHome();
  cleanups.push(h.cleanup);
  return h.dir;
};

const SEARCH_JQ =
  'Name            Id              Version Source\r\n--------------------------------------------\r\njq              jqlang.jq       1.7.1   winget\r\n';
const JQ = {
  'winget search jq': { stdout: SEARCH_JQ },
  'winget show --id jqlang.jq': { stdout: WINGET_SHOW_JQ },
  'winget install --id jqlang.jq': { stdout: 'Successfully installed' },
  'winget list --id jqlang.jq': { stdout: 'jq jqlang.jq 1.7.1' },
  'powershell.exe -NoProfile -Command': {
    stdout: 'C:\\Users\\u\\AppData\\Local\\Microsoft\\WinGet\\Links\\jq.exe',
  },
};

/** stdin에 줄들을 넣고 CLI 실행 → [종료 코드, 출력] */
async function run(argv: string[], svc: ReturnType<typeof service>['svc'], lines: string[] = []) {
  const input = new PassThrough();
  const output = new PassThrough();
  let text = '';
  output.on('data', (d: Buffer) => (text += d.toString()));
  for (const l of lines) input.write(l + '\n');
  input.end();
  const code = await installCli(argv, { input, output, service: svc });
  return { code, text };
}

const installs = (runner: ReturnType<typeof service>['runner']) =>
  runner.calls.filter((c) => c.line.startsWith('winget install'));

describe('P2-G.7 CLI 대체: harness-x install <이름|주소>, harness-x tools list (계획 표시 → y/n 승인)', () => {
  it('이름 → 찾기 → 계획을 글로 → n이면 설치 0건', async () => {
    const { svc, runner } = service(home(), JQ);
    const r = await run(['install', 'jq'], svc, ['n']);
    expect(r.code).toBe(1);
    expect(r.text).toContain('📦 설치해도 될까요?');
    expect(r.text).toContain('jq 1.7.1  [무료]');
    expect(r.text).toContain('사용 조건      누구나 무료로 쓸 수 있어요.');
    expect(r.text).toContain('실행할 명령    winget install --id jqlang.jq -e');
    expect(r.text).toContain('설치할까요? (y/n)');
    expect(r.text).toContain('취소했어요. 아무것도 설치하지 않았어요.');
    expect(installs(runner)).toHaveLength(0);
    expect(svc.tools().tools).toEqual([]);
  });

  it('y면 설치 → 도구 목록 등록 → tools list에 보임, 기록에는 CLI 승인 id', async () => {
    const dir = home();
    const { svc, runner } = service(dir, JQ);
    const r = await run(['install', 'jq'], svc, ['y']);
    expect(r.code).toBe(0);
    expect(installs(runner)).toHaveLength(1);
    expect(svc.tools().tools.map((t) => t.id)).toEqual(['winget:jqlang.jq']);
    const log = svc.history().records;
    expect(log).toHaveLength(1);
    expect(log[0]!.gestureId).toMatch(/^cli-/);
    const list = await run(['tools', 'list'], svc);
    expect(list.code).toBe(0);
    expect(list.text).toContain('도구 1개');
    expect(list.text).toContain('jq  [무료]  winget  1.7.1  winget:jqlang.jq');
  });

  it('주소(winget id·URL) → 해석 → 계획; 해석 실패는 쉬운 말 + 주소 열기 안내', async () => {
    const { svc, runner } = service(home(), JQ);
    const r = await run(['install', 'jqlang.jq'], svc, ['y']);
    expect(r.code).toBe(0);
    expect(installs(runner)).toHaveLength(1);
    const bad = await run(['install', 'https://example.com/page'], svc, ['y']);
    expect(bad.code).toBe(1);
    expect(bad.text).toContain('이 주소에서 설치 방법을 찾지 못했어요.');
    expect(bad.text).toContain('주소를 열어 직접 확인해 주세요: https://example.com/page');
    expect(installs(runner)).toHaveLength(1);
  });

  it('무료인지 모르는 계획은 "직접 확인했어요?"에 y가 있어야 다음 질문', async () => {
    const show = WINGET_SHOW_JQ.replace('License: MIT\n', '');
    const { svc, runner } = service(home(), { ...JQ, 'winget show --id jqlang.jq': { stdout: show } });
    const r = await run(['install', 'jqlang.jq'], svc, ['n']);
    expect(r.text).toContain('[무료인지 확인 못 했어요]');
    expect(r.text).toContain('무료인지 직접 확인했어요? (y/n)');
    expect(r.code).toBe(1);
    expect(installs(runner)).toHaveLength(0);
    // 입력이 끝나면(EOF) 승인 없음 = 설치 0건
    const eof = await run(['install', 'jqlang.jq'], svc, []);
    expect(eof.code).toBe(1);
    expect(installs(runner)).toHaveLength(0);
  });

  it('tools allow <id> → 첫 실행 확인 기억 파일 → permission-gate가 묻지 않음', async () => {
    const dir = home();
    const { svc } = service(dir, JQ);
    await run(['install', 'jq'], svc, ['y']);
    const a = await run(['tools', 'allow', 'winget:jqlang.jq'], svc);
    expect(a.code).toBe(0);
    expect(JSON.parse(readFileSync(allowedFile(dir), 'utf8'))).toEqual({
      version: 1,
      allowed: ['winget:jqlang.jq'],
    });
    const bus = new HookBus();
    const asks: string[] = [];
    installToolFirstRunGate(bus, {
      tools: () => svc.registry.list().map((t) => ({ id: t.id, name: t.name, command: t.command })),
      file: allowedFile(dir),
      ask: (q) => (asks.push(q.toolId), 'deny'),
    });
    expect(
      (await bus.runBlocking('tool.before', { tool: 'Bash', input: { command: 'jq .' } })).decision,
    ).toBe('allow');
    expect(asks).toEqual([]);
    expect((await run(['tools', 'allow', 'nope:x'], svc)).code).toBe(1);
  });
});
