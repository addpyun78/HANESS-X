import { AttachmentSchema, attachmentId, parseAttachment, representation } from '@harness-x/protocol';
import { describe, expect, it } from 'vitest';

const sha = 'a'.repeat(64);
const base = {
  id: attachmentId(sha),
  sha256: sha,
  originalName: '기획서.hwpx',
  sizeBytes: 1234,
  mime: 'application/hwp+zip',
  kind: 'hwpx',
  storedPath: '/p/.harness-x/attachments/s/aaaaaaaaaaaa/original.hwpx',
  representations: [
    {
      form: 'text',
      path: '/p/.harness-x/attachments/s/aaaaaaaaaaaa/text.md',
      mime: 'text/markdown',
      sizeBytes: 10,
    },
  ],
  warnings: [{ code: 'tool-needed', message: '도구가 없어요.', capability: 'HWP 문서에서 글 뽑기' }],
};

describe('1A.3 Attachment { id, sha256, originalName, sizeBytes, mime, kind, storedPath, representations[], warnings[] }', () => {
  it('정상 값은 통과하고 상태 기본값은 converting', () => {
    const a = parseAttachment(base);
    expect(a.id).toBe('att_aaaaaaaaaaaa');
    expect(a.status).toBe('converting');
    expect(representation(a, 'text')?.path).toMatch(/text\.md$/);
    expect(Object.keys(AttachmentSchema.shape)).toEqual(
      expect.arrayContaining([
        'id',
        'sha256',
        'originalName',
        'sizeBytes',
        'mime',
        'kind',
        'storedPath',
        'representations',
        'warnings',
      ]),
    );
  });

  it.each([
    ['id 모양', { id: 'x1' }],
    ['sha256 길이', { sha256: 'abc' }],
    ['음수 크기', { sizeBytes: -1 }],
    ['없는 종류', { kind: 'movie' }],
    ['없는 형태', { representations: [{ form: 'blob', path: '/a', mime: 'x', sizeBytes: 1 }] }],
    ['빈 안내', { warnings: [{ code: 'x', message: '' }] }],
    ['모르는 필드', { extra: 1 }],
  ])('잘못된 값 거부: %s', (_name, patch) => {
    expect(AttachmentSchema.safeParse({ ...base, ...patch }).success).toBe(false);
  });

  it('필수 필드가 빠지면 거부', () => {
    for (const k of ['id', 'sha256', 'originalName', 'sizeBytes', 'mime', 'kind', 'storedPath'] as const) {
      const v: Record<string, unknown> = { ...base };
      delete v[k];
      expect(AttachmentSchema.safeParse(v).success, k).toBe(false);
    }
  });
});
