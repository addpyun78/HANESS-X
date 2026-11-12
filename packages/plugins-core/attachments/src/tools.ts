import { execFile } from 'node:child_process';
import { whichSync } from '@harness-x/stt-local';

/**
 * 바깥 도구(tesseract·hwp5txt·ffmpeg·7z) 실행기 — 주입 가능 (테스트는 모킹).
 * 첨부 파일 자체는 절대 실행하지 않는다(1C.1): 실행하는 것은 이 도구들뿐이고, 첨부는 인자로만 넘긴다.
 */

export interface ToolRunResult {
  code: number;
  stdout: Buffer;
  stderr: string;
}

export interface ExternalTools {
  /** PATH에서 찾기 (없으면 undefined) */
  which(name: string): string | undefined;
  run(command: string, args: readonly string[], opts?: { timeoutMs?: number }): Promise<ToolRunResult>;
}

export const systemTools: ExternalTools = {
  which: (name) => whichSync(name),
  run: (command, args, opts) =>
    new Promise((resolve) => {
      execFile(
        command,
        [...args],
        {
          encoding: 'buffer',
          timeout: opts?.timeoutMs ?? 120_000,
          maxBuffer: 64 * 1024 * 1024,
          shell: false,
        },
        (err, stdout, stderr) => {
          const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
          resolve({ code, stdout: Buffer.from(stdout), stderr: Buffer.from(stderr).toString('utf8') });
        },
      );
    }),
};

/** 도구 찾기 카드(T-100 tool-finder)에 넘길 요청 — ToolFinder.find(NeedRequest)와 같은 모양 */
export interface ToolNeedRequest {
  capability: string;
  why?: string;
  source?: 'user';
}

/** 도구가 없을 때 부르는 함수 (보통 toolFinderBridge(finder)) */
export type OnToolNeeded = (req: ToolNeedRequest) => unknown;

/** @harness-x/tool-finder의 ToolFinder (또는 같은 모양) → 도구 찾기 카드 */
export function toolFinderBridge(finder: { find(req: ToolNeedRequest): Promise<unknown> }): OnToolNeeded {
  return (req) => finder.find({ ...req, source: 'user' });
}

/** 형태 바꾸기에 필요한 바깥 도구와 도구 찾기 카드에 쓰는 능력 설명 */
export const TOOL_NEEDS = {
  tesseract: { capability: '그림 속 한글 글자 읽기', why: '스캔한 PDF에서 글자를 읽으려고 해요' },
  hwp5txt: { capability: 'HWP 문서에서 글 뽑기', why: 'HWP 첨부 파일 내용을 읽으려고 해요' },
  ffmpeg: { capability: '동영상에서 장면과 소리 뽑기', why: '동영상 첨부 파일 내용을 보려고 해요' },
  '7z': { capability: '7z 압축 파일 목록 보기', why: '압축 파일 안을 보려고 해요' },
} as const;
