import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Attachment } from '@harness-x/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ArchiveSafetyError,
  AttachmentStore,
  ConversionQueue,
  DEFAULT_CONVERTERS,
  MESSAGES,
  extractArchive,
  type SecretCard,
} from '../src/index.js';
import { fakeTools, tempProject } from './helpers.js';

/** fixtures/attachments/files — node fixtures/attachments/make-fixtures.mjs 로 다시 만들 수 있다 */
const DIR = fileURLToPath(new URL('../../../../fixtures/attachments/files', import.meta.url));

const p = tempProject('hx-fix-');
const cards: SecretCard[] = [];
const done = new Map<string, Attachment>();
const needs: unknown[] = [];

beforeAll(async () => {
  const store = new AttachmentStore({ projectRoot: p.root });
  const q = new ConversionQueue({
    store,
    converters: DEFAULT_CONVERTERS,
    context: {
      tools: fakeTools(),
      onToolNeeded: (n) => needs.push(n),
      loadResizer: async () => undefined,
      transcribe: async () => '모킹 받아쓰기',
    },
    onSecret: (c) => cards.push(c),
  });
  for (const name of readdirSync(DIR).sort()) {
    const { attachment } = await store.add('fx', { name, path: join(DIR, name) });
    done.set(name, await q.enqueue(attachment));
  }
});
afterAll(() => p.cleanup());

const get = (n: string) => done.get(n)!;
const text = (n: string, form = 'text') =>
  readFileSync(get(n).representations.find((r) => r.form === form)!.path, 'utf8');
const codes = (n: string) => get(n).warnings.map((w) => w.code);

describe('1F.1 픽스처 fixtures/attachments/ 20종 이상 — pnpm test attachments', () => {
  it('픽스처가 20종 이상이고 전부 변환을 마쳤다 (실패해도 원본 유지)', () => {
    expect(done.size).toBeGreaterThanOrEqual(20);
    for (const [n, a] of done) {
      expect(['ready', 'failed'], n).toContain(a.status);
      expect(existsSync(a.storedPath), n).toBe(true);
    }
  });

  it('글: CP949 → UTF-8, UTF-16 → UTF-8', () => {
    expect(text('cp949.txt')).toBe('안녕하세요 똠방각하\n');
    expect(text('utf16.txt')).toBe('유니코드 메모\n');
  });

  it('PDF: 일반은 글, 스캔은 페이지 그림 + 안내 + 글자 인식 도구 카드', () => {
    expect(text('report.pdf')).toContain('Annual report 2026 summary');
    expect(get('scanned.pdf').representations.filter((r) => r.form === 'page-image')).toHaveLength(2);
    expect(codes('scanned.pdf')).toEqual(['scanned-pdf', 'tool-needed']);
  });

  it('한글·오피스: HWPX 글, HWP 도구 없음 카드, 3시트 XLSX 표, DOCX·PPTX 글', () => {
    expect(text('plan.hwpx')).toBe('한글 기획서\n\n목표: 집값 분석 화면\n');
    expect(get('old.hwp').warnings[0]!.message).toBe(MESSAGES.hwpToolMissing);
    const x = text('three-sheets.xlsx');
    expect(x.match(/## 시트: /g)).toHaveLength(3);
    expect(x).toContain('| 마포 | 12 |');
    expect(text('memo.docx')).toBe('# 회의록\n\n다음 주까지 화면 시안\n');
    expect(text('deck.pptx')).toBe('## 슬라이드 1\n\n첫 장\n\n## 슬라이드 2\n\n둘째 장\n');
  });

  it('그림: GPS·tEXt 제거, 확장자 위장(.txt인데 PNG)은 그림으로', () => {
    expect(readFileSync(get('gps.jpg').storedPath).includes('GPS')).toBe(false);
    expect(readFileSync(get('meta.png').storedPath).includes('GPS')).toBe(false);
    expect(codes('gps.jpg')).toEqual(['exif-removed']);
    expect(get('disguised.txt')).toMatchObject({ kind: 'image', mime: 'image/png' });
  });

  it('소리·동영상: 받아쓰기·ffmpeg 없으면 안내 (모킹 도구 없음)', () => {
    expect(get('voice.wav').kind).toBe('audio');
    expect(text('voice.wav', 'transcript')).toBe('모킹 받아쓰기\n');
    expect(get('clip.mp4').kind).toBe('video');
    expect(codes('clip.mp4')).toEqual(['tool-needed']);
    expect(needs.map((n) => (n as { capability: string }).capability)).toEqual(
      expect.arrayContaining([
        '그림 속 한글 글자 읽기',
        'HWP 문서에서 글 뽑기',
        '동영상에서 장면과 소리 뽑기',
      ]),
    );
  });

  it('압축: 폭탄·경로 탈출은 경고 + 풀기 거절, tar.gz는 목록', () => {
    expect(codes('bomb.zip')).toContain('bomb');
    expect(codes('traversal.zip')).toContain('unsafe-path');
    expect(() => extractArchive(get('bomb.zip'), join(p.root, 'x1'))).toThrow(ArchiveSafetyError);
    expect(() => extractArchive(get('traversal.zip'), join(p.root, 'x2'))).toThrow(ArchiveSafetyError);
    expect(text('bundle.tar.gz', 'listing')).toContain('- docs/b.md');
  });

  it('비밀·실행 파일·알 수 없음', () => {
    expect(codes('sample.env')).toContain('secret-found');
    expect(cards.map((c) => c.attachmentId)).toContain(get('sample.env').id);
    expect(codes('run.sh')).toContain('not-executed');
    expect(codes('setup.exe')).toEqual(['not-executed']);
    expect(get('unknown.bin')).toMatchObject({ kind: 'unknown', representations: [] });
  });
});
