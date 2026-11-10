import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildCheckpoint,
  exportSession,
  harnessV2CheckpointJsonSchema,
  HarnessV2CheckpointSchema,
  renderChecklistMarkdown,
} from '../src/export.js';
import { ChecklistLedger } from '../src/ledger.js';
import { ManifestStore } from '../src/manifest.js';
import { item, tempDir } from './helpers.js';

const SCHEMA_FILE = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../schemas/harness-v2-checkpoint.schema.json',
);
const T = () => new Date('2026-11-11T00:00:00.000Z');

/** 상태 6종이 모두 있는 고정 세션 */
function fixture(dir: string) {
  const l = new ChecklistLedger({ dir, sessionId: 's1', now: T, idGen: () => 'id' });
  l.create([
    item('1', { title: '모바일 앱', artifactId: 'art.mobile-app' }),
    item('1.1', { parent: '1', title: '로그인 화면', artifactId: 'art.mobile-app' }),
    item('1.2', { parent: '1', title: '비밀번호 검증', deps: ['1.1'] }),
    item('2', { title: 'API 서버' }),
    item('3', { title: '배포 스크립트' }),
    item('4', { title: '문서' }),
  ]);
  const go = (id: string) => {
    l.transition(id, 'doing');
    l.transition(id, 'verifying');
  };
  go('1.1');
  l.transition('1.1', 'done', {
    verdict: { level: 4, verdict: 'equal', confidence: 0.93, reason: 'ai/mobile ≡ harness/mobile (Jev)' },
  });
  go('2');
  l.transition('2', 'failed', { evidence: { kind: 'test_failed', summary: 'api.test.ts 2 failed' } });
  l.transition('3', 'blocked', { evidence: { kind: 'stall_blocked', summary: '정체: evidence 무변화 3턴' } });
  go('4');
  const m = new ManifestStore({ dir, sessionId: 's1', now: T, idGen: () => 'id' });
  m.setDraft('art.mobile-app', { displayName: '하네스/모바일', path: 'harness/mobile', kind: 'dir' });
  return { l, m };
}

describe('29.5 CHECKLIST.md 렌더러', () => {
  it('상태 아이콘·계층·판정 사유·실패/차단 사유 (스냅샷)', () => {
    const { dir, cleanup } = tempDir();
    try {
      const { l, m } = fixture(dir);
      const md = renderChecklistMarkdown(l.read(), { title: '하네스 모바일', manifest: m.read() });
      expect(md).toMatchSnapshot();
      expect(md).toContain('- ✅ **1.1** 로그인 화면');
      expect(md).toContain('판정: L4 equal (0.93) — ai/mobile ≡ harness/mobile (Jev)');
      expect(md).toContain('사유: api.test.ts 2 failed');
      expect(renderChecklistMarkdown(null)).toBe('# 체크리스트\n\n체크리스트 없음\n');
    } finally {
      cleanup();
    }
  });
});

describe('29.6 HARNESS v2 CHECKPOINT.json·MISSION.md', () => {
  it('저장소 스키마 파일이 HarnessV2CheckpointSchema와 일치 (스키마 드리프트 방지)', () => {
    const onDisk = JSON.parse(readFileSync(SCHEMA_FILE, 'utf8')) as unknown;
    expect(onDisk).toEqual(harnessV2CheckpointJsonSchema());
  });

  it('내보낸 CHECKPOINT.json이 스키마를 통과하고 필수 키·값이 맞다; MISSION.md·CHECKLIST.md 생성', () => {
    const { dir, cleanup } = tempDir();
    try {
      const { l, m } = fixture(dir);
      const out = join(dir, 'export');
      const files = exportSession(out, {
        sessionId: 's1',
        checklist: l.get(),
        manifest: m.read(),
        mission: {
          title: '하네스 모바일',
          goal: '모바일 로그인 흐름 완성',
          constraints: ['정식 경로에만 쓴다'],
        },
        now: T,
      });
      const cp = JSON.parse(readFileSync(files.checkpoint, 'utf8')) as unknown;
      const parsed = HarnessV2CheckpointSchema.parse(cp);
      // 스키마 대조: JSON Schema의 required 키가 모두 있다
      const js = harnessV2CheckpointJsonSchema() as {
        required: string[];
        properties: Record<string, unknown>;
      };
      for (const k of js.required) expect(cp).toHaveProperty(k);
      expect(Object.keys(cp as object).sort()).toEqual(Object.keys(js.properties).sort());
      expect(parsed).toMatchObject({
        format: 'harness-checkpoint',
        version: 2,
        createdAt: '2026-11-11T00:00:00.000Z',
        mission: { title: '하네스 모바일', file: 'MISSION.md' },
        progress: { total: 6, done: 1, remaining: 5 },
        currentItemId: '2',
        artifacts: { 'art.mobile-app': { path: 'harness/mobile', kind: 'dir' } },
      });
      expect(parsed.nextAction).toMatch(/^다음 항목 2: API 서버/);
      expect(parsed.items.find((i) => i.id === '1.1')).toMatchObject({
        path: 'harness/mobile',
        verdict: { level: 4, verdict: 'equal' },
      });
      expect(parsed.items.find((i) => i.id === '3')?.lastEvidence).toMatchObject({ kind: 'stall_blocked' });
      const mission = readFileSync(files.mission, 'utf8');
      expect(mission).toContain('# MISSION: 하네스 모바일');
      expect(mission).toContain('- 하네스/모바일 (art.mobile-app) → `harness/mobile`');
      expect(mission).toContain('다음: 2 API 서버');
      expect(existsSync(files.checklist)).toBe(true);
      // 잘못된 체크포인트는 거부
      expect(() => HarnessV2CheckpointSchema.parse({ ...parsed, version: 1 })).toThrow();
      expect(() => buildCheckpoint({ sessionId: '', checklist: l.get(), mission: { title: 'x' } })).toThrow();
    } finally {
      cleanup();
    }
  });
});
