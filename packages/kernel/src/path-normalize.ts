import { existsSync, realpathSync } from 'node:fs';
import { posix } from 'node:path';

/**
 * 경로 정규화 (판정 사다리 L1, T-025 25.1 → T-100 C.2에서 path 비교기로 이동)
 * 같은 파일을 가리키는 서로 다른 문자열을 하나의 키로 만든다. 모델 호출 없음.
 *  - Unicode NFC (맥·깃의 NFD 한글)
 *  - 구분자 통일 (\ → /), 중복 슬래시·`.`·`..` 정리, 끝 슬래시 제거, 앞뒤 공백 제거
 *  - Windows 드라이브 ⇄ WSL: C:\x → /mnt/c/x, \\wsl$\<distro>\x · \\wsl.localhost\<distro>\x → /x
 *  - Windows 대소문자 무시 (기본 'auto': /mnt/<드라이브>/ 아래만)
 *  - realpath (옵션): 심볼릭 링크 해소, 존재하지 않는 꼬리는 그대로 붙인다
 */

export interface NormalizeOptions {
  /** 상대 경로를 이 경로 기준으로 절대화 (Windows 경로도 허용) */
  cwd?: string;
  /** true: 항상 소문자, false: 그대로, 'auto'(기본): Windows 드라이브(/mnt/<x>/) 경로만 소문자 */
  caseInsensitive?: boolean | 'auto';
  /** true면 존재하는 가장 긴 앞부분을 realpath로 해소 (기본 false) */
  realpath?: boolean;
}

const DRIVE_RE = /^([A-Za-z]):(?:\/|$)/;
const WSL_UNC_RE = /^\/\/wsl(?:\$|\.localhost)\/[^/]+(\/.*)?$/i;
const MNT_DRIVE_RE = /^\/mnt\/[a-zA-Z](?:\/|$)/;

/** 구분자·드라이브·UNC만 바꾼 POSIX 형태 (NFC 포함, 대소문자·realpath 미적용) */
export function toPosixForm(input: string): string {
  let s = input.normalize('NFC').trim().replace(/\\/g, '/');
  const unc = WSL_UNC_RE.exec(s);
  if (unc) s = unc[1] ?? '/';
  const drive = DRIVE_RE.exec(s);
  if (drive) s = `/mnt/${drive[1]!.toLowerCase()}/${s.slice(drive[0].length)}`;
  // /mnt/C/ → /mnt/c/
  if (MNT_DRIVE_RE.test(s)) s = `/mnt/${s[5]!.toLowerCase()}${s.slice(6)}`;
  return s;
}

function clean(p: string): string {
  if (p === '') return '';
  let s = posix.normalize(p);
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  if (s === '.') return '';
  if (s.startsWith('./')) s = s.slice(2);
  return s;
}

function realpathPrefix(abs: string): string {
  const parts = abs.split('/');
  for (let n = parts.length; n > 1; n--) {
    const head = parts.slice(0, n).join('/') || '/';
    if (existsSync(head)) {
      let real: string;
      try {
        real = realpathSync.native(head);
      } catch {
        return abs;
      }
      const tail = parts.slice(n).join('/');
      return tail ? posix.join(real.replace(/\\/g, '/'), tail) : real.replace(/\\/g, '/');
    }
  }
  return abs;
}

/** 경로 → 비교용 정규 키 */
export function normalizePath(input: string, opts: NormalizeOptions = {}): string {
  let s = toPosixForm(input);
  if (!s.startsWith('/') && opts.cwd !== undefined) {
    const base = normalizePath(opts.cwd, { ...opts, cwd: undefined, realpath: false });
    s = posix.join(base, s);
  }
  s = clean(s);
  if (opts.realpath && s.startsWith('/')) s = clean(toPosixForm(realpathPrefix(s)));
  const ci = opts.caseInsensitive ?? 'auto';
  if (ci === true || (ci === 'auto' && MNT_DRIVE_RE.test(s))) s = s.toLowerCase();
  return s.normalize('NFC');
}

/** child가 parent와 같거나 그 아래인가 (정규 키 기준) */
export function isWithinKey(childKey: string, parentKey: string): boolean {
  if (childKey === parentKey) return true;
  if (parentKey === '' || parentKey === '/') return parentKey === '/' ? childKey.startsWith('/') : true;
  return childKey.startsWith(parentKey + '/');
}
