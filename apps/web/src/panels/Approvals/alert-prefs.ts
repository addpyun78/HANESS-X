/**
 * T-101 6B.6 승인·알림 설정 (레지스트리 approval.osNotify·approval.remindMinutes·approval.sound — 이 기기 화면에만 저장).
 * 설정 화면(승인·알림 탭)이 브라우저 저장소에 쓰고, useApprovals가 알릴 때마다 읽는다.
 */

export const OS_NOTIFY_KEY = 'hx.approvals.os-notify';
export const REMIND_KEY = 'hx.approvals.remind-minutes';
export const SOUND_KEY = 'hx.approvals.sound';

export interface AlertPrefs {
  /** 화면을 보고 있지 않을 때 컴퓨터 알림 */
  osNotify: boolean;
  /** 확인할 일이 남아 있으면 몇 분마다 다시 알릴지 (0 = 안 함) */
  remindMinutes: number;
  /** 새로 확인할 일이 생기면 소리 */
  sound: boolean;
}

export const DEFAULT_ALERT_PREFS: AlertPrefs = { osNotify: true, remindMinutes: 0, sound: false };

const REMIND_CHOICES = [0, 5, 15, 30];

function get(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function loadAlertPrefs(): AlertPrefs {
  const remind = Number(get(REMIND_KEY));
  return {
    osNotify: get(OS_NOTIFY_KEY) !== 'off',
    remindMinutes: REMIND_CHOICES.includes(remind) ? remind : DEFAULT_ALERT_PREFS.remindMinutes,
    sound: get(SOUND_KEY) === 'on',
  };
}

/** 짧은 알림 소리 (소리를 낼 수 없는 환경이면 아무것도 안 함) */
export function playChime(): void {
  try {
    const Ctx =
      (globalThis as { AudioContext?: typeof AudioContext }).AudioContext ??
      (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
    osc.onended = () => void ctx.close();
  } catch {
    /* 소리를 못 내도 알림 카드는 그대로 */
  }
}
