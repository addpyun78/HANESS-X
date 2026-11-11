import iconv from 'iconv-lite';
import type { Converter } from './context.js';
import { warn, writeRep } from './context.js';
import { MESSAGES } from './messages.js';

/**
 * 1B.2 글 파일: 인코딩 자동 감지(UTF-8 / UTF-16 / CP949 / EUC-KR) → UTF-8.
 * Node(ICU)의 TextDecoder('euc-kr')는 CP949 확장 완성형(똠·햏 등)을 못 읽어서, 그 범위가 있으면 iconv-lite cp949.
 */

export type TextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'cp949' | 'euc-kr';

export interface DecodedText {
  text: string;
  encoding: TextEncoding;
  bom: boolean;
}

function tryDecode(label: string, b: Uint8Array): string | undefined {
  try {
    return new TextDecoder(label, { fatal: true }).decode(b);
  } catch {
    return undefined;
  }
}

/** BOM 없는 UTF-16: 홀수/짝수 자리에 0이 많다 */
function utf16Guess(b: Uint8Array): 'utf-16le' | 'utf-16be' | undefined {
  const n = Math.min(b.length - (b.length % 2), 4096);
  if (n < 4) return undefined;
  let evenZero = 0;
  let oddZero = 0;
  for (let i = 0; i < n; i += 2) {
    if (b[i] === 0) evenZero++;
    if (b[i + 1] === 0) oddZero++;
  }
  const half = n / 2;
  if (oddZero / half > 0.3 && evenZero / half < 0.05) return 'utf-16le';
  if (evenZero / half > 0.3 && oddZero / half < 0.05) return 'utf-16be';
  return undefined;
}

/** EUC-KR 범위(lead·trail 0xA1~0xFE)를 벗어나는 2바이트 글자가 있으면 CP949 */
function usesCp949Extension(b: Uint8Array): boolean {
  for (let i = 0; i < b.length; i++) {
    const c = b[i]!;
    if (c < 0x80) continue;
    const t = b[i + 1] ?? 0;
    if (c < 0xa1 || t < 0xa1) return true;
    i++;
  }
  return false;
}

export function decodeText(buf: Uint8Array): DecodedText {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf)
    return { text: new TextDecoder('utf-8').decode(buf.subarray(3)), encoding: 'utf-8', bom: true };
  if (buf[0] === 0xff && buf[1] === 0xfe)
    return { text: new TextDecoder('utf-16le').decode(buf.subarray(2)), encoding: 'utf-16le', bom: true };
  if (buf[0] === 0xfe && buf[1] === 0xff)
    return { text: new TextDecoder('utf-16be').decode(buf.subarray(2)), encoding: 'utf-16be', bom: true };
  const u16 = utf16Guess(buf);
  if (u16) return { text: new TextDecoder(u16).decode(buf), encoding: u16, bom: false };
  const utf8 = tryDecode('utf-8', buf);
  if (utf8 !== undefined) return { text: utf8, encoding: 'utf-8', bom: false };
  if (usesCp949Extension(buf))
    return { text: iconv.decode(Buffer.from(buf), 'cp949'), encoding: 'cp949', bom: false };
  const euc = tryDecode('euc-kr', buf);
  if (euc !== undefined) return { text: euc, encoding: 'euc-kr', bom: false };
  // 마지막: 깨진 글자는 대체 문자로
  return { text: new TextDecoder('utf-8').decode(buf), encoding: 'utf-8', bom: false };
}

/** 줄바꿈 정리(CRLF → LF) */
export function toUtf8Text(buf: Uint8Array): DecodedText {
  const d = decodeText(buf);
  return { ...d, text: d.text.replace(/\r\n?/g, '\n') };
}

export const convertText: Converter = async (a, data, ctx) => {
  const d = toUtf8Text(data);
  const rep = writeRep(ctx, 'text', 'text.txt', d.text, 'text/plain; charset=utf-8');
  const warnings = a.kind === 'executable' ? [warn('not-executed', MESSAGES.notExecuted)] : [];
  return { representations: [rep], warnings };
};
