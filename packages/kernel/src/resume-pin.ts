import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Pipeline } from '@harness-x/protocol';

/**
 * T-101 2B.6 버전 고정
 * 실행 시작 때 agent.yaml·파이프라인·관련 설정 파일의 스냅샷을 세션 폴더(pinned.json)에 보관한다.
 * 이어하기 기본은 "시작할 때 버전" — 그 뒤 바뀌었으면 점검기(2B.3)가 [시작할 때 버전으로 계속(기본)] [새 버전으로]를 묻는다.
 */

export interface PinnedFile {
  /** 카드에 보일 이름 (예: agent.yaml, engines-settings.yaml) */
  label: string;
  path: string;
  /** 시작 때 내용 해시 (파일이 없었으면 null) */
  sha256: string | null;
  /** 시작 때 내용 (작은 설정 파일만, 64KB까지) */
  content?: string;
}

export interface PinnedVersion {
  sessionId: string;
  agent: string;
  /** 시작할 때 파이프라인 (수식어 적용 전 원본) */
  pipeline: Pipeline;
  files: PinnedFile[];
  at: string;
}

const MAX_CONTENT = 64 * 1024;
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

function hashOf(path: string): string | null {
  return existsSync(path) ? sha(readFileSync(path)) : null;
}

export function pinnedFile(sessionDir: string): string {
  return join(sessionDir, 'pinned.json');
}

export interface PinRunInput {
  sessionId: string;
  sessionDir: string;
  agent: string;
  pipeline: Pipeline;
  files?: { label: string; path: string }[];
  now?: Date;
}

/** 실행 시작 때 버전 고정 */
export function pinRunVersion(i: PinRunInput): PinnedVersion {
  const files: PinnedFile[] = (i.files ?? []).map((f) => {
    const exists = existsSync(f.path);
    const buf = exists ? readFileSync(f.path) : undefined;
    return {
      label: f.label,
      path: f.path,
      sha256: buf ? sha(buf) : null,
      ...(buf && buf.length <= MAX_CONTENT ? { content: buf.toString('utf8') } : {}),
    };
  });
  const pin: PinnedVersion = {
    sessionId: i.sessionId,
    agent: i.agent,
    pipeline: structuredClone(i.pipeline),
    files,
    at: (i.now ?? new Date()).toISOString(),
  };
  const file = pinnedFile(i.sessionDir);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(pin, null, 2));
  return pin;
}

export function readPinnedVersion(sessionDir: string): PinnedVersion | null {
  const f = pinnedFile(sessionDir);
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, 'utf8')) as PinnedVersion;
  } catch {
    return null;
  }
}

/** 시작 뒤 바뀐 것 (파일 이름, 파이프라인이 바뀌었으면 'pipeline') */
export function changedSinceStart(pin: PinnedVersion, currentPipeline?: Pipeline): string[] {
  const out = pin.files.filter((f) => hashOf(f.path) !== f.sha256).map((f) => f.label);
  if (currentPipeline && JSON.stringify(currentPipeline) !== JSON.stringify(pin.pipeline))
    out.push('pipeline');
  return out;
}

/** 이어할 파이프라인: 기본은 시작할 때 버전, 'latest'면 지금 버전 */
export function pipelineForResume(
  pin: PinnedVersion | null,
  current: Pipeline,
  version: 'pinned' | 'latest' = 'pinned',
): Pipeline {
  return version === 'pinned' && pin ? pin.pipeline : current;
}
