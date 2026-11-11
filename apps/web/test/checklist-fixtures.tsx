import type { HarnessEvent } from '@harness-x/protocol';
import { useEffect, useState } from 'react';
import type { ChecklistApi } from '../src/panels/Checklist/api.js';
import { ChecklistPanel, type ChecklistPanelProps } from '../src/panels/Checklist/ChecklistPanel.js';
import type { ChecklistItem, ChecklistView } from '../src/panels/Checklist/model.js';

export const S = 's-ck';
const TS = '2026-11-10T00:00:00.000Z';

const item = (id: string, extra: Partial<ChecklistItem> = {}): ChecklistItem => ({
  id,
  parent: null,
  title: `항목 ${id}`,
  owner: null,
  deps: [],
  artifactId: `art.item-${id.replace(/\./g, '-')}`,
  acceptance: [{ type: 'test', run: `pnpm test item-${id}`, expectExit: 0 }],
  status: 'todo',
  attempts: 0,
  evidence: [],
  ...extra,
});

export const ITEMS: ChecklistItem[] = [
  item('1', {
    title: '모바일 앱 폴더 생성',
    artifactId: 'art.mobile-app',
    status: 'done',
    attempts: 1,
    acceptance: [{ type: 'file_exists' }, { type: 'symbol', symbol: 'MobileApp', file: 'src/index.ts' }],
    evidence: [
      { kind: 'test_run', ts: '2026-11-10T00:01:02.000Z', summary: 'pnpm test mobile 통과' },
      {
        kind: 'ladder_verdict',
        ts: '2026-11-10T00:01:03.000Z',
        summary: 'L3 relocated (0.8)',
        level: 3,
        verdict: 'relocated',
        confidence: 0.8,
        reason: '내용 증거 통과: ai/mobile에서 acceptance 2/2',
        expectedPath: 'harness/mobile',
        actualPath: 'ai/mobile',
        escalate: true,
        candidates: [],
      },
      {
        kind: 'ladder_verdict',
        ts: '2026-11-10T00:01:04.000Z',
        summary: 'L4 equal (0.93)',
        level: 4,
        decision: 'accept',
        verdict: 'equal',
        confidence: 0.93,
        reason: 'AI 판단: 같은 산출물 p=0.93, 동치',
        expectedPath: 'harness/mobile',
        actualPath: 'ai/mobile',
        escalate: false,
        candidates: [],
      },
    ],
    verdict: { level: 4, verdict: 'equal', confidence: 0.93, reason: 'AI 판단: 같은 산출물 p=0.93, 동치' },
  }),
  item('1.1', { parent: '1', title: '앱 진입점 작성', status: 'done', attempts: 1 }),
  item('2', { title: '로그인 화면 구현', status: 'doing', attempts: 1, deps: ['1'] }),
  item('2.1', { parent: '2', title: '로그인 폼 검증 추가', deps: ['2'] }),
  item('3', { title: '배포 스크립트 작성', deps: ['2'] }),
];

export function view(extra: Partial<ChecklistView> = {}, items: ChecklistItem[] = ITEMS): ChecklistView {
  return {
    sessionId: S,
    checklist: { revision: 1, version: 7, updatedAt: TS, items },
    currentItemId: '2',
    plan: {
      locked: true,
      lockedAt: TS,
      revision: 1,
      artifacts: { 'art.mobile-app': { displayName: '하네스/모바일', path: 'harness/mobile', kind: 'dir' } },
    },
    lint: { ok: true, violations: [] },
    ...extra,
  };
}

export const ev = (n: number, body: Record<string, unknown>): HarnessEvent =>
  ({ id: `e${n}`, ts: TS, sessionId: S, ...body }) as HarnessEvent;

export interface FakeApi extends ChecklistApi {
  calls: { method: string; args: unknown[] }[];
}

export function fakeApi(over: Partial<ChecklistApi> = {}): FakeApi {
  const calls: FakeApi['calls'] = [];
  const rec =
    <A extends unknown[], R>(method: string, fn: (...a: A) => Promise<R>) =>
    (...a: A) => {
      calls.push({ method, args: a });
      return fn(...a);
    };
  return {
    calls,
    get: rec('get', over.get ?? (async () => view())),
    lock: rec('lock', over.lock ?? (async () => ({ status: 'locked' as const, revision: 1, artifacts: {} }))),
    resolveApproval: rec('resolveApproval', over.resolveApproval ?? (async () => ({ ok: true }))),
  };
}

/** 가짜 이벤트 스트림: emit()으로 넣은 이벤트가 App처럼 events 배열 끝에 붙는다 */
export class FakeEventStream {
  private listener: ((e: HarnessEvent) => void) | undefined;
  subscribe(fn: (e: HarnessEvent) => void) {
    this.listener = fn;
    return () => {
      this.listener = undefined;
    };
  }
  emit(e: HarnessEvent) {
    this.listener?.(e);
  }
}

export function StreamedPanel({
  stream,
  initial = [],
  ...props
}: { stream: FakeEventStream; initial?: HarnessEvent[] } & Omit<ChecklistPanelProps, 'events'>) {
  const [events, setEvents] = useState<HarnessEvent[]>(initial);
  useEffect(() => stream.subscribe((e) => setEvents((xs) => [...xs, e])), [stream]);
  return <ChecklistPanel events={events} {...props} />;
}
