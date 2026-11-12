import { HookBus } from '@harness-x/kernel';
import { parsePipeline } from '@harness-x/protocol';
import { describe, expect, it } from 'vitest';
import {
  buildSkeleton,
  checkStageWrite,
  globToRegExp,
  installStageScopeGuard,
  itemsInScope,
  manifestSections,
} from '../src/index.js';
import { THREE } from './stages-helpers.js';

const tree = () => buildSkeleton({ sessionId: 's', agent: { name: 'three', pipeline: THREE } });

describe('4B.4 단계 산출물 범위', () => {
  it('노드 artifacts·canModify가 파이프라인 스키마에 들어간다', () => {
    const p = parsePipeline({
      name: 'x',
      nodes: [{ id: 'a', type: 'role', artifacts: ['docs/**'], canModify: ['b'] }],
    });
    expect(p.nodes[0]).toMatchObject({ artifacts: ['docs/**'], canModify: ['b'] });
    expect(tree().stages[1]!.scope).toEqual({ artifacts: ['src/**'], canModify: [] });
  });

  it('경로 패턴', () => {
    expect(globToRegExp('src/**').test('src/a/b.ts')).toBe(true);
    expect(globToRegExp('src/*.ts').test('src/a/b.ts')).toBe(false);
    expect(globToRegExp('**/*.md').test('README.md')).toBe(true);
    expect(globToRegExp('a?.ts').test('ab.ts')).toBe(true);
  });

  it('범위 안 쓰기는 허용, 범위 밖 쓰기는 차단', () => {
    const t = tree();
    expect(checkStageWrite(t, 'build', 'src/app.ts')).toEqual({ allowed: true });
    const out = checkStageWrite(t, 'build', 'docs/readme.md');
    expect(out.allowed).toBe(false);
  });

  it('다른 단계 산출물 수정은 canModify 선언이 있을 때만', () => {
    const t = tree();
    // build는 test 산출물을 고칠 수 없다
    const r = checkStageWrite(t, 'build', 'test/app.test.ts');
    expect(r).toMatchObject({ allowed: false, owner: 'test' });
    // test는 canModify: [build] → build 산출물 수정 가능
    expect(checkStageWrite(t, 'test', 'src/app.ts')).toEqual({ allowed: true, owner: 'build' });
    // 범위를 선언하지 않은 plan도 다른 단계 산출물은 못 고친다
    expect(checkStageWrite(t, 'plan', 'src/app.ts').allowed).toBe(false);
    expect(checkStageWrite(t, 'plan', 'notes/plan.md').allowed).toBe(true);
  });

  it('범위 밖 쓰기 차단 훅 (tool.before)', async () => {
    const hooks = new HookBus();
    const t = tree();
    installStageScopeGuard(hooks, () => ({ tree: t, stageId: 'build' }));
    const bad = await hooks.runBlocking('tool.before', {
      sessionId: 's',
      tool: 'Write',
      input: { file_path: 'test/x.test.ts' },
    });
    expect(bad.decision).toBe('block');
    const ok = await hooks.runBlocking('tool.before', {
      sessionId: 's',
      tool: 'Write',
      input: { file_path: 'src/x.ts' },
    });
    expect(ok.decision).toBe('allow');
    const read = await hooks.runBlocking('tool.before', {
      sessionId: 's',
      tool: 'Read',
      input: { file_path: 'test/x.ts' },
    });
    expect(read.decision).toBe('allow');
  });

  it('단계별 manifest 구획 + 항목 범위 검사', () => {
    const m = {
      artifacts: {
        'art.app': { displayName: '앱', path: 'src/app', kind: 'dir' as const },
        'art.tests': { displayName: '시험', path: 'test/app', kind: 'dir' as const },
        'art.notes': { displayName: '메모', path: 'notes', kind: 'dir' as const },
      },
    };
    expect(manifestSections(tree(), m)).toEqual({
      build: ['art.app'],
      test: ['art.tests'],
      _shared: ['art.notes'],
    });
    expect(itemsInScope(tree(), 'build', ['art.app'], m)).toBe(true);
    expect(itemsInScope(tree(), 'build', ['art.tests'], m)).toBe(false);
  });
});
