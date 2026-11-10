// hello 예제 플러그인: activate 로그 출력 + /hello 명령용 알림 훅
export const VERSION = 'hello-v1';

export function activate(ctx) {
  ctx.log(`activate ${ctx.manifest.id}@${ctx.manifest.version} (${VERSION})`);
  ctx.hooks.onNotify('session.start', (c) => ctx.log(`hello, session ${c.sessionId ?? '?'}`));
}

export function deactivate() {}
