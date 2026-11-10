/**
 * 데스크톱(Tauri) 모드 연결 (T-063)
 * - 서버 주소·토큰: 앱이 띄운 사이드카에게 invoke('server_info')로 묻는다 (준비될 때까지 starting)
 * - 폴더 선택: @tauri-apps/plugin-dialog open({ directory: true }) (capability dialog:allow-open)
 * 브라우저 모드에서는 쓰이지 않으며, Tauri 모듈은 동적 import로만 불러온다.
 */

export type DesktopServerStatus =
  | { state: 'starting' }
  | { state: 'ready'; url: string; token: string }
  | { state: 'failed'; message: string };

export function isTauri(g: object = globalThis): boolean {
  return '__TAURI_INTERNALS__' in g;
}

/** Tauri 모바일(Android·iOS)에서는 폴더 대화상자가 없다 */
export function isTauriMobile(ua: string = globalThis.navigator?.userAgent ?? ''): boolean {
  return isTauri() && /Android|iPhone|iPad|iPod/i.test(ua);
}

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
type OpenDialog = (o: {
  directory: boolean;
  multiple?: boolean;
  defaultPath?: string;
  title?: string;
}) => Promise<string | string[] | null>;

export interface DesktopDeps {
  invoke?: Invoke;
  open?: OpenDialog;
  sleep?: (ms: number) => Promise<void>;
}

async function loadInvoke(): Promise<Invoke> {
  const m = await import('@tauri-apps/api/core');
  return m.invoke as Invoke;
}

async function loadOpen(): Promise<OpenDialog> {
  const m = await import('@tauri-apps/plugin-dialog');
  return m.open as OpenDialog;
}

/** 사이드카 서버가 준비될 때까지 기다린다 (WSL /mnt/c 위라 수십 초 걸릴 수 있음) */
export async function waitForDesktopServer(
  deps: DesktopDeps = {},
  timeoutMs = 180_000,
): Promise<{ url: string; token: string }> {
  const invoke = deps.invoke ?? (await loadInvoke());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const start = Date.now();
  for (;;) {
    const s = await invoke<DesktopServerStatus>('server_info');
    if (s.state === 'ready') return { url: s.url, token: s.token };
    if (s.state === 'failed') throw new Error(`하네스 서버 시작 실패: ${s.message}`);
    if (Date.now() - start > timeoutMs) throw new Error('하네스 서버 기동 시간 초과');
    await sleep(500);
  }
}

/** 63.3 Explorer형 폴더 대화상자 (취소 → cancelled) */
export async function pickFolderDesktop(
  initialPath?: string,
  deps: DesktopDeps = {},
): Promise<{ cancelled: true } | { cancelled: false; path: string }> {
  const open = deps.open ?? (await loadOpen());
  const r = await open({
    directory: true,
    multiple: false,
    title: '프로젝트 폴더 열기',
    ...(initialPath && /^[A-Za-z]:[\\/]/.test(initialPath) ? { defaultPath: initialPath } : {}),
  });
  const path = Array.isArray(r) ? r[0] : r;
  return path ? { cancelled: false, path } : { cancelled: true };
}
