// C2.3 테스트 서버(임시 홈, 엔진은 실행하지 않음)에서 API 경로마다 다른 입력 2개로 호출 → 응답이 항상 같은 경로 → raw/api-constant.json
// 안전: GET만 호출(POST·PUT·DELETE는 엔진 실행·설치·파일 쓰기 같은 부작용이 있어 '미시험'으로 기록)
//  - 경로 변수(:id)가 있으면 값 2개(a·b)를 넣어 비교 → 같은 응답이면 '고정값 의심'
//  - 경로 변수가 없으면 쿼리 2개(?q=a / ?q=b)로 비교 + 빈 응답({}·[]·null·빈 목록만) 표시
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditDir, rawDir, readJson, root, writeJson } from './lib.mjs';

const routes = readJson(join(auditDir, 'snapshots', 'api-routes.json'));
const home = mkdtempSync(join(tmpdir(), 'hx-probe-'));
const token = 'audit-probe-token-0123456789abcdef012345';
const port = 39050 + Math.floor(Math.random() * 40);
const p = spawn(
  process.execPath,
  [
    '--no-warnings',
    join(root, 'packages', 'kernel', 'dist', 'cli.js'),
    'serve',
    '--port',
    String(port),
    '--no-watch',
    '--workspace',
    home,
    '--token-file',
    join(home, 'token'),
  ],
  {
    cwd: home,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      HARNESS_X_HOME: join(home, '.harness-x'),
      HARNESS_X_TOKEN: token,
      PATH: '/usr/bin:/bin',
    },
    stdio: 'ignore',
  },
);
const call = async (path) => {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await r.text();
  return { status: r.status, body: text.slice(0, 4000) };
};
const isEmpty = (body) => {
  try {
    const j = JSON.parse(body);
    if (j === null) return true;
    if (Array.isArray(j)) return j.length === 0;
    if (typeof j === 'object')
      return Object.values(j).every(
        (v) =>
          v === null ||
          (Array.isArray(v) && v.length === 0) ||
          (typeof v === 'object' && v && Object.keys(v).length === 0),
      );
  } catch {
    return body.trim() === '';
  }
  return false;
};
const out = [];
try {
  const t0 = Date.now();
  for (;;) {
    if (Date.now() - t0 > 240_000) throw new Error('서버가 240초 안에 안 켜짐');
    try {
      if ((await call('/api/health')).status === 200) break;
    } catch {
      /* 대기 */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  const seen = new Set();
  for (const r of routes) {
    const key = `${r.method} ${r.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (r.method !== 'GET' || /\*|events|stream|sse|\/ws\b/.test(r.path)) {
      out.push({
        route: key,
        file: `${r.file}:${r.line}`,
        tested: false,
        reason: r.method !== 'GET' ? '부작용 가능(GET 아님)' : '스트림 경로',
      });
      continue;
    }
    const hasParam = /:[A-Za-z]+/.test(r.path);
    const A = hasParam ? r.path.replace(/:[A-Za-z]+/g, 'audit-a') : `${r.path}?q=audit-a`;
    const B = hasParam ? r.path.replace(/:[A-Za-z]+/g, 'audit-b-2') : `${r.path}?q=audit-b-2`;
    try {
      const [a, b] = [await call(A), await call(B)];
      const same = a.status === b.status && a.body === b.body;
      out.push({
        route: key,
        file: `${r.file}:${r.line}`,
        tested: true,
        hasParam,
        statusA: a.status,
        statusB: b.status,
        same,
        empty: a.status < 400 && isEmpty(a.body),
        constantSuspect: hasParam && same && a.status < 400,
        sample: a.body.slice(0, 160),
      });
    } catch (e) {
      out.push({
        route: key,
        file: `${r.file}:${r.line}`,
        tested: true,
        error: String(e?.message ?? e).slice(0, 120),
      });
    }
  }
} finally {
  p.kill();
  await new Promise((r) => setTimeout(r, 500));
  rmSync(home, { recursive: true, force: true });
}
writeJson(join(rawDir, 'api-constant.json'), out);
const tested = out.filter((o) => o.tested);
console.log(
  `probe-api: 경로 ${out.length}개, 시험 ${tested.length}개(GET), 고정값 의심 ${out.filter((o) => o.constantSuspect).length}개, 빈 응답 ${out.filter((o) => o.empty).length}개, 오류 ${out.filter((o) => o.error).length}개`,
);
