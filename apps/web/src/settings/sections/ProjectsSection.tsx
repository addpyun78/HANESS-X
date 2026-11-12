import { useState } from 'react';
import type { ProjectView } from '../../shell/projects/api.js';
import type { ProjectAction } from '../../shell/projects/ProjectSidebar.js';
import { act } from '../../actions/registry.js';

/**
 * T-101 6B.10 설정 > 프로젝트 탭의 프로젝트 목록 (0-2 프로젝트 저장소).
 * 고정·고정 해제 / 목록에서 빼기(폴더와 파일은 지우지 않음 — 확인 뒤에만) / 폴더 다시 연결 / [프로젝트 설정](0B.41) 바로가기.
 * 실제 동작은 사이드바와 같은 projectAction을 쓴다.
 */

export interface ProjectsSectionProps {
  projects: readonly ProjectView[];
  onAction: (p: ProjectView, a: ProjectAction) => void;
}

export function ProjectsSection({ projects, onAction }: ProjectsSectionProps) {
  const [confirm, setConfirm] = useState<string>();
  const list = [...projects].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.order - b.order);
  return (
    <section className="hx-settings-screen__card" aria-label="프로젝트 목록">
      <h3>프로젝트 목록</h3>
      <p>여기서 빼도 폴더와 파일은 그대로 있어요. 다시 열면 목록에 돌아와요.</p>
      {list.length === 0 && <p>아직 프로젝트가 없어요. 폴더를 열면 여기에 생겨요.</p>}
      <ul className="hx-settings-screen__list">
        {list.map((p) => (
          <li key={p.id} className="hx-settings-screen__row" data-project-id={p.id}>
            <span>
              <strong>
                {p.pinned && <span aria-label="고정됨">📌 </span>}
                {p.name}
              </strong>{' '}
              <code title={p.rootPath}>{p.rootPath}</code>
              {p.missing && <span role="status"> ⚠ 폴더를 찾을 수 없어요</span>}
            </span>
            {p.missing && (
              <button
                type="button"
                {...act('settings.project-relink')}
                onClick={() => onAction(p, { type: 'relink' })}
              >
                다시 연결
              </button>
            )}
            <button
              type="button"
              {...act('settings.project-pin')}
              onClick={() => onAction(p, { type: 'pin', pinned: !p.pinned })}
            >
              {p.pinned ? '고정 해제' : '고정'}
            </button>
            <button
              type="button"
              {...act('settings.project-settings')}
              onClick={() => onAction(p, { type: 'settings' })}
            >
              프로젝트 설정
            </button>
            {confirm === p.id ? (
              <span role="group" aria-label={`${p.name} 목록에서 빼기 확인`}>
                폴더와 파일은 지우지 않아요.{' '}
                <button
                  type="button"
                  {...act('settings.project-remove-confirm')}
                  onClick={() => {
                    setConfirm(undefined);
                    onAction(p, { type: 'remove' });
                  }}
                >
                  목록에서 빼기
                </button>
                <button
                  type="button"
                  {...act('settings.project-remove-cancel')}
                  onClick={() => setConfirm(undefined)}
                >
                  그만두기
                </button>
              </span>
            ) : (
              <button type="button" {...act('settings.project-remove')} onClick={() => setConfirm(p.id)}>
                목록에서 빼기
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
