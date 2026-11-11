import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { workspaceApprovals } from '@harness-x/approvals';
import { ChecklistLedger } from '@harness-x/checklist-ledger';
import { EventLog, SecretStore, listLockEntries, memoryBackend, removeLockEntries } from '@harness-x/kernel';
import { afterEach, describe, expect, it } from 'vitest';
import { RETIRED_CONFIG_LABEL, retiredName } from '../../../../../tests/helpers/retired-names.js';
import { RETIRED_JUDGE_KEY_NOTICE } from '../src/cleanup.js';
import {
  judgeEnginesFrom,
  registerJudgeRoutes,
  startJudgeRuntime,
  type JudgeRuntimeOptions,
} from '../src/runtime.js';
import { scriptedBackend, YES } from './judge-fakes.js';

/**
 * T-100 Part 1 실제 앱 연결 (커널 serve가 부르는 startJudgeRuntime)
 *   - 시작 시 1회 cleanupLegacyVerifier: 설정 옮기기 + 키체인 정리 + plugins.lock 정리 + 안내 1회
 *   - judge.* 설정 → judge 체인 (engine-scanner 감지 + 로그인 상태)
 *   - 세션 승인 카드 저장소 + 사전으로 비교 파이프라인
 */

const name = retiredName(RETIRED_CONFIG_LABEL);
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function env() {
  const root = mkdtempSync(join(tmpdir(), 'hx-judge-rt-'));
  dirs.push(root);
  const home = join(root, 'home');
  const ws = join(root, 'ws');
  mkdirSync(home, { recursive: true });
  mkdirSync(ws, { recursive: true });
  const secrets = new SecretStore(memoryBackend());
  const log = new EventLog({ root: join(home, 'logs') });
  const approvals = workspaceApprovals(ws, { remindDelaysMs: [] });
  return { root, home, ws, secrets, log, approvals };
}

type Env = ReturnType<typeof env>;

function start(e: Env, judge: Partial<JudgeRuntimeOptions['judge']> = {}) {
  return startJudgeRuntime({
    home: e.home,
    workspace: e.ws,
    log: e.log,
    secrets: e.secrets,
    removeLockEntries: (ids) => removeLockEntries(join(e.home, 'plugins.lock'), ids),
    approvals: () => e.approvals,
    judge: {
      listEngines: () => [],
      probeOllama: async () => ({ running: false, models: [] }),
      ...judge,
    },
  });
}

describe('판정 실행 환경 — 시작 시 정리 1회 (J.6 연결)', () => {
  it('예전 판정 설정·키가 있으면: 설정 파일 옮겨 쓰기 · 키 삭제 · lock 정리 · 안내 1회 (재시작하면 안내 없음)', () => {
    const e = env();
    writeFileSync(
      join(e.home, 'settings.json'),
      JSON.stringify({ verifier: { l4: name, [name]: { endpoint: 'https://example.invalid' } } }),
    );
    writeFileSync(
      join(e.home, 'plugins.lock'),
      JSON.stringify({
        lockfileVersion: 1,
        plugins: [
          { id: 'hello', version: '0.1.0', sha256: 'b'.repeat(64) },
          { id: `verifier-${name}`, version: '0.1.0', sha256: 'a'.repeat(64) },
        ],
      }),
    );
    e.secrets.set(`verifier:${name}`, 'old-key');
    e.secrets.setApiKey('codex', 'keep-me');

    const rt = start(e);
    expect(JSON.parse(readFileSync(join(e.home, 'settings.json'), 'utf8'))).toEqual({
      judge: { engine: '' },
    });
    expect(e.secrets.get(`verifier:${name}`)).toBeNull();
    expect(e.secrets.getApiKey('codex')).toBe('keep-me');
    expect(listLockEntries(join(e.home, 'plugins.lock')).map((x) => x.id)).toEqual(['hello']);
    expect(rt.notices()).toEqual([
      expect.objectContaining({ type: 'notice', message: RETIRED_JUDGE_KEY_NOTICE }),
    ]);
    expect(rt.settings).toMatchObject({ engine: '', semantic: 'on', samples: 3 });

    const again = start(e);
    expect(again.cleanup.migration.migrated).toBe(false);
    expect(again.notices()).toEqual([]);
    e.log.close();
  });

  it('깨끗한 환경(설정·키 없음): 정리할 것 없음, 기본 judge 설정, 설정 파일을 만들지 않음', () => {
    const e = env();
    const rt = start(e);
    expect(rt.cleanup).toMatchObject({ deleted: [], lockRemoved: [], migration: { migrated: false } });
    expect(rt.notices()).toEqual([]);
    expect(rt.settings).toMatchObject({ engine: '', semantic: 'on', samples: 3, maxCallsPerSession: 50 });
    expect(rt.settingsError).toBeUndefined();
    expect(existsSync(join(e.home, 'settings.json'))).toBe(false);
    e.log.close();
  });

  it('verifier.l4 = off → judge.semantic off로 옮기고, 그 뒤 비교는 의미 판단·카드 없이 실패', async () => {
    const e = env();
    writeFileSync(join(e.home, 'settings.json'), JSON.stringify({ verifier: { l4: 'off' } }));
    const rt = start(e);
    expect(JSON.parse(readFileSync(join(e.home, 'settings.json'), 'utf8'))).toEqual({
      judge: { semantic: 'off' },
    });
    const r = await rt.compare({
      sessionId: 's1',
      itemId: '1',
      kind: 'text',
      expected: '완료',
      actual: '끝',
    });
    expect(r).toMatchObject({ status: 'fail', outcome: { verdict: 'different' } });
    expect(e.approvals.list()).toEqual([]);
    e.log.close();
  });
});

