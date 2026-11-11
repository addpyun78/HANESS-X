import { afterEach, describe, expect, it, vi } from 'vitest';
import { missingEngineCard, PipelineRunner } from '../src/index.js';
import { fakeEngine, pipeline, tmpWorkspace, type FakeCall } from './runner-helpers.js';

let ws: ReturnType<typeof tmpWorkspace>;
afterEach(() => ws?.cleanup());

const two = (engine: string) =>
  pipeline({
    name: 'two',
    nodes: [
      { id: 'plan', type: 'role', engine: 'main' },
      { id: 'build', type: 'role', engine },
    ],
    edges: [{ from: 'plan', to: 'build' }],
  });

describe('T-101 5D 실행기: engine: main 과 없어진 고정 엔진', () => {
  it('5D.4 engine: main 노드는 메인 AI 엔진으로, 구체 id 노드는 그 엔진으로', async () => {
    ws = tmpWorkspace();
    const calls: FakeCall[] = [];
    const claude = fakeEngine('claude-code', () => ({ text: '{"ok":true}' }), calls);
    const codex = fakeEngine('codex', () => ({ text: '{"ok":true}' }), calls);
    const r = await new PipelineRunner({
      engines: { 'claude-code': claude, codex },
      mainEngine: 'codex',
      defaultEngine: 'claude-code',
      workspace: ws.dir,
      sessionId: 's-main',
    }).run(two('claude-code'), {});
    expect(r.status).toBe('completed');
    expect(r.visits.map((v) => [v.nodeId, v.engineId])).toEqual([
      ['plan', 'codex'],
      ['build', 'claude-code'],
    ]);
  });

  it('5D.6 고정 엔진(agy)이 없어지면 "이 단계의 AI(agy)를 못 찾았어요. 메인 AI로 대신할까요?" 카드 → 대신하기면 메인으로 계속', async () => {
    ws = tmpWorkspace();
    const claude = fakeEngine('claude-code', () => ({ text: '{"ok":true}' }));
    const events: { type: string; kind?: string; title?: string; options?: string[] }[] = [];
    const ask = vi.fn(async () => 'use-main' as const);
    const r = await new PipelineRunner({
      engines: { 'claude-code': claude },
      mainEngine: 'claude-code',
      workspace: ws.dir,
      sessionId: 's-missing',
      onEvent: (e) => events.push(e as never),
      onMissingEngine: ask,
    }).run(two('agy'), {});
    expect(r.status).toBe('completed');
    expect(r.visits.map((v) => [v.nodeId, v.engineId])).toEqual([
      ['plan', 'claude-code'],
      ['build', 'claude-code'],
    ]);
    const card = events.find((e) => e.type === 'approval_request');
    expect(card).toMatchObject({
      kind: 'engine.missing',
      title: '이 단계의 AI(agy)를 못 찾았어요. 메인 AI로 대신할까요?',
      options: ['메인 AI로 대신하기', '멈추기'],
    });
    expect(ask).toHaveBeenCalledWith(missingEngineCard('build', 'agy', 'claude-code'));
  });

  it('5D.6 [멈추기]를 고르거나 물을 곳이 없으면 그 단계에서 멈춘다 (카드는 남김)', async () => {
    ws = tmpWorkspace();
    const claude = fakeEngine('claude-code', () => ({ text: '{"ok":true}' }));
    for (const onMissingEngine of [async () => 'stop' as const, undefined]) {
      const events: { type: string }[] = [];
      const r = await new PipelineRunner({
        engines: { 'claude-code': claude },
        mainEngine: 'claude-code',
        workspace: ws.dir,
        onEvent: (e) => events.push(e as never),
        ...(onMissingEngine ? { onMissingEngine } : {}),
      }).run(two('agy'), {});
      expect(r.status).not.toBe('completed');
      expect(events.filter((e) => e.type === 'approval_request')).toHaveLength(1);
    }
    expect(missingEngineCard('build', 'agy', undefined).options.map((o) => o.id)).toEqual(['stop']);
  });
});
