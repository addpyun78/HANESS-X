import { extname } from 'node:path';
import type { AttachmentKind } from '@harness-x/protocol';
import { isZip, listZip, readZipFile } from './zip.js';

/**
 * 1A.4 종류 인식: 파일 앞부분(매직 바이트)이 먼저, 확장자는 보조.
 * ZIP 묶음(DOCX·PPTX·XLSX·HWPX)은 안의 파일 이름으로 가른다.
 */

export interface DetectedType {
  kind: AttachmentKind;
  mime: string;
  /** 어떻게 알았는지 */
  by: 'magic' | 'container' | 'text' | 'extension' | 'none';
}

const EXT_MIME: Record<string, [AttachmentKind, string]> = {
  '.txt': ['text', 'text/plain'],
  '.md': ['text', 'text/markdown'],
  '.csv': ['text', 'text/csv'],
  '.tsv': ['text', 'text/tab-separated-values'],
  '.json': ['text', 'application/json'],
  '.yaml': ['text', 'application/yaml'],
  '.yml': ['text', 'application/yaml'],
  '.xml': ['text', 'application/xml'],
  '.html': ['text', 'text/html'],
  '.css': ['text', 'text/css'],
  '.js': ['text', 'text/javascript'],
  '.ts': ['text', 'text/x-typescript'],
  '.tsx': ['text', 'text/x-typescript'],
  '.py': ['text', 'text/x-python'],
  '.env': ['text', 'text/plain'],
  '.log': ['text', 'text/plain'],
  '.pdf': ['pdf', 'application/pdf'],
  '.docx': ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.pptx': ['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  '.xlsx': ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.hwpx': ['hwpx', 'application/hwp+zip'],
  '.hwp': ['hwp', 'application/x-hwp'],
  '.png': ['image', 'image/png'],
  '.jpg': ['image', 'image/jpeg'],
  '.jpeg': ['image', 'image/jpeg'],
  '.gif': ['image', 'image/gif'],
  '.webp': ['image', 'image/webp'],
  '.bmp': ['image', 'image/bmp'],
  '.mp3': ['audio', 'audio/mpeg'],
  '.wav': ['audio', 'audio/wav'],
  '.m4a': ['audio', 'audio/mp4'],
  '.ogg': ['audio', 'audio/ogg'],
  '.flac': ['audio', 'audio/flac'],
  '.mp4': ['video', 'video/mp4'],
  '.mov': ['video', 'video/quicktime'],
  '.webm': ['video', 'video/webm'],
  '.mkv': ['video', 'video/x-matroska'],
  '.avi': ['video', 'video/x-msvideo'],
  '.zip': ['archive', 'application/zip'],
  '.tar': ['archive', 'application/x-tar'],
  '.gz': ['archive', 'application/gzip'],
  '.tgz': ['archive', 'application/gzip'],
  '.7z': ['archive', 'application/x-7z-compressed'],
  '.rar': ['archive', 'application/vnd.rar'],
  '.exe': ['executable', 'application/vnd.microsoft.portable-executable'],
  '.dll': ['executable', 'application/vnd.microsoft.portable-executable'],
  '.msi': ['executable', 'application/x-msi'],
  '.bat': ['executable', 'text/x-bat'],
  '.cmd': ['executable', 'text/x-bat'],
  '.ps1': ['executable', 'text/x-powershell'],
  '.sh': ['executable', 'text/x-shellscript'],
};

/** 실행 가능한 글 파일 (내용은 글로 보여 주되 실행은 안 함) */
export const SCRIPT_EXTENSIONS = ['.bat', '.cmd', '.ps1', '.sh'] as const;

export function extOf(name: string): string {
  const base = name.toLowerCase();
  if (base === '.env' || base.startsWith('.env.')) return '.env';
  return extname(base);
}

export function byExtension(name: string): DetectedType | undefined {
  const hit = EXT_MIME[extOf(name)];
  return hit ? { kind: hit[0], mime: hit[1], by: 'extension' } : undefined;
}

