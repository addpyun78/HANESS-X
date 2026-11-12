import { useCallback, useEffect, useRef, useState } from 'react';
import type { AttachEvent, Attachment } from './types.js';

/**
 * T-101 1A.7·1A.8 입력창 첨부 → 서버 저장 (0-2 프로젝트·초안 세션과 연결).
 *  - 지금 세션(초안 포함)이 있고 프로젝트가 있으면 바로 올린다 → 서버가 초안을 정식 저장(첨부가 첫 메시지)
 *  - 아니면 첨부를 잠시 들고 "어디서 작업할까요?"(askProject = useProjectShell.newSession)를 먼저 띄우고,
 *    프로젝트를 골라 세션이 생기면 그때 올린다
 * 칩 상태(바꾸는 중…/✓/⚠)는 서버 목록을 잠깐씩 다시 읽어 채운다.
 */

export interface AttachUploadOptions {
  /** HarnessApiClient.request (없으면 서버 연결 전 — 아무것도 하지 않는다) */
  request?: <T>(path: string, init?: RequestInit) => Promise<T>;
  /** 지금 열린 세션 id (초안 포함) */
  sessionId?: string;
  /** 세션이 프로젝트 폴더를 갖고 있는지 */
  projectReady: boolean;
  /** "어디서 작업할까요?" 카드 / 새 초안 */
  askProject: () => void;
  /** 올린 뒤 (사이드바 새로 읽기 등) */
  onUploaded?: (sessionId: string) => void;
  /** 상태 다시 읽기 간격 (기본 1.5초) */
  pollMs?: number;
}

type Status = Pick<Attachment, 'status' | 'warning'>;
interface ServerAttachment {
  id: string;
  status?: 'converting' | 'ready' | 'failed';
  warnings?: { code: string; message: string }[];
}

export async function fileToBase64(f: File): Promise<string> {
  const buf = new Uint8Array(await f.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

const statusOf = (a: ServerAttachment): Status => {
  const warn = a.warnings?.find((w) => w.code !== 'list-only')?.message;
  return { status: a.status ?? 'converting', ...(a.status === 'failed' && warn ? { warning: warn } : {}) };
};

export function useAttachUpload(o: AttachUploadOptions) {
  const [status, setStatus] = useState<Record<string, Status>>({});
  const pending = useRef<Attachment[]>([]);
  const opts = useRef(o);
  opts.current = o;
  /** 화면 칩 id → 서버 첨부 id */
  const serverIds = useRef(new Map<string, string>());

  const poll = useCallback((sessionId: string, tries = 0) => {
    const { request, pollMs = 1500 } = opts.current;
    if (!request || tries > 40) return;
    setTimeout(() => {
      void request<{ attachments: ServerAttachment[] }>(
        `/api/sessions/${encodeURIComponent(sessionId)}/attachments`,
      )
        .then((r) => {
          const byServer = new Map(r.attachments.map((a) => [a.id, a]));
          const update: Record<string, Status> = {};
          for (const [ui, sid] of serverIds.current) {
            const a = byServer.get(sid);
            if (a) update[ui] = statusOf(a);
          }
          const converting = Object.values(update).some((x) => x.status === 'converting');
          setStatus((cur) => ({ ...cur, ...update }));
          if (converting) poll(sessionId, tries + 1);
        })
        .catch(() => {});
    }, pollMs);
  }, []);

  const upload = useCallback(
    async (sessionId: string, list: Attachment[]) => {
      const { request } = opts.current;
      if (!request || list.length === 0) return;
      setStatus((cur) => ({
        ...cur,
        ...Object.fromEntries(list.map((a) => [a.id, { status: 'converting' as const }])),
      }));
      try {
        const files = await Promise.all(
          list.map(async (a) => ({ name: a.name, dataBase64: await fileToBase64(a.file) })),
        );
        const r = await request<{ attachments: ServerAttachment[] }>(
          `/api/sessions/${encodeURIComponent(sessionId)}/attachments`,
          {
            method: 'POST',
            body: JSON.stringify({ files }),
            headers: { 'content-type': 'application/json' },
          },
        );
        r.attachments.forEach((s, i) => {
          const ui = list[i];
          if (ui) serverIds.current.set(ui.id, s.id);
        });
        setStatus((cur) => ({
          ...cur,
          ...Object.fromEntries(r.attachments.map((s, i) => [list[i]?.id ?? s.id, statusOf(s)])),
        }));
        opts.current.onUploaded?.(sessionId);
        poll(sessionId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStatus((cur) => ({
          ...cur,
          ...Object.fromEntries(list.map((a) => [a.id, { status: 'failed' as const, warning: message }])),
        }));
      }
    },
    [poll],
  );

  const onAttach = useCallback(
    (e: AttachEvent) => {
      const { sessionId, projectReady, askProject } = opts.current;
      if (sessionId && projectReady) void upload(sessionId, e.attachments);
      else {
        // 1A.8 프로젝트(세션)가 아직 없으면 카드부터, 고른 뒤 올린다
        pending.current.push(...e.attachments);
        askProject();
      }
    },
    [upload],
  );

  // 프로젝트를 골라 세션이 생기면 들고 있던 첨부를 올린다
  useEffect(() => {
    if (!o.sessionId || !o.projectReady || pending.current.length === 0) return;
    const list = pending.current.splice(0);
    void upload(o.sessionId, list);
  }, [o.sessionId, o.projectReady, upload]);

  return { onAttach, status };
}
