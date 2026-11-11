import { useCallback, useEffect, useRef, useState } from 'react';
import type { EngineScanApi, RescanReason } from './api.js';
import type { ScanProgressView } from './model.js';

/** 완료 문구를 보여 주는 시간 (5A.4) */
export const DONE_VISIBLE_MS = 1500;
/** 스캔 중 진행 상태를 다시 묻는 간격 */
export const POLL_MS = 500;

export type BubblePhase = 'hidden' | 'scanning' | 'done' | 'empty';

export interface EngineScanState {
  progress: ScanProgressView | undefined;
  phase: BubblePhase;
  /** 스캔이 끝날 때마다 1씩 늘어난다 (모델 목록 다시 읽기용) */
  generation: number;
  rescan(reason: RescanReason): Promise<void>;
  dismiss(): void;
}

/** 설치 관리에서 설치가 끝났음을 알리는 이벤트 (installer service → 이벤트 로그) */
export const INSTALL_DONE_EVENT = 'tool_registered';

/**
 * 5A 시작 화면 가운데 말풍선 상태.
 * 서버 스캔은 앱 시작 때 이미 백그라운드에서 돈다(화면을 막지 않음) — 여기서는 진행 상태만 읽어 보여 준다.
 * 5A.9 설치 완료 이벤트 → 재스캔(reason install), 설정 [다시 찾기] → rescan('manual')
 */
export function useEngineScan(
  api: EngineScanApi | undefined,
  events: readonly { type: string }[] = [],
  opts: { pollMs?: number; doneMs?: number } = {},
): EngineScanState {
  const [progress, setProgress] = useState<ScanProgressView>();
  const [phase, setPhase] = useState<BubblePhase>('hidden');
  const [generation, setGeneration] = useState(0);
  const watching = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pollMs = opts.pollMs ?? POLL_MS;
  const doneMs = opts.doneMs ?? DONE_VISIBLE_MS;

  const poll = useCallback(async () => {
    if (!api) return;
    let p: ScanProgressView;
    try {
      p = await api.scanStatus();
    } catch {
      return;
    }
    setProgress(p);
    if (p.state === 'scanning') {
      watching.current = true;
      setPhase('scanning');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void poll(), pollMs);
      return;
    }
    const wasWatching = watching.current;
    watching.current = false;
    setGeneration((g) => g + 1);
    if (p.found === 0) return setPhase('empty');
    if (!wasWatching) return setPhase('hidden');
    setPhase('done');
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setPhase((x) => (x === 'done' ? 'hidden' : x)), doneMs);
  }, [api, pollMs, doneMs]);

  useEffect(() => {
    void poll();
    return () => {
      clearTimeout(timer.current);
      clearTimeout(hideTimer.current);
    };
  }, [poll]);

  const rescan = useCallback(
    async (reason: RescanReason) => {
      if (!api) return;
      watching.current = true;
      setPhase('scanning');
      const p = api.rescan(reason).catch(() => undefined);
      // 스캔이 진행되는 동안 진행 상태를 보여 준다
      timer.current = setTimeout(() => void poll(), 0);
      await p;
      await poll();
    },
    [api, poll],
  );

  // 5A.9 설치 관리에서 설치 완료 → 다시 찾기 (같은 이벤트는 한 번만)
  const seenInstalls = useRef(-1);
  useEffect(() => {
    const n = events.filter((e) => e.type === INSTALL_DONE_EVENT).length;
    if (seenInstalls.current === -1) {
      seenInstalls.current = n;
      return;
    }
    if (n > seenInstalls.current) {
      seenInstalls.current = n;
      void rescan('install');
    }
  }, [events, rescan]);

  const dismiss = useCallback(() => setPhase('hidden'), []);
  return { progress, phase, generation, rescan, dismiss };
}
