import { describe, expect, it } from 'vitest';
import { checkPlainKorean } from '@harness-x/approvals';
import type { ResumableSession } from '../src/resume.js';
import {
  checkBeforeResume,
  defaultChoices,
  RESUME_CHECK_IDS,
  type ResumeIssue,
} from '../src/resume-check.js';

const NOW = new Date('2026-11-12T12:00:00.000Z');
const session = (at = '2026-11-12T09:00:00.000Z'): ResumableSession => ({
  sessionId: 's1',
  projectId: 'p1',
  title: '/qa 헤더',
  agent: null,
  engineId: 'codex',
  progress: 0.5,
  paused: { reason: 'user', at, by: 'user' },
  startedAt: null,
});

/** 문제가 없는 기본 사실 */
const fine = {
  now: NOW,
  fileChanges: () => [],
  isGit: () => true,
  engineAvailable: () => true,
  changedSinceStart: () => [],
  pendingApprovals: () => [],
  doneItems: () => [],
  conflicts: () => [],
};

function expectPlain(i: ResumeIssue) {
  for (const t of [i.title, i.body]) expect(checkPlainKorean(t).violations).toEqual([]);
  for (const c of i.choices) expect(checkPlainKorean(c.label, { label: true }).violations).toEqual([]);
}

describe('2B.3 재개 전 점검기 (6가지)', () => {
  it('문제가 없으면 묻지 않고 바로 이어함 (6가지 모두 점검)', () => {
    const r = checkBeforeResume(session(), fine);
    expect(r).toEqual({ sessionId: 's1', ok: true, issues: [], checked: [...RESUME_CHECK_IDS] });
  });

  it('① 파일이 바뀜 → 목록 + 3선택 (Git이 아니면 되돌리기 없음)', () => {
    const changes = [
      { path: 'src/a.ts', change: 'modified' as const },
      { path: 'b.md', change: 'added' as const },
    ];
    const r = checkBeforeResume(session(), { ...fine, fileChanges: () => changes });
    expect(r.ok).toBe(false);
    const [i] = r.issues;
    expect(i!.check).toBe('files');
    expect(i!.list).toEqual(['src/a.ts (고쳐짐)', 'b.md (새로 생김)']);
    expect(i!.choices.map((c) => c.label)).toEqual([
      '바뀐 걸 반영해서 계속',
      '멈춘 때로 되돌리고 계속',
      '계획부터 다시',
    ]);
    expect(i!.choices[0]!.recommended).toBe(true);
    const noGit = checkBeforeResume(session(), { ...fine, isGit: () => false, fileChanges: () => changes });
    expect(noGit.issues[0]!.choices.map((c) => c.id)).toEqual(['keep', 'replan']);
    expectPlain(i!);
  });

  it('② 그때 쓰던 AI를 못 씀 → 다른 AI·폴백 제안', () => {
    const r = checkBeforeResume(session(), {
      ...fine,
      engineAvailable: (id) => id !== 'codex',
      engineSuggestions: () => ['claude-code', 'openai-compat:ollama'],
    });
    const [i] = r.issues;
    expect(i!.check).toBe('engine');
    expect(i!.choices.map((c) => c.id)).toEqual([
      'engine:claude-code',
      'engine:openai-compat:ollama',
      'wait',
    ]);
    expect(i!.choices[0]!.default).toBe(true);
    expectPlain(i!);
  });

  it('③ 에이전트·설정이 바뀜 → [시작할 때 버전으로 계속(기본)] [새 버전으로]', () => {
    const r = checkBeforeResume(session(), { ...fine, changedSinceStart: () => ['agent.yaml'] });
    const [i] = r.issues;
    expect(i!.check).toBe('version');
    expect(i!.choices).toEqual([
      { id: 'pinned', label: '시작할 때 버전으로 계속', default: true },
      { id: 'latest', label: '새 버전으로' },
    ]);
    expectPlain(i!);
  });

  it('④ 대답 안 한 승인 카드 → 카드 먼저 (기본값으로 넘어갈 수 없음)', () => {
    const r = checkBeforeResume(session(), {
      ...fine,
      pendingApprovals: () => [{ id: 'a1', title: '파일을 지워도 될까요?' }],
    });
    const [i] = r.issues;
    expect(i!.check).toBe('approvals');
    expect(i!.blocking).toBe(true);
    expect(i!.list).toEqual(['파일을 지워도 될까요?']);
    expect(defaultChoices(r.issues)).toEqual({});
    expectPlain(i!);
  });

  it('⑤ 7일 이상 → 지금까지 한 일 요약 확인 (6일은 묻지 않음)', () => {
    const six = checkBeforeResume(session('2026-11-06T12:00:01.000Z'), fine);
    expect(six.ok).toBe(true);
    const r = checkBeforeResume(session('2026-11-05T12:00:00.000Z'), {
      ...fine,
      doneItems: () => [{ id: 'I-1', title: '로그인 화면 만들기' }],
    });
    const [i] = r.issues;
    expect(i!.check).toBe('stale');
    expect(i!.body).toBe('멈춘 지 7일이 지났어요. 지금까지 1개를 끝냈어요. 이대로 이어할까요?');
    expect(i!.list).toEqual(['끝냄: 로그인 화면 만들기']);
    expectPlain(i!);
  });

  it('⑥ 다른 실행 중 세션이 같은 파일을 씀 → 기다릴지', () => {
    const r = checkBeforeResume(session(), {
      ...fine,
      conflicts: () => [{ sessionId: 's9', title: '/qa 푸터', paths: ['src/a.ts'] }],
    });
    const [i] = r.issues;
    expect(i!.check).toBe('conflict');
    expect(i!.list).toEqual(['src/a.ts']);
    expect(defaultChoices(r.issues)).toEqual({ conflict: 'wait' });
    expectPlain(i!);
  });

  it('여러 문제가 겹치면 표 순서대로', () => {
    const r = checkBeforeResume(session('2026-10-01T00:00:00.000Z'), {
      ...fine,
      fileChanges: () => [{ path: 'x', change: 'deleted' }],
      engineAvailable: () => false,
      changedSinceStart: () => ['pipeline'],
      pendingApprovals: () => [{ id: 'a', title: 't' }],
      conflicts: () => [{ sessionId: 's9', title: 't', paths: ['x'] }],
    });
    expect(r.issues.map((i) => i.check)).toEqual([...RESUME_CHECK_IDS]);
  });
});
