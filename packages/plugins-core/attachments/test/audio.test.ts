import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { MESSAGES, convertAudio } from '../src/index.js';
import { addAndConvert, tempProject } from './helpers.js';
import { wav } from './samples.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});
const project = () => {
  const p = tempProject();
  cleanups.push(p.cleanup);
  return p.root;
};

describe('1B.7 소리: STT 플러그인으로 받아쓰기 (모킹)', () => {
  it('받아쓴 글이 transcript 형태로 남는다', async () => {
    const heard: string[] = [];
    const a = await addAndConvert(
      project(),
      '회의.wav',
      wav(),
      { audio: convertAudio },
      {
        transcribe: async (file) => {
          heard.push(file);
          return '  오늘 회의는 집값 이야기예요.  ';
        },
      },
    );
    expect(a.kind).toBe('audio');
    expect(heard).toEqual([a.storedPath]);
    const t = a.representations.find((r) => r.form === 'transcript')!;
    expect(readFileSync(t.path, 'utf8')).toBe('오늘 회의는 집값 이야기예요.\n');
    expect(a.warnings).toEqual([]);
  });

  it('받아쓰기 실패는 원본 유지 + 실패 안내', async () => {
    const a = await addAndConvert(
      project(),
      '회의.wav',
      wav(),
      { audio: convertAudio },
      {
        transcribe: async () => {
          throw new Error('whisper 실패');
        },
      },
    );
    expect(a.status).toBe('failed');
    expect(a.warnings.map((w) => w.message)).toEqual([MESSAGES.convertFailed]);
  });
});
