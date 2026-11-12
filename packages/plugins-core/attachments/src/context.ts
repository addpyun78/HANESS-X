import { mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Attachment, AttachmentWarning, Representation, RepresentationForm } from '@harness-x/protocol';
import { writeAtomic } from './store.js';
import type { ExternalTools, OnToolNeeded } from './tools.js';

/** 형태 바꾸기 한 번의 문맥 */
export interface ConvertContext {
  /** 이 첨부의 폴더 (<해시12>/) */
  dir: string;
  tools: ExternalTools;
  /** 도구가 없을 때 도구 찾기 카드 */
  onToolNeeded?: OnToolNeeded;
  /** 소리 → 글 (STT 플러그인). 없으면 받아쓰기 생략 + 안내 */
  transcribe?: (file: string) => Promise<string>;
  /** 축소본 도구 (sharp가 있으면). undefined면 축소본 생략 + 안내 */
  loadResizer?: () => Promise<ImageResizer | undefined>;
}

/** 그림 줄이기 (sharp 같은 모양) */
export type ImageResizer = (input: Buffer, maxSide: number) => Promise<{ data: Buffer; mime: string }>;

export interface ConvertOutput {
  representations: Representation[];
  warnings: AttachmentWarning[];
}

export type Converter = (a: Attachment, data: Buffer, ctx: ConvertContext) => Promise<ConvertOutput>;

export function emptyOutput(): ConvertOutput {
  return { representations: [], warnings: [] };
}

/** 첨부 폴더 안에 형태 파일 하나 쓰기 */
export function writeRep(
  ctx: Pick<ConvertContext, 'dir'>,
  form: RepresentationForm,
  file: string,
  data: Buffer | string,
  mime: string,
  index?: number,
): Representation {
  const path = join(ctx.dir, file);
  mkdirSync(dirname(path), { recursive: true });
  writeAtomic(path, data);
  return { form, path, mime, sizeBytes: statSync(path).size, ...(index ? { index } : {}) };
}

export function warn(code: string, message: string, capability?: string): AttachmentWarning {
  return { code, message, ...(capability ? { capability } : {}) };
}
