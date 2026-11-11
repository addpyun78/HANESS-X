import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DockerImageAdapter,
  OllamaModelAdapter,
  VscodeExtAdapter,
  WslAptAdapter,
  mockRunner,
  type AdapterContext,
} from '../src/index.js';
import { service, table, tempHome } from './helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((f) => f()));

const t = table({ ollama: { host: 'linux' }, code: {}, docker: { host: 'linux' }, wsl: {} });

describe('P2-B.6 Ollama 모델', () => {
  it('크기 확인, 디스크 여유 < 크기×1.2 이면 설치 차단 + 쉬운 말 안내 (모킹)', async () => {
    const runner = mockRunner({ 'ollama show qwen3:8b': { code: 1, stderr: 'model not found' } });
    const c: AdapterContext = {
      runner,
      platform: 'wsl',
      detection: () => t,
      diskFreeMB: async () => 5_000, // 4.9GB 여유
      fetch: (async () =>
        new Response(JSON.stringify({ layers: [{ size: 5_000 * 1048576 }, { size: 1048576 }] }), {
          status: 200,
        })) as typeof fetch,
    };
    const a = new OllamaModelAdapter(c);
    await expect(a.plan({ id: 'qwen3:8b' })).rejects.toThrow(/저장 공간이 부족해요.*GB/);
    expect(runner.calls.some((x) => x.line.startsWith('ollama pull'))).toBe(false);
    // 여유가 충분하면 pull 계획
    const ok = new OllamaModelAdapter({ ...c, diskFreeMB: async () => 50_000 });
    const p = await ok.plan({ id: 'qwen3:8b' });
    expect(p).toMatchObject({ sizeMB: 5001, commands: ['ollama pull qwen3:8b'], pricing: { tier: 'free' } });
    expect(ok.uninstallCommands({ target: 'qwen3:8b' })).toEqual(['ollama rm qwen3:8b']);
    // 계획 뒤 디스크가 줄었으면 실행 직전에도 막는다
    let free = 50_000;
    const late = new OllamaModelAdapter({ ...c, diskFreeMB: async () => free });
    const p2 = await late.plan({ id: 'qwen3:8b' });
    free = 1_000;
    await expect(late.install(p2, () => {})).rejects.toThrow('저장 공간');
  });
  it('ollama show 출력의 크기도 읽는다', async () => {
    const runner = mockRunner({ 'ollama show llama3.2': { stdout: '  Model\n    size    2.0 GB\n' } });
    const a = new OllamaModelAdapter({
      runner,
      platform: 'wsl',
      detection: () => t,
      diskFreeMB: async () => 2_000,
    });
    await expect(a.plan({ id: 'llama3.2' })).rejects.toThrow('저장 공간');
  });
});

describe('P2-B.10 VS Code 확장', () => {
  it('code --install-extension / --uninstall-extension (모킹)', async () => {
    const runner = mockRunner({
      'code --install-extension dbaeumer.vscode-eslint': { stdout: 'Extension was successfully installed.' },
      'code --list-extensions': { stdout: 'dbaeumer.vscode-eslint\nfwcd.kotlin\n' },
      'code --uninstall-extension dbaeumer.vscode-eslint': { stdout: 'uninstalled' },
    });
    const a = new VscodeExtAdapter({ runner, platform: 'wsl', detection: () => t });
    const p = await a.plan({ id: 'dbaeumer.vscode-eslint' });
    expect(p.commands).toEqual(['code --install-extension dbaeumer.vscode-eslint']);
    expect(p.host).toBe('windows');
    expect((await a.install(p, () => {})).ok).toBe(true);
    expect((await a.verify(p)).ok).toBe(true);
    const r = await a.uninstall({
      id: 'vscode-ext:dbaeumer.vscode-eslint',
      kind: 'vscode-ext',
      name: 'ESLint',
      version: '',
      target: 'dbaeumer.vscode-eslint',
    });
    expect(r.status).toBe('removed');
    expect(runner.calls.at(-1)!.line).toBe('code --uninstall-extension dbaeumer.vscode-eslint');
    expect(runner.calls.at(-1)!.cmd.host).toBe('windows');
  });
});

