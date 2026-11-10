import { HookBus } from '@harness-x/kernel';
import type { EngineAdapter, HarnessEvent } from '@harness-x/protocol';
import { describe, expect, it } from 'vitest';
import { ChecklistLedger } from '../src/ledger.js';
import { ManifestStore } from '../src/manifest.js';
import {
  buildSlice,
  compactedPrompt,
  SLICE_MAX_BYTES,
  SLICE_OPEN,
  SliceInjector,
  sliceOf,
  withSlice,
} from '../src/slice.js';
import { runWithStopGuard, StopGuard } from '../src/stop-guard.js';
import { item, tempDir } from './helpers.js';

function failOnce(l: ChecklistLedger, id: string, summary: string) {
  l.transition(id, 'doing');
  l.transition(id, 'verifying');
  l.transition(id, 'failed', { evidence: { kind: 'test_failed', summary } });
}

describe('29.1 컨텍스트 슬라이스', () => {
  it('현재 항목·부모·다음 3개·최근 실패 사유·정식 경로를 담는다', () => {
    const { dir, cleanup } = tempDir();
    try {
      const l = new ChecklistLedger({ dir, sessionId: 's1' });
      l.create([
        item('1', { artifactId: 'art.mobile-app', title: '모바일 앱' }),
        item('1.1', { parent: '1', artifactId: 'art.mobile-app' }),
        item('1.2', { parent: '1' }),
        item('1.3', { parent: '1' }),
        item('1.4', { parent: '1' }),
        item('1.5', { parent: '1' }),
      ]);
      failOnce(l, '1.1', 'login.test.ts: expected 200, got 500');
      const m = new ManifestStore({ dir, sessionId: 's1' });
      m.setDraft('art.mobile-app', { displayName: '하네스/모바일', path: 'harness/mobile', kind: 'dir' });
      const s = sliceOf(l, m);
      expect(s.itemId).toBe('1.1');
      expect(s.text).toContain('현재 항목 1.1 [failed, 시도 1]');
      expect(s.text).toContain('부모 1: 모바일 앱');
      expect(s.text).toContain('정식 경로 (art.mobile-app): harness/mobile');
      expect(s.text).toContain('최근 실패 사유: login.test.ts: expected 200, got 500');
      const next = s.text.split('\n').filter((x) => x.startsWith('- '));
      expect(next).toEqual(['- 1: 모바일 앱', '- 1.2: 항목 1.2 구현', '- 1.3: 항목 1.3 구현']);
      expect(s.bytes).toBeLessThanOrEqual(SLICE_MAX_BYTES);
    } finally {
      cleanup();
    }
  });

  it('크기 테스트: 아주 긴 한글 제목·실패 사유·경로여도 2KB(2048바이트) 이내, 현재 항목 id 유지', () => {
    const { dir, cleanup } = tempDir();
    try {
      const long = '아주 긴 한글 제목 '.repeat(300); // 약 8KB
      const l = new ChecklistLedger({ dir, sessionId: 's1' });
      l.create([
        item('p', { title: long }),
        ...Array.from({ length: 10 }, (_, k) =>
          item(`c${k}`, {
            parent: 'p',
            title: long,
            acceptance: [{ type: 'test', run: `pnpm test ${'x'.repeat(3000)}` }],
          }),
        ),
      ]);
      l.transition('p', 'blocked');
      failOnce(l, 'c0', '실패 '.repeat(2000));
      const s = buildSlice({ checklist: l.read() });
      expect(s.bytes).toBeLessThanOrEqual(2048);
      expect(Buffer.byteLength(s.text, 'utf8')).toBe(s.bytes);
      expect(s.itemId).toBe('c0');
      expect(s.text).toContain('현재 항목 c0');
      expect(s.text).toContain('부모 p:');
      expect(s.text).toContain('최근 실패 사유:');
      expect(s.text.endsWith('</harness-checklist>')).toBe(true);
      // 제한을 더 줄여도 지킨다
      for (const max of [1024, 512, 256])
        expect(buildSlice({ checklist: l.read() }, max).bytes).toBeLessThanOrEqual(max);
    } finally {
      cleanup();
    }
  });

  it('withSlice는 이미 붙은 슬라이스를 교체한다 (중복 누적 없음)', () => {
    const a = { text: `${SLICE_OPEN}\nA\n</harness-checklist>`, bytes: 0, itemId: 'a' };
    const b = { text: `${SLICE_OPEN}\nB\n</harness-checklist>`, bytes: 0, itemId: 'b' };
    const once = withSlice('하던 일 계속', a);
    expect(withSlice(once, b)).toBe(`${b.text}\n\n하던 일 계속`);
  });
});

describe('29.2 context.compact와 매 턴 시작 시 재주입', () => {
  it('압축 후 프롬프트에 현재 항목 id가 들어간다', async () => {
    const { dir, cleanup } = tempDir();
    try {
      const l = new ChecklistLedger({ dir, sessionId: 's1' });
      l.create([item('3.2'), item('3.3')]);
      const hooks = new HookBus();
      new SliceInjector(l).install(hooks);
      const p = await compactedPrompt(hooks, { sessionId: 's1', summary: '지금까지의 대화 요약' });
      expect(p).toContain('현재 항목 3.2');
      expect(p.endsWith('지금까지의 대화 요약')).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('runWithStopGuard preparePrompt: 매 턴 프롬프트 앞에 그때의 현재 항목 슬라이스', async () => {
    const { dir, cleanup } = tempDir();
    try {
      const l = new ChecklistLedger({ dir, sessionId: 's1' });
      l.create([item('1'), item('2')]);
      const prompts: string[] = [];
      const engine: EngineAdapter = {
        id: 'antigravity',
        displayName: 'fake',
        capabilities: { nativeStopHook: false, resume: false, mcp: false, interrupt: true },
        run(o) {
          prompts.push(o.prompt);
          const cur = l.currentItem()!;
          l.transition(cur.id, 'doing');
          l.transition(cur.id, 'verifying');
          l.transition(cur.id, 'done');
          const ev: HarnessEvent = {
            id: `e${prompts.length}`,
            ts: new Date().toISOString(),
            sessionId: 's1',
            type: 'turn_end',
            reason: 'completed',
          };
          return {
            events: (async function* () {
              yield ev;
            })(),
            engineSessionId: () => undefined,
            interrupt: async () => {},
            done: Promise.resolve({ exitCode: 0 }),
          };
        },
      };
      const inj = new SliceInjector(l);
      for await (const e of runWithStopGuard({
        engine,
        run: { sessionId: 's1', prompt: '시작', cwd: dir },
        guard: new StopGuard(l),
        preparePrompt: inj.preparePrompt,
      }))
        void e;
      expect(prompts).toHaveLength(2);
      expect(prompts[0]).toMatch(
        /^<harness-checklist>[\s\S]*현재 항목 1 [\s\S]*<\/harness-checklist>\n\n시작$/,
      );
      expect(prompts[1]).toContain('현재 항목 2 ');
      expect(prompts[1]).toMatch(/다음 항목 2: 항목 2 구현/);
    } finally {
      cleanup();
    }
  });
});
