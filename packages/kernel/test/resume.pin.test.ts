import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parsePipeline, type Pipeline } from '@harness-x/protocol';
import { EventLog, type LogRecord } from '../src/event-log.js';
import { Dispatcher, type DispatchAgent, type DispatchRunInput } from '../src/dispatch.js';
import { findResumableSessions } from '../src/resume.js';
import { checkBeforeResume } from '../src/resume-check.js';
import { changedSinceStart, pinRunVersion, readPinnedVersion } from '../src/resume-pin.js';
import { resumeSession } from '../src/resume-run.js';
import { tempDir } from './helpers.js';

const tmp = tempDir('hx-pin-');
afterAll(() => tmp.cleanup());

const pipe = (ids: string[]): Pipeline =>
  parsePipeline({
    name: 'qa',
    nodes: ids.map((id) => ({ id, type: 'role' })),
    edges: ids.slice(1).map((id, i) => ({ from: ids[i]!, to: id })),
  });

describe('2B.6 버전 고정 — 실행 시작 때 스냅샷, 재개 기본은 시작 당시 버전', () => {
  it('버전이 바뀐 뒤 재개: 기본은 시작할 때 버전, [새 버전으로]면 지금 버전', async () => {
    const log = new EventLog({ root: join(tmp.dir, 'logs') });
    const agentYaml = join(tmp.dir, 'agent.yaml');
    writeFileSync(agentYaml, 'name: qa\nversion: 1\n');
    let current: DispatchAgent = { name: 'qa', command: '/qa', displayName: 'QA', pipeline: pipe(['plan']) };
    const runs: DispatchRunInput[] = [];
    const seen: LogRecord[] = [];
    const off = log.subscribe((r) => seen.push(r));
    const d = new Dispatcher({
      log,
      resolve: (n) => (n.replace('/', '') === 'qa' ? current : undefined),
      run: async (i) => {
        runs.push(i);
        await new Promise<void>((r) => i.signal.addEventListener('abort', () => r(), { once: true }));
        return { status: 'error' };
      },
      onCreated: (s, c) =>
        pinRunVersion({
          sessionId: s.sessionId,
          sessionDir: dirname(log.sessionFile(s.sessionId)),
          agent: c.agent.name,
          pipeline: c.pipeline,
          files: [{ label: 'agent.yaml', path: agentYaml }],
        }),
    });
    const s = d.dispatch({ agent: 'qa', prompt: '고쳐 줘' });
    const pin = readPinnedVersion(dirname(log.sessionFile(s.sessionId)))!;
    expect(pin.pipeline.nodes.map((n) => n.id)).toEqual(['plan']);
    expect(pin.files[0]).toMatchObject({ label: 'agent.yaml', content: 'name: qa\nversion: 1\n' });
    await d.stopNow(s.sessionId);
    log.flush();

    // 멈춘 뒤 에이전트가 바뀜 (파이프라인 노드 추가 + agent.yaml 수정)
    writeFileSync(agentYaml, 'name: qa\nversion: 2\n');
    current = { ...current, pipeline: pipe(['plan', 'build']) };
    expect(changedSinceStart(pin, current.pipeline)).toEqual(['agent.yaml', 'pipeline']);
    const [paused] = findResumableSessions(log);
    const check = checkBeforeResume(paused!, {
      changedSinceStart: () => changedSinceStart(pin, current.pipeline),
    });
    expect(check.issues[0]).toMatchObject({ check: 'version', list: ['agent.yaml', 'pipeline'] });
    expect(check.issues[0]!.choices.find((c) => c.default)!.id).toBe('pinned');

    const deps = { log, dispatcher: d, agentFor: () => current };
    // 기본: 시작할 때 버전
    const r1 = await resumeSession(deps, s.sessionId);
    expect(r1.version).toBe('pinned');
    expect(runs.at(-1)!.pipeline.nodes.map((n) => n.id)).toEqual(['plan']);
    expect(runs.at(-1)!.sessionId).toBe(s.sessionId);
    await d.stopNow(s.sessionId);
    log.flush();
    // [새 버전으로]
    const r2 = await resumeSession(deps, s.sessionId, { version: 'latest' });
    expect(r2.version).toBe('latest');
    expect(runs.at(-1)!.pipeline.nodes.map((n) => n.id)).toEqual(['plan', 'build']);
    await d.stopNow(s.sessionId);
    off();
    const resumed = seen.filter((e) => e.type === 'session_resumed');
    expect(resumed.map((e) => e.version)).toEqual(['pinned', 'latest']);
  });

  it('바뀐 것이 없으면 묻지 않음', () => {
    const f = join(tmp.dir, 'same.yaml');
    writeFileSync(f, 'x: 1\n');
    const pin = pinRunVersion({
      sessionId: 'z',
      sessionDir: join(tmp.dir, 'z'),
      agent: 'qa',
      pipeline: pipe(['a']),
      files: [{ label: 'same.yaml', path: f }],
    });
    expect(changedSinceStart(pin, pipe(['a']))).toEqual([]);
  });
});
