import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

/**
 * T-100 Part 1 실제 앱 연결 — `harness-x serve`가
 *   ① 시작 시 1회 예전 판정 설정을 judge.*로 옮기고(cleanupLegacyVerifier, J.6 연결)
 *   ② judge 체인(설정 + engine-scanner 감지 + 로그인 상태) · 승인 카드 저장소로 비교 파이프라인을 만들고
 *   ③ GET /api/notices · POST /api/compare 를 연다
 * 실제 엔진·네트워크 호출을 막는다: PATH를 빈 폴더로(엔진 감지 0), Ollama 주소는 꺼진 포트(HARNESS_X_OLLAMA_URL).
 */

const repo = fileURLToPath(new URL('../../..', import.meta.url));
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

interface Boot {
  url: string;
  token: string;
  home: string;
  ws: string;
  child: ChildProcess;
  stderr: () => string;
}

const roots: string[] = [];
let child: ChildProcess | undefined;
afterEach(() => {
  child?.kill('SIGTERM');
  child = undefined;
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

async function boot(settings?: unknown): Promise<Boot> {
  const root = mkdtempSync(join(tmpdir(), 'hx-cli-judge-'));
  roots.push(root);
  const home = join(root, 'home');
  const ws = join(root, 'ws');
  const emptyPath = join(root, 'empty-path');
  for (const d of [home, ws, emptyPath]) mkdirSync(d, { recursive: true });
  if (settings !== undefined) writeFileSync(join(home, 'settings.json'), JSON.stringify(settings));
  const c = spawn(
    process.execPath,
    ['--no-warnings', cli, 'serve', '--port', '0', '--workspace', ws, '--no-watch'],
    {
      env: {
        HARNESS_X_HOME: home,
        HOME: root,
        PATH: emptyPath,
        HARNESS_X_OLLAMA_URL: 'http://127.0.0.1:9',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child = c;
  let err = '';
  c.stderr!.on('data', (d) => (err += d));
  const info = await new Promise<{ url: string; tokenFile: string }>((res, rej) => {
    let buf = '';
    c.stdout!.on('data', (d) => {
      buf += d;
      const line = buf.split('\n').find((l) => l.includes('"listening"'));
      if (line) res(JSON.parse(line));
    });
    c.on('exit', (code) => rej(new Error(`exit ${code}: ${err}`)));
    setTimeout(() => rej(new Error('timeout: ' + err)), 170_000);
  });
  return {
    url: info.url,
    token: readFileSync(info.tokenFile, 'utf8').trim(),
    home,
    ws,
    child: c,
    stderr: () => err,
  };
}

const call = async (b: Boot, method: string, path: string, body?: unknown) => {
  const res = await fetch(b.url + path, {
    method,
    headers: { authorization: `Bearer ${b.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

describe('harness-x serve — 판정 연결 (T-100 Part 1)', () => {
  beforeAll(async () => {
    // 커널 + 판정 사다리(+ judge·approvals·comparators) dist — 비동기로 빌드해 vitest 작업자를 막지 않는다
    await promisify(execFile)(
      'pnpm',
      ['--filter', '@harness-x/verifier-ladder...', '--filter', '@harness-x/kernel', 'build'],
      { cwd: repo },
    );
  }, 600_000);

  it('깨끗한 환경(설정·예전 키 없음): 안내 없음 → 비교는 정규화로 통과, 판정 AI가 없으면 승인 카드', async () => {
    const b = await boot();
    expect(existsSync(join(b.home, 'settings.json'))).toBe(false);
    expect(await call(b, 'GET', '/api/notices')).toEqual({ status: 200, body: { notices: [] } });

    const same = await call(b, 'POST', '/api/compare', {
      sessionId: 's1',
      itemId: '1',
      kind: 'number',
      expected: '1,000',
      actual: '1000',
    });
    expect(same.body).toMatchObject({ status: 'pass', outcome: { level: 'normalize' } });

    const wrong = await call(b, 'POST', '/api/compare', {
      sessionId: 's1',
      itemId: '1',
      expected: 'success',
      actual: 'error',
    });
    expect(wrong.body).toMatchObject({ status: 'fail' });

    const ask = await call(b, 'POST', '/api/compare', {
      sessionId: 's1',
      itemId: '1',
      kind: 'text',
      expected: '완료',
      actual: '작업이 끝났습니다',
    });
    expect(ask.body).toMatchObject({
      status: 'awaiting',
      judge: { verdict: 'unavailable', reason: 'no-judge' },
      card: { kind: 'no-judge', whyAsking: '판정해 줄 AI가 연결돼 있지 않아요.' },
    });
    // 같은 승인 카드 저장소 → GET /api/approvals 에 보인다
    const pending = await call(b, 'GET', '/api/approvals?status=pending');
    expect((pending.body.approvals as { card: { kind: string } }[]).map((a) => a.card.kind)).toEqual([
      'no-judge',
    ]);
    expect((await call(b, 'POST', '/api/compare', { sessionId: 's1' })).status).toBe(400);
  }, 240_000);

  it('예전 설정 verifier.l4 = off → 시작 때 judge.semantic = off로 옮겨 쓰고, 비교는 카드 없이 실패', async () => {
    const b = await boot({ verifier: { l4: 'off' } });
    expect(JSON.parse(readFileSync(join(b.home, 'settings.json'), 'utf8'))).toEqual({
      judge: { semantic: 'off' },
    });
    expect(b.stderr()).toContain('예전 판정 설정을 judge.*로 옮겼습니다');
    const r = await call(b, 'POST', '/api/compare', {
      sessionId: 's2',
      itemId: '1',
      kind: 'text',
      expected: '완료',
      actual: '작업이 끝났습니다',
    });
    expect(r.body).toMatchObject({ status: 'fail', outcome: { verdict: 'different' } });
    const pending = await call(b, 'GET', '/api/approvals?status=pending');
    expect(pending.body.approvals).toEqual([]);
  }, 240_000);
});