const startsWith = (b: Uint8Array, sig: readonly number[], at = 0) =>
  b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, s: string, at = 0) =>
  startsWith(
    b,
    [...s].map((c) => c.charCodeAt(0)),
    at,
  );

function zipContainer(buf: Buffer): DetectedType {
  try {
    const names = listZip(buf).map((e) => e.name);
    const mimetype = names.includes('mimetype') ? readZipFile(buf, 'mimetype')?.toString('utf8').trim() : '';
    if (mimetype?.startsWith('application/hwp') || names.some((n) => /^Contents\/section\d+\.xml$/.test(n)))
      return { kind: 'hwpx', mime: 'application/hwp+zip', by: 'container' };
    if (names.some((n) => n.startsWith('word/')))
      return { kind: 'docx', mime: EXT_MIME['.docx']![1], by: 'container' };
    if (names.some((n) => n.startsWith('ppt/')))
      return { kind: 'pptx', mime: EXT_MIME['.pptx']![1], by: 'container' };
    if (names.some((n) => n.startsWith('xl/')))
      return { kind: 'xlsx', mime: EXT_MIME['.xlsx']![1], by: 'container' };
  } catch {
    /* 망가진 zip도 압축 파일로 본다 */
  }
  return { kind: 'archive', mime: 'application/zip', by: 'magic' };
}

/** NUL이 없고 UTF-8/UTF-16/EUC-KR 중 하나로 읽히면 글 */
export function looksLikeText(b: Uint8Array): boolean {
  const head = b.subarray(0, 8192);
  if (head.length === 0) return true;
  if (startsWith(head, [0xff, 0xfe]) || startsWith(head, [0xfe, 0xff])) return true;
  if (head.includes(0)) return false;
  let ctrl = 0;
  for (const c of head) if (c < 9 || (c > 13 && c < 32)) ctrl++;
  if (ctrl / head.length > 0.05) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head.subarray(0, safeUtf8Cut(head)));
    return true;
  } catch {
    try {
      new TextDecoder('euc-kr', { fatal: true }).decode(head.subarray(0, safeEucCut(head)));
      return true;
    } catch {
      return false;
    }
  }
}

/** 앞부분만 자를 때 UTF-8 글자 중간에서 끊기지 않게 */
function safeUtf8Cut(b: Uint8Array): number {
  let n = b.length;
  for (let i = 0; i < 4 && n > 0; i++) {
    const c = b[n - 1]!;
    if (c < 0x80) break;
    n--;
    if (c >= 0xc0) break;
  }
  return n;
}

function safeEucCut(b: Uint8Array): number {
  let n = 0;
  while (n < b.length) {
    if (b[n]! < 0x80) n++;
    else if (n + 1 < b.length) n += 2;
    else break;
  }
  return n;
}

function mp4Brand(b: Uint8Array): DetectedType | undefined {
  if (!ascii(b, 'ftyp', 4)) return undefined;
  const brand = Buffer.from(b.subarray(8, 12)).toString('latin1');
  if (/^M4A|^M4B|^F4A/.test(brand)) return { kind: 'audio', mime: 'audio/mp4', by: 'magic' };
  if (brand.startsWith('qt')) return { kind: 'video', mime: 'video/quicktime', by: 'magic' };
  if (/^heic|^heix|^mif1/.test(brand)) return { kind: 'image', mime: 'image/heic', by: 'magic' };
  return { kind: 'video', mime: 'video/mp4', by: 'magic' };
}

