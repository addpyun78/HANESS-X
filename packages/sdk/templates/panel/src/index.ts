/**
 * {{displayName}} — 패널 플러그인
 * 패널 설명자: 위치·제목·render(). render()는 하네스 웹 앱이 격리된 영역에 그리는 HTML 문자열을 돌려준다.
 */

export interface PluginContext {
  manifest: { id: string; version: string };
  log(message: string): void;
}

export interface PanelState {
  sessionId?: string;
}

export const panel = {
  id: '{{id}}',
  title: '{{json:displayName}}',
  placement: 'right' as 'left' | 'right' | 'bottom',
  render(state: PanelState): string {
    const session = escapeHtml(state.sessionId ?? '-');
    return `<section><h2>${escapeHtml(panel.title)}</h2><p>session: ${session}</p></section>`;
  },
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function activate(ctx: PluginContext): void {
  ctx.log(`panel ${panel.id} registered`);
}

export function deactivate(): void {}
