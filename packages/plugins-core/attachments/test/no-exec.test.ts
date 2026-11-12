import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

// 자식 프로세스를 만드는 모든 함수를 기록만 하게 바꾼다 (실행 호출 0건 확인)
const { spawned } = vi.hoisted(() => ({ spawned: [] as string[] }));
vi.mock('node:child_process', async (orig) => {
  const real = await orig<typeof import('node:child_process')>();
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      spawned.push(`${name} ${String(args[0])}`);
      throw new Error('테스트에서는 실행 금지');
    };
  return {
    ...real,
    exec: record('exec'),
    execFile: record('execFile'),
    execFileSync: record('execFileSync'),
    execSync: record('execSync'),
    spawn: record('spawn'),
    spawnSync: record('spawnSync'),
    fork: record('fork'),
  };
});

const { AttachmentStore, ConversionQueue, DEFAULT_CONVERTERS, MESSAGES } = await import('../src/index.js');
const { tempProject } = await import('./helpers.js');
const { elf, exe } = await import('./samples.js');

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

describe('1C.1 첨부 파일은 절대 실행하지 않음 (.exe/.bat/.ps1/.sh는 "실행하지 않고 내용만 봐요")', () => {
  it('실행 파일·스크립트 6종을 넣고 바꿔도 실행 호출 0건', async () => {
    const p = tempProject();
    cleanups.push(p.cleanup);
    const store = new AttachmentStore({ projectRoot: p.root });
    const q = new ConversionQueue({ store, converters: DEFAULT_CONVERTERS });
    const files: [string, Buffer][] = [
      ['setup.exe', exe()],
      ['tool', elf()],
      ['install.sh', Buffer.from('#!/bin/sh\nrm -rf ~\n')],
      ['run.ps1', Buffer.from('Remove-Item -Recurse C:\\\n')],
      ['start.bat', Buffer.from('@echo off\r\ndel /q *\r\n')],
      ['go.cmd', Buffer.from('shutdown /s\r\n')],
    ];
    const done = [];
    for (const [name, data] of files) {
      const { attachment } = await store.add('s', { name, data });
      expect(attachment.kind).toBe('executable');
      done.push(await q.enqueue(attachment));
    }
    expect(spawned).toEqual([]);
    for (const a of done) expect(a.warnings.map((w) => w.message)).toContain(MESSAGES.notExecuted);
    // 스크립트는 글로만 보여 준다, 바이너리는 이름·크기만
    const sh = done.find((a) => a.originalName === 'install.sh')!;
    expect(readFileSync(sh.representations[0]!.path, 'utf8')).toBe('#!/bin/sh\nrm -rf ~\n');
    expect(done.find((a) => a.originalName === 'setup.exe')!.representations).toEqual([]);
    expect(MESSAGES.notExecuted).toBe('실행하지 않고 내용만 봐요.');
  });
});
