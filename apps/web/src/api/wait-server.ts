import { ApiError } from './client.js';

/**
 * T-102 I.2 바로가기로 켤 때 화면이 서버보다 먼저 열린다 → 서버가 답할 때까지 기다렸다가 목록을 불러온다.
 * (예전에는 첫 요청이 실패하면 다시 부르지 않아 패널이 빈 채로 남았다)
 * - 연결 실패(네트워크 오류)나 5xx(중계 서버가 아직 못 닿음) = 아직 안 켜짐 → 계속 기다림
 * - 그 밖의 응답(200·401·404 …) = 서버가 답함 → 바로 진행
 */
export interface WaitServerOptions {
  /** 기다리는 동안 지난 초를 알려 준다 */
  onWaiting?: (seconds: number) => void;
  intervalMs?: number;
  /** 이 시간이 지나면 포기(false) — 기본 10분 */
  maxMs?: number;
  isStopped?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export async function waitForServer(
  client: { health(): Promise<unknown> },
  o: WaitServerOptions = {},
): Promise<boolean> {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const t0 = now();
  for (;;) {
    if (o.isStopped?.()) return false;
    try {
      await client.health();
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status < 500) return true;
    }
    const elapsed = now() - t0;
    if (elapsed >= (o.maxMs ?? 600_000)) return false;
    o.onWaiting?.(Math.round(elapsed / 1000));
    await sleep(o.intervalMs ?? 1500);
  }
}

export const SERVER_STARTING = (s: number) => `하네스 서버를 켜는 중이에요. ${s}초 지났어요.`;
export const SERVER_NOT_STARTED = '하네스 서버가 켜지지 않았어요. 바로가기를 다시 눌러 주세요.';
