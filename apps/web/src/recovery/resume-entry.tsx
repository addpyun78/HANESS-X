import type { ResumeApi } from './ResumeFlow.js';

/**
 * T-101 2B.2 이어하기 입구 도우미
 *  - `/resume [세션 id]` 입력창 명령
 *  - 빈 세션 화면(0B.18)의 "이어서 할 작업 N개" 버튼
 *  - API 클라이언트 → ResumeApi
 */

/** `/resume` 또는 `/resume <id>` → { sessionId? }, 아니면 null */
export function parseResumeCommand(text: string): { sessionId?: string } | null {
  const m = /^\s*\/resume(?:\s+(\S+))?\s*$/i.exec(text);
  if (!m) return null;
  return m[1] ? { sessionId: m[1] } : {};
}

/** 대상 세션: 적힌 id, 없으면 가장 최근에 멈춘 세션 */
export function resumeTarget(
  cmd: { sessionId?: string },
  sessions: readonly { id: string; status: string; updatedAt: string }[],
): string | undefined {
  if (cmd.sessionId) return cmd.sessionId;
  return [...sessions]
    .filter((s) => s.status === 'paused')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.id;
}

export interface ResumeCountLinkProps {
  count: number;
  onOpen(): void;
}

/** 빈 세션 화면(0B.18)에 붙일 "이어서 할 작업 N개" (0개면 안 보임) */
export function ResumeCountLink({ count, onOpen }: ResumeCountLinkProps) {
  if (count <= 0) return null;
  return (
    <button type="button" className="hx-resume-count" onClick={onOpen}>
      ⏸ 이어서 할 작업 {count}개
    </button>
  );
}

/** request(path, init) → ResumeApi */
export function resumeApi(request: <T>(path: string, init?: RequestInit) => Promise<T>): ResumeApi {
  const post = <T,>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) });
  return {
    check: (id) => post(`/api/resume/${encodeURIComponent(id)}/check`, {}),
    start: (id, choices) => post(`/api/resume/${encodeURIComponent(id)}`, choices),
  };
}
