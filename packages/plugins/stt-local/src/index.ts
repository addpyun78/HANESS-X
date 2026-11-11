import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, delimiter, join } from 'node:path';
import type { SpeechToText } from '@harness-x/protocol';

/**
 * T-100 P4-B.5 stt-local: whisper.cpp(설치돼 있으면)로 PC 안에서 음성 → 글.
 * - 감지만 한다: 실행 파일(whisper-cli / whisper-cpp)과 ggml 모델 파일을 찾는다. 설치·다운로드는 하지 않는다.
 * - 한국어 고정(-l ko). 모델은 HARNESS_X_WHISPER_MODEL 또는 <하네스 홈>/models/whisper/ggml-*.bin
 * - 녹음기는 주입받는다(웹 화면은 MediaRecorder로 녹음해 POST /api/stt/transcribe로 보낸다).
 */

export const STT_LOCAL_ID = 'local';
export const WHISPER_BINARIES = ['whisper-cli', 'whisper-cpp'] as const;
export const WHISPER_LANGUAGE = 'ko';
export const MODEL_ENV = 'HARNESS_X_WHISPER_MODEL';
/** 큰 모델일수록 한국어 정확도가 높다 → 있으면 먼저 쓴다 */
const MODEL_PREFERENCE = ['large', 'medium', 'small', 'base', 'tiny'];

export type ExecFn = (
  file: string,
  args: string[],
  opts: { timeoutMs: number },
) => Promise<{ stdout: string; stderr: string; code: number }>;

export const defaultExec: ExecFn = (file, args, opts) =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: opts.timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err
        ? typeof (err as { code?: unknown }).code === 'number'
          ? (err as { code: number }).code
          : 1
        : 0;
      resolve({ stdout: String(stdout), stderr: String(stderr), code });
    });
  });

/** PATH에서 실행 파일 찾기 (Windows는 .exe도) */
export function whichSync(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const f = join(dir, name + ext);
      try {
        if (statSync(f).isFile()) return f;
      } catch {
        // 없음
      }
    }
  }
  return undefined;
}

export interface WhisperDetection {
  available: boolean;
  binary?: string;
  model?: string;
  language: string;
  /** 사용할 수 없는 이유 (쉬운 말) */
  reason?: string;
}

export interface DetectOptions {
  env?: NodeJS.ProcessEnv;
  /** 하네스 홈 (기본 HARNESS_X_HOME 또는 ~/.harness-x) */
  home?: string;
  which?: (name: string) => string | undefined;
}

function pickModel(dir: string): string | undefined {
  if (!existsSync(dir)) return undefined;
  const models = readdirSync(dir).filter((f) => /^ggml-.*\.bin$/.test(f));
  const rank = (f: string) => {
    const i = MODEL_PREFERENCE.findIndex((p) => f.includes(p));
    return i < 0 ? MODEL_PREFERENCE.length : i;
  };
  const best = models.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))[0];
  return best ? join(dir, best) : undefined;
}

/** whisper.cpp 감지 (실행하지 않고 파일만 찾는다) */
export function detectWhisper(o: DetectOptions = {}): WhisperDetection {
  const env = o.env ?? process.env;
  const which = o.which ?? ((n: string) => whichSync(n, env));
  const binary = WHISPER_BINARIES.map((b) => which(b)).find((x): x is string => !!x);
  if (!binary)
    return { available: false, language: WHISPER_LANGUAGE, reason: 'whisper.cpp가 설치되어 있지 않아요' };
  const home = o.home ?? env.HARNESS_X_HOME ?? join(homedir(), '.harness-x');
  const fromEnv = env[MODEL_ENV];
  const model = fromEnv && existsSync(fromEnv) ? fromEnv : pickModel(join(home, 'models', 'whisper'));
  if (!model)
    return {
      available: false,
      binary,
      language: WHISPER_LANGUAGE,
      reason: '음성 인식 모델 파일(ggml-*.bin)을 찾지 못했어요',
    };
  return { available: true, binary, model, language: WHISPER_LANGUAGE };
}

/** whisper.cpp 출력 → 글 (타임스탬프 줄 형식도 처리) */
export function parseWhisperOutput(stdout: string): string {
  return stdout
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*\[[\d:.]+\s*-->\s*[\d:.]+\]\s*/, '').trim())
    .filter((l) => l.length > 0 && !/^\[(BLANK_AUDIO|음악|MUSIC)\]$/i.test(l))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface TranscribeOptions {
  binary: string;
  model: string;
  language?: string;
  exec?: ExecFn;
  timeoutMs?: number;
}

