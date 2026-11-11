import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PluginManifestSchema, sttToolsOf } from '@harness-x/protocol';
import { readFileSync } from 'node:fs';
import {
  LocalSpeechToText,
  detectWhisper,
  parseWhisperOutput,
  registerSttRoutes,
  transcribeFile,
  type ExecFn,
  type Recorder,
} from '../src/index.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'hx-stt-test-'));
  dirs.push(d);
  return d;
};

/** 모킹 whisper.cpp: 인자 기록 + 고정 출력 */
function fakeExec(stdout = '[00:00:00.000 --> 00:00:02.500]   임장노트 화면 검수 에이전트\n', code = 0) {
  const calls: { file: string; args: string[] }[] = [];
  const exec: ExecFn = async (file, args) => {
    calls.push({ file, args });
    return { stdout, stderr: code ? 'boom' : '', code };
  };
  return { exec, calls };
}

describe('P4-B.5 stt-local (whisper.cpp, 한국어) — 모킹', () => {
  it('감지: 실행 파일 + 모델이 있으면 사용 가능, 큰 모델 우선', () => {
    const home = tmp();
    const models = join(home, 'models', 'whisper');
    mkdirSync(models, { recursive: true });
    writeFileSync(join(models, 'ggml-base.bin'), '');
    writeFileSync(join(models, 'ggml-medium.bin'), '');
    const d = detectWhisper({
      home,
      env: {},
      which: (n) => (n === 'whisper-cli' ? '/usr/bin/whisper-cli' : undefined),
    });
    expect(d).toEqual({
      available: true,
      binary: '/usr/bin/whisper-cli',
      model: join(models, 'ggml-medium.bin'),
      language: 'ko',
    });
  });

  it('감지: 실행 파일 없음 / 모델 없음 → 사용 불가 + 쉬운 말 이유', () => {
    const home = tmp();
    expect(detectWhisper({ home, env: {}, which: () => undefined })).toMatchObject({
      available: false,
      reason: 'whisper.cpp가 설치되어 있지 않아요',
    });
    expect(detectWhisper({ home, env: {}, which: () => '/bin/whisper-cpp' })).toMatchObject({
      available: false,
      binary: '/bin/whisper-cpp',
    });
  });

  it('변환: -l ko 한국어 지정, 타임스탬프 제거', async () => {
    const { exec, calls } = fakeExec();
    const text = await transcribeFile('/tmp/a.wav', {
      binary: 'whisper-cli',
      model: '/m/ggml-small.bin',
      exec,
    });
    expect(text).toBe('임장노트 화면 검수 에이전트');
    expect(calls[0]!.args).toEqual(['-m', '/m/ggml-small.bin', '-l', 'ko', '-f', '/tmp/a.wav', '-nt', '-np']);
    await expect(
      transcribeFile('/tmp/a.wav', { binary: 'w', model: 'm', exec: fakeExec('', 3).exec }),
    ).rejects.toThrow(/종료 코드 3/);
    expect(parseWhisperOutput(' 안녕\n[BLANK_AUDIO]\n 하세요 \n')).toBe('안녕 하세요');
  });

  it('녹음 → 종료 → onFinal (모킹 녹음기)', async () => {
    const { exec } = fakeExec(' 검사는 claude로 바꿔 줘\n');
    const events: string[] = [];
    const recorder: Recorder = {
      start: async (file) => void events.push(`rec:${file.endsWith('input.wav')}`),
      stop: async () => void events.push('rec:stop'),
    };
    const stt = new LocalSpeechToText({
      detection: { available: true, binary: 'whisper-cli', model: 'm.bin', language: 'ko' },
      recorder,
      exec,
      tmp: tmp(),
    });
    const finals: string[] = [];
    stt.onFinal = (t) => finals.push(t);
    await stt.start();
    await stt.stop();
    expect(events).toEqual(['rec:true', 'rec:stop']);
    expect(finals).toEqual(['검사는 claude로 바꿔 줘']);

    const off = new LocalSpeechToText({
      detection: { available: false, language: 'ko', reason: '없음' },
      recorder,
    });
    await expect(off.start()).rejects.toThrow('없음');
  });

  it('화면용 API: 상태(모델 파일 이름만) + base64 음성 변환', async () => {
    const routes = new Map<string, (req: { body?: unknown }) => Promise<unknown>>();
    const { exec } = fakeExec(' 안녕하세요\n');
    registerSttRoutes(
      { get: (p, h) => routes.set(p, h), post: (p, h) => routes.set(p, h) },
      {
        detect: () => ({
          available: true,
          binary: 'w',
          model: '/secret/path/ggml-small.bin',
          language: 'ko',
        }),
        exec,
      },
    );
    expect(await routes.get('/api/stt/status')!({})).toEqual({
      local: true,
      language: 'ko',
      model: 'ggml-small.bin',
    });
    expect(
      await routes.get('/api/stt/transcribe')!({ body: { audio: Buffer.from('RIFF').toString('base64') } }),
    ).toEqual({
      text: '안녕하세요',
    });
    expect(await routes.get('/api/stt/transcribe')!({ body: {} })).toMatchObject({ error: 'invalid_body' });
  });

  it('매니페스트: tool 슬롯 하위 stt.local, 네트워크 권한 없음', () => {
    const m = PluginManifestSchema.parse(
      JSON.parse(readFileSync(new URL('../harness-plugin.json', import.meta.url), 'utf8')),
    );
    expect(sttToolsOf(m)).toEqual(['local']);
    expect(m.permissions.net).toEqual([]);
  });
});
