import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  INSTALL_TOOLS,
  InstallService,
  mockRunner,
  type DetectionTable,
  type InstallServiceOptions,
  type InstallToolName,
  type MockReply,
  type CommandSpec,
  type SecretLike,
} from '../src/index.js';

export function tempHome(prefix = 'hx-installer-'): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** 감지 표: 주어진 도구만 있음 */
export function table(
  present: Partial<Record<InstallToolName, { host?: 'windows' | 'linux'; version?: string; path?: string }>>,
): DetectionTable {
  return Object.fromEntries(
    INSTALL_TOOLS.map((n) => {
      const p = present[n];
      return [
        n,
        p
          ? {
              name: n,
              available: true,
              host: p.host ?? 'windows',
              path: p.path ?? `C:\\bin\\${n}.exe`,
              ...(p.version ? { version: p.version } : {}),
            }
          : { name: n, available: false },
      ];
    }),
  ) as DetectionTable;
}

export function memorySecrets(): SecretLike & { m: Map<string, string> } {
  const m = new Map<string, string>();
  return {
    m,
    get: (a) => m.get(a) ?? null,
    set: (a, v) => void m.set(a, v),
    delete: (a) => m.delete(a),
  };
}

export function service(
  home: string,
  replies: Record<string, MockReply> | ((line: string, cmd: CommandSpec) => MockReply | undefined),
  opts: Partial<InstallServiceOptions> = {},
) {
  const runner = mockRunner(replies);
  const svc = new InstallService({
    home,
    runner,
    platform: 'wsl',
    detection: table({
      winget: {},
      npm: { host: 'linux' },
      uv: { host: 'linux' },
      ollama: { host: 'linux' },
      code: {},
      docker: { host: 'linux' },
      git: { host: 'linux' },
    }),
    ...opts,
  });
  return { svc, runner };
}

export const WINGET_SHOW_JQ = `Found jq [jqlang.jq]
Version: 1.7.1
Publisher: jqlang
Publisher Url: https://jqlang.github.io/jq
Author: Stephen Dolan
Moniker: jq
Description: jq is a lightweight and flexible command-line JSON processor.
Homepage: https://jqlang.github.io/jq
License: MIT
License Url: https://github.com/jqlang/jq/blob/master/COPYING
Agreements:
  Terms of Transaction: https://aka.ms/microsoft-store-terms-of-transaction
Installer:
  Installer Type: portable
  Installer Url: https://github.com/jqlang/jq/releases/download/jq-1.7.1/jq-windows-amd64.exe
`;

export const approval = { gestureId: 'g-test' };