describe('판정 실행 환경 — 비교 파이프라인 연결', () => {
  it('판정 AI 없음 → 세션 승인 카드(no-judge), 항목은 그대로', async () => {
    const e = env();
    const rt = start(e);
    const r = await rt.compare({
      sessionId: 's1',
      itemId: '1',
      kind: 'text',
      expected: '완료',
      actual: '끝났어요',
    });
    expect(r).toMatchObject({
      status: 'awaiting',
      recorded: false,
      card: { kind: 'no-judge', sessionId: 's1' },
    });
    expect(e.approvals.list().map((c) => c.card.kind)).toEqual(['no-judge']);
    e.log.close();
  });

  it('감지·로그인된 구독 엔진이 판정 → 통과, 체크리스트 항목에 비교 증거 + ai_judged', async () => {
    const e = env();
    const dir = join(e.ws, '.harness-x', 'sessions', 's2');
    const ledger = new ChecklistLedger({ dir, sessionId: 's2' });
    ledger.create([
      { id: '1', title: '완료 문구', artifactId: 'art.done', acceptance: [{ type: 'file_exists' }] },
    ]);
    const backend = scriptedBackend([YES], { engineId: 'codex' });
    const rt = start(e, {
      listEngines: () =>
        judgeEnginesFrom(
          { engines: [{ name: 'codex', path: '/usr/bin/codex', status: 'ok' }] },
          { loginState: () => 'loggedIn' },
        ),
      createEngineJudge: () => backend,
    });
    const r = await rt.compare({
      sessionId: 's2',
      itemId: '1',
      kind: 'text',
      expected: '완료',
      actual: '끝났어요',
    });
    expect(r).toMatchObject({ status: 'pass', aiJudged: true, recorded: true, judge: { engineId: 'codex' } });
    expect(backend.calls).toBe(3);
    const item = ledger.item('1');
    expect(item.ai_judged).toBe(true);
    expect(item.evidence.at(-1)).toMatchObject({
      kind: 'compare',
      compare: { level: 'semantic', judgeEngine: 'codex' },
    });
    e.log.close();
  });

  it('엔진 정보: 감지 결과 + 로그인 상태 + 인증 모드 (확실히 로그아웃이면 쓰지 않음)', () => {
    expect(
      judgeEnginesFrom(
        {
          engines: [
            { name: 'claude', path: '/bin/claude', status: 'ok' },
            { name: 'codex', path: '/bin/codex', status: 'ok' },
          ],
        },
        {
          loginState: (id) => (id === 'codex' ? 'loggedOut' : 'unknown'),
          authMode: (id) => (id === 'claude' ? 'apiKey' : undefined),
        },
      ),
    ).toEqual([
      { id: 'claude', detected: true, loggedIn: true, authMode: 'apiKey', command: '/bin/claude' },
      { id: 'codex', detected: true, loggedIn: false, authMode: 'subscription', command: '/bin/codex' },
    ]);
    expect(judgeEnginesFrom(null)).toEqual([]);
  });

  it('라우트: GET /api/notices · POST /api/compare (잘못된 요청 400)', async () => {
    const e = env();
    e.secrets.set(name, 'old');
    writeFileSync(join(e.home, 'settings.json'), JSON.stringify({ verifier: { l4: name } }));
    const rt = start(e);
    const gets = new Map<string, () => Promise<unknown>>();
    const posts = new Map<
      string,
      (req: { body?: unknown }, reply: { code(n: number): { send(b: unknown): unknown } }) => Promise<unknown>
    >();
    registerJudgeRoutes({ get: (p, h) => gets.set(p, h), post: (p, h) => posts.set(p, h) }, rt);
    expect(await gets.get('/api/notices')!()).toEqual({
      notices: [
        expect.objectContaining({ noticeId: 'retired-judge-key-removed', message: RETIRED_JUDGE_KEY_NOTICE }),
      ],
    });
    const sent: { code: number; body: unknown }[] = [];
    const reply = { code: (code: number) => ({ send: (body: unknown) => sent.push({ code, body }) }) };
    await posts.get('/api/compare')!(
      { body: { sessionId: '../x', itemId: '1', expected: 'a', actual: 'b' } },
      reply,
    );
    expect(sent[0]?.code).toBe(400);
    const ok = (await posts.get('/api/compare')!(
      { body: { sessionId: 's3', itemId: '1', kind: 'number', expected: '1,000', actual: '1000' } },
      reply,
    )) as { status: string };
    expect(ok.status).toBe('pass');
    e.log.close();
  });
});
