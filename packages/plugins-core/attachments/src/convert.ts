import type { AttachmentKind } from '@harness-x/protocol';
import { convertArchive } from './archive.js';
import type { Converter } from './context.js';
import { warn } from './context.js';
import { SCRIPT_EXTENSIONS, extOf } from './detect.js';
import { convertHwp, convertHwpx } from './hwp.js';
import { convertImage } from './image.js';
import { convertAudio, convertVideo } from './media.js';
import { MESSAGES } from './messages.js';
import { convertDocx, convertPptx, convertXlsx } from './office.js';
import { convertPdf } from './pdf.js';
import { convertText } from './text.js';

/**
 * 1B.11 알 수 없는 파일: 이름·크기·형식만 + "내용은 읽을 수 없어요".
 * 1C.1 실행 파일: 절대 실행하지 않는다. 스크립트(.sh·.ps1·.bat·.cmd·#!)는 글로만 보여 주고,
 * 바이너리(.exe 등)는 이름·크기만.
 */
export const convertUnknown: Converter = async () => ({
  representations: [],
  warnings: [warn('unknown-format', MESSAGES.unknownFile)],
});

export const convertExecutable: Converter = async (a, data, ctx) => {
  const isScript =
    a.mime.startsWith('text/') || (SCRIPT_EXTENSIONS as readonly string[]).includes(extOf(a.originalName));
  if (isScript) return convertText(a, data, ctx);
  return { representations: [], warnings: [warn('not-executed', MESSAGES.notExecuted)] };
};

/** 종류별 기본 변환기 (파일 종류별 "바꿔 두는 형태" 표) */
export const DEFAULT_CONVERTERS: Record<Exclude<AttachmentKind, 'folder'>, Converter> = {
  text: convertText,
  pdf: convertPdf,
  docx: convertDocx,
  pptx: convertPptx,
  xlsx: convertXlsx,
  hwpx: convertHwpx,
  hwp: convertHwp,
  image: convertImage,
  audio: convertAudio,
  video: convertVideo,
  archive: convertArchive,
  executable: convertExecutable,
  unknown: convertUnknown,
};