/** 매직 바이트만으로 알아낸 종류 */
export function detectMagic(buf: Buffer): DetectedType | undefined {
  const b = buf;
  const m = (kind: AttachmentKind, mime: string): DetectedType => ({ kind, mime, by: 'magic' });
  // UTF-16 글 (BOM) — mp3 프레임 머리와 헷갈리지 않게 먼저
  if (startsWith(b, [0xff, 0xfe]) || startsWith(b, [0xfe, 0xff])) return undefined;
  if (ascii(b, '%PDF-')) return m('pdf', 'application/pdf');
  if (isZip(b)) return zipContainer(buf);
  if (startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    // HWP 5.0 FileHeader 스트림: "HWP Document File"
    if (buf.subarray(0, 64 * 1024).includes('HWP Document File', 0, 'latin1'))
      return m('hwp', 'application/x-hwp');
    return m('unknown', 'application/x-ole-storage');
  }
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return m('image', 'image/png');
  if (startsWith(b, [0xff, 0xd8, 0xff])) return m('image', 'image/jpeg');
  if (ascii(b, 'GIF87a') || ascii(b, 'GIF89a')) return m('image', 'image/gif');
  if (ascii(b, 'RIFF') && ascii(b, 'WEBP', 8)) return m('image', 'image/webp');
  if (ascii(b, 'RIFF') && ascii(b, 'WAVE', 8)) return m('audio', 'audio/wav');
  if (ascii(b, 'RIFF') && ascii(b, 'AVI ', 8)) return m('video', 'video/x-msvideo');
  if (ascii(b, 'BM') && b.length > 14 && buf.readUInt32LE(2) === buf.length) return m('image', 'image/bmp');
  if (startsWith(b, [0x49, 0x49, 0x2a, 0x00]) || startsWith(b, [0x4d, 0x4d, 0x00, 0x2a]))
    return m('image', 'image/tiff');
  if (ascii(b, 'ID3') || (b.length > 2 && b[0] === 0xff && (b[1]! & 0xe0) === 0xe0 && (b[1]! & 0x06) !== 0))
    return m('audio', 'audio/mpeg');
  if (ascii(b, 'OggS')) return m('audio', 'audio/ogg');
  if (ascii(b, 'fLaC')) return m('audio', 'audio/flac');
  const mp4 = mp4Brand(b);
  if (mp4) return mp4;
  if (startsWith(b, [0x1a, 0x45, 0xdf, 0xa3])) {
    const head = buf.subarray(0, 64).toString('latin1');
    return head.includes('webm') ? m('video', 'video/webm') : m('video', 'video/x-matroska');
  }
  if (startsWith(b, [0x1f, 0x8b])) return m('archive', 'application/gzip');
  if (ascii(b, 'ustar', 257)) return m('archive', 'application/x-tar');
  if (startsWith(b, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return m('archive', 'application/x-7z-compressed');
  if (ascii(b, 'Rar!')) return m('archive', 'application/vnd.rar');
  if (ascii(b, 'MZ')) return m('executable', 'application/vnd.microsoft.portable-executable');
  if (startsWith(b, [0x7f, 0x45, 0x4c, 0x46])) return m('executable', 'application/x-elf');
  if (startsWith(b, [0xcf, 0xfa, 0xed, 0xfe]) || startsWith(b, [0xfe, 0xed, 0xfa, 0xcf]))
    return m('executable', 'application/x-mach-binary');
  if (ascii(b, '#!')) return m('executable', 'text/x-shellscript');
  return undefined;
}

/** 매직 바이트 → (글이면) 확장자로 세부 형식 → 확장자 → 알 수 없음 */
export function detectType(buf: Buffer, name: string): DetectedType {
  const magic = detectMagic(buf);
  if (magic) return magic;
  const ext = byExtension(name);
  if (looksLikeText(buf)) {
    if (ext && (ext.kind === 'text' || ext.kind === 'executable')) return { ...ext, by: 'text' };
    return { kind: 'text', mime: 'text/plain', by: 'text' };
  }
  // 글도 아니고 매직도 없으면: 확장자가 바이너리 형식을 말해도 내용을 확인할 수 없으니 알 수 없음
  if (ext && ext.kind === 'executable') return ext;
  return { kind: 'unknown', mime: 'application/octet-stream', by: 'none' };
}
