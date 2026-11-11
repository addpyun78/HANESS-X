import { afterEach, describe, expect, it } from 'vitest';
import { HumanGestureTokens, type GestureKind, type InstallApi } from '../src/index.js';
import { bootApi } from './api-fixtures.js';

type Api = Awaited<ReturnType<typeof bootApi>>;
let api: Api | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

/** 가짜 설치 서비스: 계획 p1(install)·p2(uninstall) */
function fakeInstall() {
  const executed: { planId: string; gestureId: string }[] = [];
  const resolved: string[] = [];
  const plans: Record<string, GestureKind> = { p1: 'install', p2: 'uninstall' };
  const svc: InstallApi = {
    search: (q) => ({ query: q, candidates: [] }),
    resolve: (url) => {
      resolved.push(url);
      return { input: url, candidates: [{ kind: 'npm-cli', target: { id: 'prettier' } }] };
    },
    plan: () => ({ id: 'p1' }),
    getPlan: (id) => (plans[id] ? { id } : undefined),
    gestureKindFor: (id) => plans[id],
    execute: (planId, a) => {
      executed.push({ planId, gestureId: a.gestureId });
      return { id: 'job1', planId, status: 'queued' };
    },
    cancel: () => false,
    uninstallPlan: () => ({ id: 'p2' }),
    checkUpdates: () => ({ updates: [] }),
    importScan: () => ({ candidates: [] }),
    importTools: (ids) => ({ imported: ids }),
    tools: () => ({ tools: [] }),
    history: () => ({ records: [] }),
    onOutput: () => () => {},
  };
  return { svc, executed, resolved };
}

const exec = (a: Api, body: unknown, headers: Record<string, string> = {}) =>
  a.post('/api/install/execute', body, { ...a.auth, ...headers });
const token = async (a: Api, kind: string) =>
  (await (await a.post('/api/gesture-tokens', { kind }, a.auth)).json()) as { token: string; id: string };

describe('P2-A.6 사람 클릭 토큰 (human-gesture-token)', () => {
  it('1회용·60초·작업 종류 바인딩 — 모듈 단위', () => {
    let now = 1_000_000;
    const g = new HumanGestureTokens({ now: () => now });
    const t = g.issue('save-agent');
    expect(g.consume(undefined, 'save-agent')).toMatchObject({ ok: false, reason: 'missing' });
    expect(g.consume('nope', 'save-agent')).toMatchObject({ ok: false, reason: 'unknown' });
    expect(g.consume(t.token, 'install')).toMatchObject({ ok: false, reason: 'wrong_kind' });
    expect(g.consume(t.token, 'save-agent')).toMatchObject({ ok: true, id: t.id });
    expect(g.consume(t.token, 'save-agent')).toMatchObject({ ok: false, reason: 'reused' });
    const t2 = g.issue('install');
    now += 60_001;
    expect(g.consume(t2.token, 'install')).toMatchObject({ ok: false, reason: 'expired' });
    expect(() => g.require(undefined, 'install')).toThrow(/클릭/);
  });

  it('API: 없음·재사용·만료·다른 작업 종류 → 403, 올바른 토큰만 통과', async () => {
    let now = Date.now();
    const gestures = new HumanGestureTokens({ now: () => now });
    const f = fakeInstall();
    api = await bootApi({ install: f.svc, gestures });
    // 세션 토큰만으로는 실행 불가
    const none = await exec(api, { planId: 'p1' });
    expect(none.status).toBe(403);
    expect(await none.json()).toMatchObject({ error: 'gesture_required', reason: 'missing' });
    // 다른 작업 종류 (save-agent 토큰으로 설치)
    const wrong = await token(api, 'save-agent');
    expect((await exec(api, { planId: 'p1' }, { 'x-harness-gesture': wrong.token })).status).toBe(403);
    // 제거 계획에 install 토큰
    const inst = await token(api, 'install');
    const r1 = await exec(api, { planId: 'p2' }, { 'x-harness-gesture': inst.token });
    expect(r1.status).toBe(403);
    expect(((await r1.json()) as { reason: string }).reason).toBe('wrong_kind');
    // 정상
    const ok = await token(api, 'install');
    const r2 = await exec(api, { planId: 'p1', gestureToken: ok.token });
    expect(r2.status).toBe(202);
    expect(f.executed).toEqual([{ planId: 'p1', gestureId: ok.id }]);
    // 재사용
    const r3 = await exec(api, { planId: 'p1' }, { 'x-harness-gesture': ok.token });
    expect(r3.status).toBe(403);
    expect(((await r3.json()) as { reason: string }).reason).toBe('reused');
    // 만료
    const late = await token(api, 'install');
    now += 61_000;
    const r4 = await exec(api, { planId: 'p1' }, { 'x-harness-gesture': late.token });
    expect(r4.status).toBe(403);
    expect(((await r4.json()) as { reason: string }).reason).toBe('expired');
    // 모르는 종류 요청은 400, 세션 토큰 없이 발급 불가(401)
    expect((await api.post('/api/gesture-tokens', { kind: 'root' }, api.auth)).status).toBe(400);
    expect((await api.post('/api/gesture-tokens', { kind: 'install' })).status).toBe(401);
    expect(f.executed.length).toBe(1);
  });
});

describe('P2-A.8 POST /api/install/execute — 토큰 필수', () => {
  it('토큰 없이 403 (계획이 있어도·없어도), 실행되지 않음', async () => {
    const f = fakeInstall();
    api = await bootApi({ install: f.svc });
    expect((await exec(api, { planId: 'p1' })).status).toBe(403);
    expect((await exec(api, { planId: 'missing' })).status).toBe(403);
    expect((await exec(api, {})).status).toBe(403);
    // import도 토큰 필수
    expect((await api.post('/api/install/import', { ids: ['x'] }, api.auth)).status).toBe(403);
    expect(f.executed).toEqual([]);
    // 토큰이 있으면 없는 계획은 404
    const t = await token(api, 'install');
    expect((await exec(api, { planId: 'missing' }, { 'x-harness-gesture': t.token })).status).toBe(404);
  });
});

describe('P2-C.1 POST /api/install/resolve {url}', () => {
  it('주소 → 서비스 resolve 결과, 빈 주소 400, 세션 토큰 없으면 401', async () => {
    const f = fakeInstall();
    api = await bootApi({ install: f.svc });
    const r = await api.post(
      '/api/install/resolve',
      { url: 'https://www.npmjs.com/package/prettier' },
      api.auth,
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ candidates: [{ kind: 'npm-cli' }] });
    expect(f.resolved).toEqual(['https://www.npmjs.com/package/prettier']);
    expect((await api.post('/api/install/resolve', { url: ' ' }, api.auth)).status).toBe(400);
    expect((await api.post('/api/install/resolve', { url: 'https://x' })).status).toBe(401);
  });
  it('설치 서비스가 없으면 라우트 없음(404)', async () => {
    api = await bootApi();
    expect((await api.post('/api/install/resolve', { url: 'https://x' }, api.auth)).status).toBe(404);
  });
});
