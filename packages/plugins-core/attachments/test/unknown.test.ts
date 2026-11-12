import type { Attachment } from '@harness-x/protocol';
import { checkPlainKorean } from '@harness-x/approvals';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONVERTERS, MESSAGES } from '../src/index.js';
import { addAndConvert, tempProject } from './helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

/** 스냅샷용: 임시 폴더·해시·시각을 고정 글자로 */
function stable(a: Attachment, root: string) {
  return JSON.parse(
    JSON.stringify(a)
      .split(root)
      .join('<project>')
      .replaceAll(a.sha256, '<sha256>')
      .replaceAll(a.sha256.slice(0, 12), '<hash12>')
      .replace(/"createdAt":"[^"]+"/, '"createdAt":"<time>"'),
  );
}

describe('1B.11 알 수 없는 파일: 메타데이터만 + 안내', () => {
  it('형식을 모르는 바이너리는 이름·크기·형식만 남기고 안내한다 (스냅샷)', async () => {
    const p = tempProject();
    cleanups.push(p.cleanup);
    const junk = Buffer.from(Array.from({ length: 64 }, (_v, i) => (i * 37 + 1) % 256));
    const a = await addAndConvert(p.root, '설계도.dwg', junk, DEFAULT_CONVERTERS);
    expect(a.kind).toBe('unknown');
    expect(a.representations).toEqual([]);
    expect(checkPlainKorean(MESSAGES.unknownFile).ok).toBe(true);
    expect(stable(a, p.root)).toMatchSnapshot();
  });
});
