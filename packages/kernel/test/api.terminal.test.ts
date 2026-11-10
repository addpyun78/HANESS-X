import { realpathSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { PtyProcess } from '../src/api/terminal.js';
import { bootApi } from './api-fixtures.js';
import { tempDir } from './helpers.js';

type Msg = { type: string; data?: string; cwd?: string; exitCode?: number };

function open(url: string) {
  const ws = new WebSocket(url);
  const msgs: Msg[] = [];
  let out = '';
  const waiters: { check: () => boolean; res: () => void }[] = [];
  ws.on('message', (d) => {
    const m = JSON.parse(String(d)) as Msg;
    msgs.push(m);
    if (m.type === 'output') out += m.data ?? '';
    for (const w of [...waiters]) {
      if (!w.check()) continue;
      waiters.splice(waiters.indexOf(w), 1);
      w.res();
    }
  });
  const until = (check: () => boolean, ms = 20_000) =>
    new Promise<void>((res, rej) => {
      if (check()) return res();
      const t = setTimeout(() => rej(new Error(`timeout; output=${JSON.stringify(out)}`)), ms);
      waiters.push({
        check,
        res: () => {
          clearTimeout(t);
          res();
        },
      });
    });
  return {
    ws,
    msgs,
    get out() {
      return out;
    },
    until,
    send: (m: unknown) => ws.send(JSON.stringify(m)),
  };
}

describe('WS /ws/terminal (node-pty, 리눅스·WSL)', () => {
  it('실제 셸: pwd 출력이 워크스페이스 폴더', async () => {
    const ws = tempDir('hx-term-');
    const workspace = realpathSync(ws.dir);
    const api = await bootApi({
      terminal: { cwd: () => workspace, shell: 'bash', args: ['--norc', '--noprofile'] },
    });
    const t = open(api.server.url.replace('http', 'ws') + `/ws/terminal?token=${api.server.token}`);
    await t.until(() => t.msgs.some((m) => m.type === 'ready'));
    expect(t.msgs[0]).toMatchObject({ type: 'ready', cwd: workspace });
    t.send({ type: 'input', data: 'pwd\r' });
    // eslint-disable-next-line no-control-regex
    const plain = () => t.out.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '');
    await t.until(() =>
      plain()
        .split('\n')
        .some((l) => l.trim() === workspace),
    );
    t.send({ type: 'resize', cols: 120, rows: 40 });
    t.send({ type: 'input', data: 'exit\r' });
    await t.until(() => t.msgs.some((m) => m.type === 'exit'));
    expect(t.msgs.find((m) => m.type === 'exit')?.exitCode).toBe(0);
    await api.close();
    ws.cleanup();
  });

  it('토큰 없으면 401, 연결 종료 시 pty kill', async () => {
    const calls: string[] = [];
    const fake: PtyProcess = {
      onData: () => undefined,
      onExit: () => undefined,
      write: (d) => void calls.push(`write:${d}`),
      resize: (c, r) => void calls.push(`resize:${c}x${r}`),
      kill: () => void calls.push('kill'),
    };
    const api = await bootApi({ terminal: { cwd: '/w', spawn: () => fake } });
    const bad = new WebSocket(api.server.url.replace('http', 'ws') + '/ws/terminal');
    const status = await new Promise<number>((res) =>
      bad.on('unexpected-response', (_req, r) => res(r.statusCode ?? 0)),
    );
    expect(status).toBe(401);
    const t = open(api.server.url.replace('http', 'ws') + `/ws/terminal?token=${api.server.token}`);
    await t.until(() => t.msgs.length > 0);
    t.send({ type: 'input', data: 'ls\r' });
    t.send({ type: 'resize', cols: 100, rows: 30 });
    await new Promise((r) => setTimeout(r, 200));
    t.ws.close();
    await new Promise((r) => setTimeout(r, 300));
    expect(calls).toEqual(['write:ls\r', 'resize:100x30', 'kill']);
    await api.close();
  });
});
