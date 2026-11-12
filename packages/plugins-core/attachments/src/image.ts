import type { AttachmentWarning, Representation } from '@harness-x/protocol';
import type { Converter, ImageResizer } from './context.js';
import { warn, writeRep } from './context.js';
import { MESSAGES } from './messages.js';
import { writeAtomic } from './store.js';

/**
 * 1B.6 그림: 원본 + 긴 변 2000px 축소본, 위치정보 등 EXIF 제거(개인정보).
 * EXIF는 직접 잘라 낸다: JPEG APP1(Exif·XMP)·APP13(IPTC)·COM 구간, PNG eXIf·tEXt·zTXt·iTXt·tIME 청크,
 * WebP EXIF·XMP 청크. 저장된 원본 자체를 지운 것으로 바꾼다(엔진이 원본 경로를 읽어도 위치가 안 나가게).
 * 축소본은 sharp가 node_modules에 있을 때만(동적 import), 없으면 안내.
 */

export const THUMBNAIL_MAX_SIDE = 2000;

export function stripJpegMetadata(buf: Buffer): Buffer {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return buf;
  const parts: Buffer[] = [buf.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= buf.length && buf[i] === 0xff) {
    const marker = buf[i + 1]!;
    if (marker === 0xda) break; // 그림 본문 시작 — 나머지는 그대로
    const len = buf.readUInt16BE(i + 2);
    const drop = marker === 0xe1 || marker === 0xed || marker === 0xfe;
    if (!drop) parts.push(buf.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  parts.push(buf.subarray(i));
  return Buffer.concat(parts);
}

const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

export function stripPngMetadata(buf: Buffer): Buffer {
  const parts: Buffer[] = [buf.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.subarray(i + 4, i + 8).toString('latin1');
    const end = i + 12 + len;
    if (!PNG_DROP.has(type)) parts.push(buf.subarray(i, end));
    i = end;
    if (type === 'IEND') break;
  }
  // 망가진 꼬리는 그대로 둔다 (내용을 잃지 않게)
  if (i < buf.length && parts.length === 1) parts.push(buf.subarray(i));
  return Buffer.concat(parts);
}

export function stripWebpMetadata(buf: Buffer): Buffer {
  const parts: Buffer[] = [];
  let i = 12;
  while (i + 8 <= buf.length) {
    const type = buf.subarray(i, i + 4).toString('latin1');
    const len = buf.readUInt32LE(i + 4);
    const end = i + 8 + len + (len % 2);
    if (type !== 'EXIF' && type !== 'XMP ') {
      const chunk = Buffer.from(buf.subarray(i, end));
      if (type === 'VP8X') chunk[8] = chunk[8]! & ~0x0c; // EXIF·XMP 있음 표시 끄기
      parts.push(chunk);
    }
    i = end;
  }
  const body = Buffer.concat(parts);
  const head = Buffer.from(buf.subarray(0, 12));
  head.writeUInt32LE(body.length + 4, 4);
  return Buffer.concat([head, body]);
}

export function stripImageMetadata(buf: Buffer, mime: string): Buffer {
  if (mime === 'image/jpeg') return stripJpegMetadata(buf);
  if (mime === 'image/png') return stripPngMetadata(buf);
  if (mime === 'image/webp') return stripWebpMetadata(buf);
  return buf;
}

export function imageSize(buf: Buffer, mime: string): { width: number; height: number } | undefined {
  if (mime === 'image/png' && buf.length >= 24)
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (mime === 'image/gif' && buf.length >= 10)
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  if (mime === 'image/jpeg') {
    let i = 2;
    while (i + 9 <= buf.length && buf[i] === 0xff) {
      const m = buf[i + 1]!;
      const len = buf.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  }
  return undefined;
}

/** node_modules에 sharp가 있으면 그것으로 줄이기 (없으면 undefined) */
export async function loadSharpResizer(): Promise<ImageResizer | undefined> {
  try {
    const name = 'sharp';
    const mod = (await import(name)) as { default: (b: Buffer) => SharpLike };
    const sharp = mod.default;
    return async (input, maxSide) => ({
      data: await sharp(input)
        .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer(),
      mime: 'image/jpeg',
    });
  } catch {
    return undefined;
  }
}

interface SharpLike {
  resize(o: Record<string, unknown>): SharpLike;
  jpeg(o: Record<string, unknown>): SharpLike;
  toBuffer(): Promise<Buffer>;
}

export const convertImage: Converter = async (a, data, ctx) => {
  const warnings: AttachmentWarning[] = [];
  const representations: Representation[] = [];
  const clean = stripImageMetadata(data, a.mime);
  if (clean.length !== data.length) {
    writeAtomic(a.storedPath, clean);
    warnings.push(warn('exif-removed', MESSAGES.exifRemoved));
  }
  const size = imageSize(clean, a.mime);
  if (size && Math.max(size.width, size.height) > THUMBNAIL_MAX_SIDE) {
    const resize = await (ctx.loadResizer ?? loadSharpResizer)();
    if (resize) {
      const t = await resize(clean, THUMBNAIL_MAX_SIDE);
      representations.push(writeRep(ctx, 'thumbnail', 'thumbnail.jpg', t.data, t.mime));
    } else warnings.push(warn('thumbnail-skipped', MESSAGES.thumbnailSkipped));
  }
  return { representations, warnings };
};