/** 음성 파일(16kHz wav) → 글 */
export async function transcribeFile(file: string, o: TranscribeOptions): Promise<string> {
  const exec = o.exec ?? defaultExec;
  const args = ['-m', o.model, '-l', o.language ?? WHISPER_LANGUAGE, '-f', file, '-nt', '-np'];
  const r = await exec(o.binary, args, { timeoutMs: o.timeoutMs ?? 120_000 });
  if (r.code !== 0) throw new Error(`whisper.cpp 변환 실패 (종료 코드 ${r.code}): ${r.stderr.slice(0, 200)}`);
  return parseWhisperOutput(r.stdout);
}

/** 녹음기: 파일에 녹음 (실제 마이크 연결은 호출자가 고른다) */
export interface Recorder {
  start(file: string): Promise<void>;
  stop(): Promise<void>;
}

export interface LocalSttOptions {
  detection: WhisperDetection;
  recorder: Recorder;
  exec?: ExecFn;
  /** 임시 폴더 (기본 os.tmpdir()) */
  tmp?: string;
}

export class LocalSpeechToText implements SpeechToText {
  readonly id = STT_LOCAL_ID;
  onPartial?: ((text: string) => void) | undefined;
  onFinal?: ((text: string) => void) | undefined;
  onError?: ((err: Error) => void) | undefined;
  onLevel?: ((level: number) => void) | undefined;
  private dir: string | undefined;

  constructor(private readonly o: LocalSttOptions) {}

  get available(): boolean {
    return this.o.detection.available;
  }

  async start(): Promise<void> {
    const d = this.o.detection;
    if (!d.available) throw new Error(d.reason ?? 'PC 안 음성 인식을 쓸 수 없어요');
    if (this.dir) return;
    this.dir = mkdtempSync(join(this.o.tmp ?? tmpdir(), 'hx-stt-'));
    await this.o.recorder.start(join(this.dir, 'input.wav'));
  }

  async stop(): Promise<void> {
    const dir = this.dir;
    if (!dir) return;
    try {
      await this.o.recorder.stop();
      const d = this.o.detection;
      const text = await transcribeFile(join(dir, 'input.wav'), {
        binary: d.binary!,
        model: d.model!,
        language: d.language,
        ...(this.o.exec ? { exec: this.o.exec } : {}),
      });
      if (text) this.onFinal?.(text);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.onError?.(e);
      throw e;
    } finally {
      this.dir = undefined;
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

// ── 화면용 API (서버에 꽂아 쓴다) ────────────────────────────
export const STT_STATUS_ROUTE = '/api/stt/status';
export const STT_TRANSCRIBE_ROUTE = '/api/stt/transcribe';

export interface SttRouteHost {
  get(path: string, handler: () => Promise<unknown>): unknown;
  post(path: string, handler: (req: { body?: unknown }) => Promise<unknown>): unknown;
}

/**
 * GET /api/stt/status → { local, language, model? }  (모델은 파일 이름만)
 * POST /api/stt/transcribe { audio: base64 wav } → { text }
 */
export function registerSttRoutes(
  app: SttRouteHost,
  o: { detect?: () => WhisperDetection; exec?: ExecFn } = {},
): void {
  const detect = o.detect ?? (() => detectWhisper());
  app.get(STT_STATUS_ROUTE, async () => {
    const d = detect();
    return {
      local: d.available,
      language: d.language,
      ...(d.model ? { model: basename(d.model) } : {}),
      ...(d.reason ? { reason: d.reason } : {}),
    };
  });
  app.post(STT_TRANSCRIBE_ROUTE, async (req) => {
    const d = detect();
    if (!d.available) return { error: 'unavailable', message: d.reason };
    const audio = (req.body as { audio?: unknown } | undefined)?.audio;
    if (typeof audio !== 'string' || !audio)
      return { error: 'invalid_body', message: 'audio(base64)가 필요해요' };
    const dir = mkdtempSync(join(tmpdir(), 'hx-stt-'));
    try {
      const file = join(dir, 'input.wav');
      writeFileSync(file, Buffer.from(audio, 'base64'));
      const text = await transcribeFile(file, {
        binary: d.binary!,
        model: d.model!,
        language: d.language,
        ...(o.exec ? { exec: o.exec } : {}),
      });
      return { text };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

/** 하네스 플러그인 진입점: 감지 결과만 로그로 남긴다 (설치·다운로드 없음) */
export function activate(ctx: { log(message: string): void }): void {
  const d = detectWhisper();
  ctx.log(
    d.available ? `stt-local: whisper.cpp 사용 가능 (${basename(d.model!)})` : `stt-local: ${d.reason}`,
  );
}
