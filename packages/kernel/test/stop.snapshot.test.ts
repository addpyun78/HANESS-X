import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parsePipeline } from '@harness-x/protocol';
import { EventLog, type LogRecord } from '../src/event-log.js';
import { Dispatcher, type DispatchRunInput } from '../src/dispatch.js';
import {
  captureFileState,
  listFileHashes,
  readPauseSnapshot,
  takePauseSnapshot,
} from '../src/pause-snapshot.js';
import { tempDir } from './helpers.js';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function gitRepo(dir: string) {
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'a.txt'), 'one\n');
  writeFileSync(join(dir, 'b.txt'), 'two\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'init');
}

/** 작업 트리 전체 모습: status + 파일 내용 + stash 목록 + 인덱스 */
function treeState(dir: string) {
  return {
    status: git(dir, 'status', '--porcelain=v1', '--untracked-files=all'),
    stashList: git(dir, 'stash', 'list'),
    index: git(dir, 'diff', '--cached', '--name-only'),
    files: listFileHashes(dir),
  };
}

const temps: { cleanup(): void }[] = [];
afterEach(() => temps.splice(0).forEach((t) => t.cleanup()));
const tmp = () => {
  const t = tempDir('hx-snap-');
  temps.push(t);
  return t.dir;
};
const paused = { reason: 'user' as const, at: '2026-11-12T00:00:00.000Z', by: 'user' };

describe('2A.6 정지 스냅샷 — Git', () => {
  it('git stash create로 해시만 저장, 작업 트리·인덱스·stash 목록 무변화', () => {
    const dir = tmp();
    gitRepo(dir);
    writeFileSync(join(dir, 'a.txt'), 'one changed\n'); // 수정 (추적)
    writeFileSync(join(dir, 'b.txt'), 'two staged\n');
    git(dir, 'add', 'b.txt'); // 스테이지된 수정
    mkdirSync(join(dir, 'new'));
    writeFileSync(join(dir, 'new', 'c.txt'), 'three\n'); // 추적 안 함
    const before = treeState(dir);
    const sessionDir = join(dir, '..', 'sess-' + Date.now());
    const snap = takePauseSnapshot({
      sessionId: 's1',
      paused,
      cwd: dir,
      sessionDir,
      itemId: 'I-3',
      nodeId: 'build',
    });
    expect(treeState(dir)).toEqual(before);
    expect(snap.item).toEqual({ id: 'I-3', interrupted: true });
    expect(snap.paused).toEqual(paused);
    expect(snap.files.kind).toBe('git');
    if (snap.files.kind !== 'git') return;
    expect(snap.files.head).toBe(git(dir, 'rev-parse', 'HEAD'));
    expect(snap.files.stash).toMatch(/^[0-9a-f]{40}$/);
    expect(git(dir, 'cat-file', '-t', snap.files.stash!)).toBe('commit');
    // 해시 안에 멈춘 때의 내용이 들어 있다
    expect(git(dir, 'show', `${snap.files.stash}:a.txt`)).toBe('one changed');
    expect(snap.files.untracked.map((f) => f.path)).toEqual(['new/c.txt']);
    expect(readPauseSnapshot(sessionDir)).toEqual(snap);
  });

  it('바뀐 것이 없으면 stash null (HEAD 그대로)', () => {
    const dir = tmp();
    gitRepo(dir);
    const s = captureFileState(dir);
    expect(s).toMatchObject({ kind: 'git', stash: null, untracked: [] });
  });
});

describe('2A.6 정지 스냅샷 — Git 아님', () => {
  it('파일 목록 + sha256, 작업 폴더 무변화', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'x.md'), '# x\n');
    mkdirSync(join(dir, 'node_modules'));
    writeFileSync(join(dir, 'node_modules', 'skip.js'), '');
    const before = listFileHashes(dir);
    const snap = takePauseSnapshot({
      sessionId: 's2',
      paused,
      cwd: dir,
      sessionDir: join(dir, '..', 'sess2'),
    });
    expect(listFileHashes(dir)).toEqual(before);
    expect(snap.files).toEqual({
      kind: 'files',
      files: [{ path: 'x.md', sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }],
    });
    expect(readFileSync(join(dir, 'x.md'), 'utf8')).toBe('# x\n');
  });
});

describe('2A.6 Dispatcher → session_paused 기록 + 스냅샷', () => {
  it('멈추면 onPaused로 스냅샷, 이벤트에 현재 항목 interrupted:true', async () => {
    const dir = tmp();
    gitRepo(dir);
    const t = tempDir('hx-snaplog-');
    temps.push(t);
    const log = new EventLog({ root: join(t.dir, 'logs') });
    const seen: LogRecord[] = [];
    const off = log.subscribe((r) => seen.push(r));
    const d = new Dispatcher({
      log,
      resolve: () => ({
        name: 'a',
        command: '/a',
        displayName: 'A',
        pipeline: parsePipeline({ name: 'a', nodes: [{ id: 'build', type: 'role' }], edges: [] }),
      }),
      run: async (i: DispatchRunInput) => {
        i.onEvent({ id: '1', ts: '', sessionId: i.sessionId, type: 'node_start', nodeId: 'build' });
        i.onEvent({ id: '2', ts: '', sessionId: i.sessionId, type: 'tool_call', itemId: 'I-2', callId: 'c' });
        writeFileSync(join(dir, 'a.txt'), 'half\n');
        await new Promise<void>((r) => i.signal.addEventListener('abort', () => r(), { once: true }));
        return { status: 'error' };
      },
      onPaused: (s, c) => {
        const snap = takePauseSnapshot({
          sessionId: s.sessionId,
          paused: s.paused!,
          cwd: dir,
          sessionDir: dirname(log.sessionFile(s.sessionId)),
          ...(c.itemId ? { itemId: c.itemId } : {}),
          ...(c.nodeId ? { nodeId: c.nodeId } : {}),
        });
        return { snapshot: { kind: snap.files.kind } };
      },
    });
    const s = d.dispatch({ agent: 'a', prompt: 'x' });
    const before = treeState(dir);
    await d.stopNow(s.sessionId);
    off();
    log.flush();
    expect(treeState(dir)).toEqual(before);
    const ev = seen.find((r) => r.type === 'session_paused')!;
    expect(ev).toMatchObject({
      paused: { reason: 'user', by: 'user' },
      item: { id: 'I-2', interrupted: true },
      nodeId: 'build',
      snapshot: { kind: 'git' },
    });
    const snap = readPauseSnapshot(dirname(log.sessionFile(s.sessionId)))!;
    expect(snap.item).toEqual({ id: 'I-2', interrupted: true });
    expect(snap.files.kind === 'git' && git(dir, 'show', `${snap.files.stash}:a.txt`)).toBe('half');
  });
});
