import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

/**
 * ZIP 읽기·쓰기 (새 npm 패키지 없이 node:zlib만). DOCX·PPTX·XLSX·HWPX·zip 첨부가 쓴다.
 * 읽기는 중앙 디렉터리(파일 끝) 기준 — 로컬 헤더의 크기는 믿지 않는다.
 */

export interface ZipEntry {
  name: string;
  /** 0 = 저장, 8 = deflate */
  method: number;
  compressedSize: number;
  /** 중앙 디렉터리에 적힌 풀린 크기 (거짓일 수 있음) */
  size: number;
  crc: number;
  isDir: boolean;
  /** 로컬 헤더 위치 */
  offset: number;
}

export class ZipError extends Error {
  constructor(
    message: string,
    readonly code: 'not-zip' | 'corrupt' | 'unsupported' | 'too-large' | 'encrypted',
  ) {
    super(message);
    this.name = 'ZipError';
  }
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

export function isZip(buf: Uint8Array): boolean {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

function findEocd(buf: Buffer): number {
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i--) if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  return -1;
}

/** 중앙 디렉터리의 항목 목록 */
export function listZip(buf: Buffer): ZipEntry[] {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new ZipError('압축 파일 끝 정보를 찾지 못했어요', 'not-zip');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN_SIG)
      throw new ZipError('압축 파일 목록이 망가졌어요', 'corrupt');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString(flags & 0x800 ? 'utf8' : 'latin1');
    if (flags & 1) throw new ZipError('암호가 걸린 압축 파일이에요', 'encrypted');
    out.push({ name, method, compressedSize, size, crc, isDir: name.endsWith('/'), offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** 항목 하나 풀기. maxBytes를 넘게 풀리면(압축 폭탄) 멈춘다 */
export function readZipEntry(buf: Buffer, e: ZipEntry, maxBytes = 256 * 1024 * 1024): Buffer {
  if (buf.readUInt32LE(e.offset) !== LOC_SIG) throw new ZipError('압축 파일 항목이 망가졌어요', 'corrupt');
  const nameLen = buf.readUInt16LE(e.offset + 26);
  const extraLen = buf.readUInt16LE(e.offset + 28);
  const start = e.offset + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + e.compressedSize);
  if (e.method === 0) {
    if (data.length > maxBytes) throw new ZipError('압축을 풀면 너무 커요', 'too-large');
    return Buffer.from(data);
  }
  if (e.method !== 8) throw new ZipError(`지원하지 않는 압축 방식(${e.method})이에요`, 'unsupported');
  try {
    return inflateRawSync(data, { maxOutputLength: maxBytes });
  } catch (err) {
    if ((err as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE')
      throw new ZipError('압축을 풀면 너무 커요', 'too-large');
    throw new ZipError('압축 파일 항목이 망가졌어요', 'corrupt');
  }
}

/** 이름으로 항목 찾아 풀기 (없으면 undefined) */
export function readZipFile(buf: Buffer, name: string, entries = listZip(buf)): Buffer | undefined {
  const e = entries.find((x) => x.name === name);
  return e ? readZipEntry(buf, e) : undefined;
}

export interface ZipInputFile {
  name: string;
  data: Buffer | string;
  /** 기본 deflate */
  store?: boolean;
}

/** 작은 ZIP 만들기 (테스트·픽스처용) */
export function createZip(files: readonly ZipInputFile[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const raw = typeof f.data === 'string' ? Buffer.from(f.data, 'utf8') : f.data;
    const method = f.store ? 0 : 8;
    const body = method === 8 ? deflateRawSync(raw) : raw;
    const name = Buffer.from(f.name, 'utf8');
    const crc = crc32(raw);
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(LOC_SIG, 0);
    loc.writeUInt16LE(20, 4);
    loc.writeUInt16LE(0x800, 6);
    loc.writeUInt16LE(method, 8);
    loc.writeUInt32LE(crc, 14);
    loc.writeUInt32LE(body.length, 18);
    loc.writeUInt32LE(raw.length, 22);
    loc.writeUInt16LE(name.length, 26);
    locals.push(loc, name, body);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(CEN_SIG, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x800, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    centrals.push(cen, name);
    offset += loc.length + name.length + body.length;
  }
  const cenBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cenBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cenBuf, eocd]);
}
