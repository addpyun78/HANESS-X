import { useState } from 'react';
import type { ProjectView, RootSuggestion } from './api.js';
import { act } from '../../actions/registry.js';

/** 0B.16 임시 작업 공간 설명 (쉬운 말) */
export const SCRATCH_HELP =
  '임시 작업 공간은 하네스가 새로 만든 빈 폴더예요. 폴더를 아직 정하지 않았을 때 쓰고, 나중에 원하는 폴더로 옮길 수 있어요.';

export interface WhereToWorkProps {
  recent: ProjectView[];
  onOpenFolder: () => void;
  onPickProject: (id: string) => void;
  onScratch: () => void;
  onCancel?: () => void;
}

/** 0B.15 프로젝트를 고르지 않았을 때 [+ 새 세션] → "어디서 작업할까요?" */
export function WhereToWork({ recent, onOpenFolder, onPickProject, onScratch, onCancel }: WhereToWorkProps) {
  const [showRecent, setShowRecent] = useState(false);
  const usable = recent.filter((p) => !p.missing);
  return (
    <section className="hx-where" role="dialog" aria-label="어디서 작업할까요?">
      <h2>어디서 작업할까요?</h2>
      <p className="hx-where__lead">작업할 폴더를 고르면 그 폴더 안에서만 파일을 읽고 고쳐요.</p>
      <div className="hx-where__actions">
        <button
          {...act('where.open-folder')}
          type="button"
          className="hx-where__primary"
          onClick={onOpenFolder}
        >
          폴더 열기
        </button>
        <button
          {...act('where.recent')}
          type="button"
          aria-expanded={showRecent}
          disabled={usable.length === 0}
          title={usable.length === 0 ? '최근 프로젝트가 없어요' : undefined}
          onClick={() => setShowRecent((x) => !x)}
        >
          최근 프로젝트 ▸
        </button>
        <button {...act('where.scratch')} type="button" onClick={onScratch}>
          임시 작업 공간에서 시작
        </button>
      </div>
      {showRecent && (
        <ul className="hx-where__recent" aria-label="최근 프로젝트">
          {usable.map((p) => (
            <li key={p.id}>
              <button {...act('where.pick-project')} type="button" onClick={() => onPickProject(p.id)}>
                {p.pinned ? '📌 ' : ''}📁 {p.name}
                <span className="hx-where__path">{p.rootPath}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="hx-where__help">{SCRATCH_HELP}</p>
      {onCancel && (
        <button {...act('where.cancel')} type="button" className="hx-where__cancel" onClick={onCancel}>
          닫기
        </button>
      )}
    </section>
  );
}

/** 0B.6 Git 저장소 안쪽 폴더를 골랐을 때 */
export function RootSuggestCard({
  s,
  onUseTop,
  onKeep,
}: {
  s: RootSuggestion;
  onUseTop: () => void;
  onKeep: () => void;
}) {
  return (
    <section className="hx-where hx-where--suggest" role="dialog" aria-label="프로젝트 폴더 확인">
      <p>{s.message ?? `저장소 맨 위 폴더(${s.gitRoot ?? ''})로 할까요?`}</p>
      <p className="hx-where__help">
        고른 폴더({s.path})는 저장소의 일부예요. 맨 위 폴더로 하면 저장소 전체를 한 프로젝트로 다뤄요.
      </p>
      <div className="hx-where__actions">
        <button {...act('where.use-top')} type="button" className="hx-where__primary" onClick={onUseTop}>
          맨 위 폴더로
        </button>
        <button {...act('where.keep')} type="button" onClick={onKeep}>
          고른 폴더 그대로
        </button>
      </div>
    </section>
  );
}
