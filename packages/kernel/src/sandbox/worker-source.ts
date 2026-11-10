/**
 * 62.1 격리 워커 소스 (eval 워커로 실행 — src/dist 어디서 불러도 같은 코드)
 *
 * 차단
 * - 모듈 해석 훅: 허용 목록 밖의 Node 내장 모듈(fs, child_process, net, http, module, vm, worker_threads …) import 거부,
 *   CommonJS 모듈 로드 거부 (require 경로 우회 차단)
 * - 전역: require/module, process.getBuiltinModule/binding/dlopen/kill/chdir, WebSocket/EventSource 제거
 * - process.env는 빈 객체 (Worker env 옵션)
 * 허용
 * - 메시지 RPC: ctx.fs / ctx.net / ctx.shell, 전역 fetch → 메인 스레드 권한 프록시가 검사 후 대신 수행
 * - ctx.hooks.onBlocking / onNotify → 메인 훅 버스에 대리 등록
 */

/** 격리 플러그인이 import할 수 있는 내장 모듈 */
export const SANDBOX_ALLOWED_BUILTINS = [
  'assert',
  'assert/strict',
  'buffer',
  'events',
  'path',
  'path/posix',
  'path/win32',
  'querystring',
  'string_decoder',
  'timers',
  'timers/promises',
  'url',
  'util',
  'util/types',
] as const;

export const SANDBOX_HOOKS_SOURCE = `
let builtins = new Set();
let allowed = new Set();
export function initialize(data) {
  builtins = new Set(data.builtins);
  allowed = new Set(data.allowed);
}
function denied(what) {
  const e = new Error('sandbox: 직접 접근 금지 (' + what + '). ctx.fs/ctx.net/ctx.shell을 쓰세요');
  e.code = 'ERR_SANDBOX_DENIED';
  return e;
}
export async function resolve(specifier, context, next) {
  const bare = specifier.startsWith('node:') ? specifier.slice(5) : specifier;
  if (specifier.startsWith('node:') || builtins.has(bare)) {
    if (!allowed.has(bare)) throw denied(specifier);
  }
  return next(specifier, context);
}
export async function load(url, context, next) {
  const r = await next(url, context);
  if (r.format === 'commonjs' || r.format === 'require-commonjs') throw denied('CommonJS 모듈 ' + url);
  return r;
}
`;

export const SANDBOX_WORKER_SOURCE = `
'use strict';
const { register, builtinModules } = require('node:module');
const { parentPort, workerData } = require('node:worker_threads');
register('data:text/javascript,' + encodeURIComponent(workerData.hooksSource), {
  data: { builtins: builtinModules, allowed: workerData.allowedBuiltins },
});
for (const k of ['require', 'module', 'exports', '__filename', '__dirname', 'WebSocket', 'EventSource']) {
  try { delete globalThis[k]; } catch {}
}
for (const k of ['getBuiltinModule', 'binding', '_linkedBinding', 'dlopen', 'kill', 'chdir', 'setuid', 'setgid']) {
  try { delete process[k]; } catch {}
  if (k in process) { try { process[k] = undefined; } catch {} }
}
const port = parentPort;
let seq = 0;
const pending = new Map();
function call(method, args) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    port.postMessage({ t: 'rpc', id, method, args });
  });
}
const handlers = new Map();
let regSeq = 0;
function reg(mode, name, handler, opts) {
  const regId = ++regSeq;
  handlers.set(regId, handler);
  port.postMessage({ t: 'hook-register', regId, mode, name, opts: opts ? JSON.parse(JSON.stringify(opts)) : {} });
  return () => {
    handlers.delete(regId);
    port.postMessage({ t: 'hook-unregister', regId });
  };
}
const ctx = {
  manifest: workerData.manifest,
  dir: workerData.dir,
  config: workerData.config,
  isolated: true,
  log: (m) => port.postMessage({ t: 'log', message: String(m) }),
  hooks: {
    onBlocking: (n, h, o) => reg('blocking', n, h, o),
    onNotify: (n, h, o) => reg('notify', n, h, o),
  },
  fs: {
    readFile: (p) => call('fs.readFile', [String(p)]),
    writeFile: (p, d) => call('fs.writeFile', [String(p), String(d)]),
    readdir: (p) => call('fs.readdir', [String(p)]),
  },
  net: {
    fetch: (url, init) =>
      call('net.fetch', [String(url), init ? { method: init.method, headers: init.headers, body: init.body } : undefined]),
  },
  shell: { exec: (cmd, args) => call('shell.exec', [String(cmd), (args || []).map(String)]) },
};
globalThis.fetch = async (url, init) => {
  const r = await ctx.net.fetch(url, init);
  return new Response(r.body, { status: r.status, headers: r.headers });
};
let mod = {};
const errOf = (e) => ({ message: e && e.message ? String(e.message) : String(e), code: e && e.code });
port.on('message', async (msg) => {
  try {
    if (msg.t === 'rpc-result') {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.value);
      else p.reject(Object.assign(new Error(msg.error.message), { code: msg.error.code }));
    } else if (msg.t === 'activate') {
      try {
        const m = await import(workerData.mainUrl);
        mod = m.activate || m.deactivate ? m : (m.default || {});
        if (mod.activate) await mod.activate(ctx);
        port.postMessage({ t: 'activated' });
      } catch (e) {
        port.postMessage({ t: 'activate-failed', error: errOf(e) });
      }
    } else if (msg.t === 'deactivate') {
      try {
        if (mod.deactivate) await mod.deactivate();
        port.postMessage({ t: 'deactivated' });
      } catch (e) {
        port.postMessage({ t: 'deactivated', error: errOf(e) });
      }
    } else if (msg.t === 'hook') {
      const h = handlers.get(msg.regId);
      try {
        const value = h ? await h(msg.ctx) : undefined;
        port.postMessage({ t: 'hook-result', callId: msg.callId, ok: true, value: value === undefined ? undefined : JSON.parse(JSON.stringify(value)) });
      } catch (e) {
        port.postMessage({ t: 'hook-result', callId: msg.callId, ok: false, error: errOf(e) });
      }
    }
  } catch (e) {
    port.postMessage({ t: 'log', message: 'sandbox worker error: ' + errOf(e).message });
  }
});
port.postMessage({ t: 'ready' });
`;