describe('P2-B.11 Docker 이미지', () => {
  it('docker pull / docker rmi, 크기 표시 (모킹)', async () => {
    const manifest = JSON.stringify({
      config: { size: 7000 },
      layers: [{ size: 30 * 1048576 }, { size: 20 * 1048576 }],
    });
    const runner = mockRunner({
      'docker manifest inspect postgres:17': { stdout: manifest },
      'docker pull postgres:17': { stdout: 'Status: Downloaded newer image for postgres:17' },
      'docker image inspect postgres:17': { stdout: 'sha256:abc' },
      'docker rmi postgres:17': { stdout: 'Untagged: postgres:17' },
    });
    const a = new DockerImageAdapter({ runner, platform: 'wsl', detection: () => t });
    const p = await a.plan({ id: 'postgres', version: '17' });
    expect(p).toMatchObject({
      sizeMB: 50,
      commands: ['docker pull postgres:17'],
      source: { verified: true },
    });
    expect((await a.install(p, () => {})).ok).toBe(true);
    expect((await a.verify(p)).ok).toBe(true);
    expect(a.uninstallCommands({ target: 'postgres:17' })).toEqual(['docker rmi postgres:17']);
    await a.uninstall({
      id: 'docker-image:postgres:17',
      kind: 'docker-image',
      name: 'postgres:17',
      version: '17',
      target: 'postgres:17',
    });
    expect(runner.calls.at(-1)!.line).toBe('docker rmi postgres:17');
  });
});

describe('P2-B.12 WSL apt: 비밀번호는 사용자가 터미널에서 직접', () => {
  it('카드에 "관리자 비밀번호가 필요해요", 하네스는 sudo를 실행하지 않음 → 비밀번호가 로그·이벤트에 없음', async () => {
    const h = tempHome();
    cleanups.push(h.cleanup);
    const events: unknown[] = [];
    const PASSWORD = 'hunter2-super-secret';
    const { svc, runner } = service(
      h.dir,
      {
        'dpkg -s build-essential': { stdout: 'Package: build-essential\nStatus: install ok installed\n' },
        'sh -lc': { stdout: '' },
      },
      { detection: t, events: { append: (e) => events.push(e) } },
    );
    const outputs: string[] = [];
    svc.onOutput((e) => outputs.push(e.data));
    const plan = await svc.plan({ kind: 'wsl-apt', target: { id: 'build-essential' } });
    if ('unavailable' in plan) throw new Error();
    expect(plan.changes).toContain('관리자 비밀번호가 필요해요.');
    expect(plan).toMatchObject({ interactive: true, needsAdmin: true });
    const job = await svc.execute(plan.id, { gestureId: 'g1' }).done;
    expect(job.status).toBe('waiting-user');
    expect(outputs.join('')).toContain('sudo apt-get install -y build-essential');
    // 사용자가 터미널 패널(하네스 밖 pty)에 비밀번호를 직접 입력했다고 가정 → 하네스는 받지 않는다
    const done = await svc.confirmUserStep(job.id);
    expect(done.status).toBe('installed');
    // 하네스가 실행한 명령에 sudo 없음, 표준 입력으로 비밀번호를 넘기는 경로도 없음
    expect(runner.calls.some((c) => /sudo/.test(c.line))).toBe(false);
    const logText = readFileSync(join(h.dir, 'tools', 'installs.jsonl'), 'utf8');
    const all = [
      logText,
      JSON.stringify(events),
      outputs.join(''),
      readFileSync(svc.registry.file, 'utf8'),
    ].join('\n');
    expect(all).not.toContain(PASSWORD);
    expect(all).not.toMatch(/password\s*[:=]/i);
    const a = new WslAptAdapter({ runner: mockRunner({}), platform: 'wsl', detection: () => t });
    expect(
      (await a.uninstall({ id: 'wsl-apt:x', kind: 'wsl-apt', name: 'x', version: '', target: 'x' })).status,
    ).toBe('needs-user');
  });
});
