import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { MESSAGES, convertImage, imageSize, stripJpegMetadata, stripPngMetadata } from '../src/index.js';
import { addAndConvert, tempProject } from './helpers.js';
import { jpeg, png } from './samples.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});
const project = () => {
  const p = tempProject();
  cleanups.push(p.cleanup);
  return p.root;
};
const hasGps = (b: Buffer) => b.includes('GPS') || b.includes('Exif');

describe('1B.6 그림: 원본 + 긴 변 2000px 축소본, 위치정보(EXIF) 제거', () => {
  it('GPS가 든 JPEG: 저장된 원본에서 APP1(Exif)이 사라지고 그림 본문은 그대로', async () => {
    const src = jpeg({ gps: true });
    expect(hasGps(src)).toBe(true);
    const a = await addAndConvert(project(), '현장.jpg', src, { image: convertImage });
    const saved = readFileSync(a.storedPath);
    expect(hasGps(saved)).toBe(false);
    expect(saved.equals(jpeg())).toBe(true);
    expect(a.warnings.map((w) => w.message)).toEqual([MESSAGES.exifRemoved]);
    // 해시는 받은 파일 기준 (같은 파일을 다시 넣으면 재사용)
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('PNG의 eXIf·tEXt 청크도 지운다', () => {
    const src = png({ meta: true });
    expect(hasGps(src)).toBe(true);
    const clean = stripPngMetadata(src);
    expect(hasGps(clean)).toBe(false);
    expect(clean.equals(png())).toBe(true);
    expect(stripJpegMetadata(jpeg()).equals(jpeg())).toBe(true);
  });

  it('긴 변이 2000px을 넘으면 축소본, 줄이는 도구가 없으면 안내', async () => {
    const big = jpeg({ width: 4000, height: 3000 });
    expect(imageSize(big, 'image/jpeg')).toEqual({ width: 4000, height: 3000 });
    const sides: number[] = [];
    const a = await addAndConvert(
      project(),
      '큰사진.jpg',
      big,
      { image: convertImage },
      {
        loadResizer: async () => async (_input, maxSide) => {
          sides.push(maxSide);
          return { data: jpeg({ width: 2000, height: 1500 }), mime: 'image/jpeg' };
        },
      },
    );
    expect(sides).toEqual([2000]);
    const thumb = a.representations.find((r) => r.form === 'thumbnail')!;
    expect(imageSize(readFileSync(thumb.path), 'image/jpeg')).toEqual({ width: 2000, height: 1500 });

    const b = await addAndConvert(
      project(),
      '큰사진.jpg',
      big,
      { image: convertImage },
      {
        loadResizer: async () => undefined,
      },
    );
    expect(b.representations).toEqual([]);
    expect(b.warnings.map((w) => w.message)).toEqual([MESSAGES.thumbnailSkipped]);
  });

  it('작은 그림은 축소본을 만들지 않는다', async () => {
    const a = await addAndConvert(project(), '작은.png', png({ width: 800, height: 600 }), {
      image: convertImage,
    });
    expect(a.representations).toEqual([]);
    expect(a.warnings).toEqual([]);
  });
});
