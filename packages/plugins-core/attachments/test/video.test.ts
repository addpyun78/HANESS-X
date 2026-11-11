import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_VIDEO_FRAMES, MESSAGES, convertVideo } from '../src/index.js';
import { addAndConvert, fakeTools, tempProject } from './helpers.js';
import { mp4 } from './samples.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});
const project = () => {
  const p = tempProject();
  cleanups.push(p.cleanup);
  return p.root;
};

describe('1B.8 동영상: ffmpeg 있으면 장면 최대 8장 + 소리 받아쓰기, 없으면 도구 찾기 카드 (모킹)', () => {
  it('ffmpeg 있음: 장면 그림(10장 나와도 8장까지) + 받아쓰기', async () => {
    const tools = fakeTools({
      ffmpeg: (args) => {
        const out = args.at(-1)!;
        if (out.includes('frame-%02d'))
          for (let i = 1; i <= 10; i++) writeFileSync(out.replace('%02d', String(i).padStart(2, '0')), 'jpg');
        else writeFileSync(out, 'wav');
      },
    });
    const a = await addAndConvert(
      project(),
      '시연.mp4',
      mp4(),
      { video: convertVideo },
      {
        tools,
        transcribe: async (file) => {
          expect(file.endsWith(join('audio.wav'))).toBe(true);
          return '화면을 누르면 열려요';
        },
      },
    );
    expect(a.kind).toBe('video');
    expect(tools.calls).toHaveLength(2);
    expect(tools.calls[0]!.args).toContain('-frames:v');
    expect(tools.calls[0]!.args).toContain(String(MAX_VIDEO_FRAMES));
    expect(tools.calls[1]!.args).toEqual(expect.arrayContaining(['-vn', '-ar', '16000']));
    const frames = a.representations.filter((r) => r.form === 'frame');
    expect(frames.map((f) => f.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const t = a.representations.find((r) => r.form === 'transcript')!;
    expect(readFileSync(t.path, 'utf8')).toBe('화면을 누르면 열려요\n');
  });

  it('ffmpeg 없음: 아무것도 실행하지 않고 안내 + 도구 찾기 카드', async () => {
    const tools = fakeTools();
    const needs: unknown[] = [];
    const a = await addAndConvert(
      project(),
      '시연.mp4',
      mp4(),
      { video: convertVideo },
      {
        tools,
        onToolNeeded: (n) => needs.push(n),
      },
    );
    expect(tools.calls).toEqual([]);
    expect(a.representations).toEqual([]);
    expect(a.warnings.map((w) => w.message)).toEqual([MESSAGES.videoToolMissing]);
    expect(needs).toEqual([expect.objectContaining({ capability: '동영상에서 장면과 소리 뽑기' })]);
  });
});
