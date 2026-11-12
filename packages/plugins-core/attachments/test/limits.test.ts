import { checkPlainKorean } from '@harness-x/approvals';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ATTACHMENT_SETTINGS,
  AttachmentLimitError,
  MESSAGES,
  checkBatchLimit,
  resolveLimits,
} from '../src/index.js';
import { makeStore, tempProject } from './helpers.js';

const MB = 1024 * 1024;
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

describe('1A.5 크기 한도(설정): 파일당 200MB, 한 번에 1GB, 초과 시 쉬운 말 안내', () => {
  it('기본값은 200MB / 1GB이고 설정 목록에 올라 있다', () => {
    const l = resolveLimits();
    expect(l.maxFileMB).toBe(200);
    expect(l.maxBatchMB).toBe(1024);
    expect(ATTACHMENT_SETTINGS.map((s) => s.key)).toEqual(
      expect.arrayContaining(['attachments.maxFileMB', 'attachments.maxBatchMB']),
    );
  });

  it('파일 하나가 200MB를 넘으면 쉬운 말로 거절 (200MB 정확히는 통과)', () => {
    const l = resolveLimits();
    expect(() => checkBatchLimit([200 * MB], l)).not.toThrow();
    try {
      checkBatchLimit([200 * MB + 1], l);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AttachmentLimitError);
      expect((e as AttachmentLimitError).code).toBe('file-too-big');
      expect((e as Error).message).toBe('파일이 너무 커요. 한 파일은 200MB까지 넣을 수 있어요.');
      expect(checkPlainKorean((e as Error).message).ok).toBe(true);
    }
  });

  it('한 번에 1GB를 넘으면 거절 (각 파일은 한도 안)', () => {
    const l = resolveLimits();
    expect(() => checkBatchLimit([200 * MB, 200 * MB, 200 * MB, 200 * MB, 200 * MB], l)).not.toThrow();
    expect(() => checkBatchLimit([200 * MB, 200 * MB, 200 * MB, 200 * MB, 200 * MB, 25 * MB], l)).toThrow(
      MESSAGES.batchTooBig(1024),
    );
    expect(MESSAGES.batchTooBig(1024)).toContain('1GB');
    expect(checkPlainKorean(MESSAGES.batchTooBig(1024)).ok).toBe(true);
  });

  it('설정으로 바꾼 한도를 저장소가 그대로 쓴다 (넘으면 아무것도 저장 안 함)', async () => {
    const p = tempProject();
    cleanups.push(p.cleanup);
    const store = makeStore(p.root, { limits: { maxFileMB: 1, maxBatchMB: 2 } });
    await expect(store.add('s', { name: 'big.bin', data: Buffer.alloc(MB + 1) })).rejects.toThrow(
      '한 파일은 1MB까지',
    );
    await expect(
      store.addMany('s', [
        { name: 'a.bin', data: Buffer.alloc(MB) },
        { name: 'b.bin', data: Buffer.alloc(MB) },
        { name: 'c.bin', data: Buffer.alloc(10) },
      ]),
    ).rejects.toThrow('한 번에 2MB까지');
    expect(store.list('s')).toEqual([]);
  });
});
