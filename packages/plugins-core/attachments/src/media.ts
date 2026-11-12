import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AttachmentWarning, Representation } from '@harness-x/protocol';
import { detectWhisper, transcribeFile } from '@harness-x/stt-local';
import type { ConvertContext, Converter } from './context.js';
import { warn, writeRep } from './context.js';
import { MESSAGES } from './messages.js';
import { TOOL_NEEDS } from './tools.js';

/**
 * 1B.7 소리: STT 플러그인(T-100 음성 입력, stt-local whisper)으로 받아쓰기.
 * 1B.8 동영상: ffmpeg가 있으면 장면 그림 최대 8장 + 소리 추출 → 받아쓰기, 없으면 도구 찾기 카드.
 */

export const MAX_VIDEO_FRAMES = 8;

/** stt-local(whisper)이 설치돼 있으면 그 받아쓰기, 없으면 undefined */
export function defaultTranscriber(): ((file: string) => Promise<string>) | undefined {
  const w = detectWhisper();
  if (!w.available || !w.binary || !w.model) return undefined;
  const binary = w.binary;
  const model = w.model;
  return (file) => transcribeFile(file, { binary, model });
}

async function transcribeTo(
  ctx: ConvertContext,
  audioPath: string,
): Promise<{ rep?: Representation; warning?: AttachmentWarning }> {
  const t = ctx.transcribe ?? defaultTranscriber();
  if (!t) return { warning: warn('stt-missing', MESSAGES.sttMissing) };
  const text = (await t(audioPath)).trim();
  return { rep: writeRep(ctx, 'transcript', 'transcript.txt', text + '\n', 'text/plain; charset=utf-8') };
}

export const convertAudio: Converter = async (a, _data, ctx) => {
  const r = await transcribeTo(ctx, a.storedPath);
  return { representations: r.rep ? [r.rep] : [], warnings: r.warning ? [r.warning] : [] };
};

export const convertVideo: Converter = async (a, _data, ctx) => {
  const ffmpeg = ctx.tools.which('ffmpeg');
  if (!ffmpeg) {
    ctx.onToolNeeded?.({ ...TOOL_NEEDS.ffmpeg });
    return {
      representations: [],
      warnings: [warn('tool-needed', MESSAGES.videoToolMissing, TOOL_NEEDS.ffmpeg.capability)],
    };
  }
  const framesDir = join(ctx.dir, 'frames');
  mkdirSync(framesDir, { recursive: true });
  // 장면 그림: 장면이 바뀌는 곳 위주로 최대 8장, 긴 변 1280px
  await ctx.tools.run(ffmpeg, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    a.storedPath,
    '-vf',
    "select='gt(scene,0.3)+eq(n,0)',scale='min(1280,iw)':-2",
    '-vsync',
    'vfr',
    '-frames:v',
    String(MAX_VIDEO_FRAMES),
    join(framesDir, 'frame-%02d.jpg'),
  ]);
  const representations: Representation[] = readdirSync(framesDir)
    .filter((f) => /^frame-\d+\.jpg$/.test(f))
    .sort()
    .slice(0, MAX_VIDEO_FRAMES)
    .map((f, i) => {
      const path = join(framesDir, f);
      return {
        form: 'frame' as const,
        path,
        mime: 'image/jpeg',
        sizeBytes: statSync(path).size,
        index: i + 1,
      };
    });
  const warnings: AttachmentWarning[] = [];
  const audio = join(ctx.dir, 'audio.wav');
  const ex = await ctx.tools.run(ffmpeg, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    a.storedPath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    audio,
  ]);
  if (ex.code === 0) {
    const r = await transcribeTo(ctx, audio);
    if (r.rep) representations.push(r.rep);
    if (r.warning) warnings.push(r.warning);
  }
  return { representations, warnings };
};
