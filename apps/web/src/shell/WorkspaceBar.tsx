import type { Workspace } from './types.js';

/**
 * 상단 바의 워크스페이스 표시 (T-035): 프로젝트 이름 · 실제 경로 · git 브랜치 · AGENTS.md/CLAUDE.md 표시.
 * + → 폴더 선택이 끝나면 이 자리가 새 워크스페이스로 바뀐다.
 */
export function WorkspaceBar({ workspace }: { workspace?: Workspace }) {
  return (
    <div className="hx-topbar__ws" data-testid="workspace">
      {workspace ? (
        <>
          <strong className="hx-topbar__name">{workspace.name}</strong>
          <span className="hx-topbar__path hx-mono" title={workspace.path}>
            {workspace.path}
          </span>
          {workspace.branch && (
            <span className="hx-topbar__branch hx-mono" aria-label={`브랜치 ${workspace.branch}`}>
              ⎇ {workspace.branch}
            </span>
          )}
          {workspace.hasAgentsMd && (
            <span className="hx-topbar__doc" title="AGENTS.md 있음">
              AGENTS.md
            </span>
          )}
          {workspace.hasClaudeMd && (
            <span className="hx-topbar__doc" title="CLAUDE.md 있음">
              CLAUDE.md
            </span>
          )}
        </>
      ) : (
        <span className="hx-topbar__empty">프로젝트를 선택하세요</span>
      )}
    </div>
  );
}
