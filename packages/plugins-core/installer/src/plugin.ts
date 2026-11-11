import type { PluginContext } from '@harness-x/kernel';
import { InstalledToolsProjector } from './installed-tools-skill.js';
import { InstallService } from './service.js';

/**
 * 하네스 플러그인 진입점. 서비스를 만들고(설치 도구 감지는 처음 쓸 때),
 * config.workspace가 있으면 installed-tools 스킬 투영 훅(session.start·prompt.submit)을 건다.
 * 커널 API 서버에는 activeInstallService()를 ApiServerOptions.install로 넘긴다.
 */
let service: InstallService | undefined;
let dispose: (() => void) | undefined;

export function activate(ctx: PluginContext): void {
  const c = ctx.config;
  service = new InstallService({
    ...(typeof c.home === 'string' ? { home: c.home } : {}),
    settings: { chocoEnabled: c.chocoEnabled === true },
  });
  const ws = typeof c.workspace === 'string' ? c.workspace : undefined;
  if (ws) {
    const projector = new InstalledToolsProjector(service.registry, (h) =>
      typeof h.cwd === 'string' ? h.cwd : ws,
    );
    dispose = projector.install(ctx.hooks);
  }
  ctx.log(`installer active (home=${service.home})`);
}

export function deactivate(): void {
  dispose?.();
  dispose = undefined;
  service = undefined;
}

export function activeInstallService(): InstallService | undefined {
  return service;
}
