import { useState } from 'react';
import { PERMISSION_LABEL, type EngineOption, type PermissionMode } from '../../composer/types.js';
import type { SettingsApi, SettingsWidgetContext } from '../../settings/form/api.js';
import { SettingsForm } from '../../settings/form/SettingsForm.js';
import type { ProjectDefaults, ProjectInfo, ProjectView } from './api.js';
import { MODE_LABEL } from './model.js';

/**
 * 0B.41 프로젝트 설정 ("프로젝트 범위" 화면)
 *  - 위: 이름·폴더 다시 연결·새 세션 기본값(0B.40 projects.json defaults — 엔진·에이전트 목록이 필요한 고르기 칸)
 *  - 아래(T-101 6B.14): 0-1 설정 틀 SettingsForm(scope=project) — 레지스트리의 project|both 키를 이 프로젝트 값으로.
 *    다른 구역이 scope both 키(예: mode.default)를 등록하면 여기에 저절로 나타난다.
 */

export interface ProjectSettingsValue {
  name: string;
  defaults: ProjectDefaults;
}

export interface ProjectSettingsProps {
  project: ProjectView;
  info?: ProjectInfo;
  engines: EngineOption[];
  agents: { command: string; name: string }[];
  onSave: (v: ProjectSettingsValue) => void | Promise<void>;
  onRelink: () => void;
  onClose: () => void;
  /**
   * T-101 6B.14 0-1 설정 틀의 프로젝트 범위(scope=project) — 레지스트리에서 scope가 project|both인 키를
   * 이 프로젝트 값으로 저장한다(<프로젝트>/.harness-x/project.json). 없으면 이 부분을 그리지 않는다.
   */
  settings?: { api: SettingsApi; ctx?: SettingsWidgetContext };
}

const FOLLOW = '';
const FOLLOW_LABEL = '전체 설정 따르기';

export function ProjectSettings({
  project,
  info,
  engines,
  agents,
  onSave,
  onRelink,
  onClose,
  settings,
}: ProjectSettingsProps) {
  const [name, setName] = useState(project.name);
  const [d, setD] = useState<ProjectDefaults>(project.defaults ?? {});
  const [saved, setSaved] = useState(false);
  const set = (k: keyof ProjectDefaults, v: string) => {
    setSaved(false);
    setD((cur) => {
      const next = { ...cur };
      if (v) next[k] = v;
      else delete next[k];
      return next;
    });
  };
  return (
    <section className="hx-project-settings" role="dialog" aria-label={`${project.name} 프로젝트 설정`}>
      <h2>프로젝트 설정</h2>
      <p className="hx-project-settings__scope">
        여기 값은 이 프로젝트에서 새로 여는 세션에만 쓰여요. 비워 두면 전체 설정을 따라요.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void Promise.resolve(onSave({ name: name.trim() || project.name, defaults: d })).then(() =>
            setSaved(true),
          );
        }}
      >
        <label>
          이름
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="hx-project-settings__folder">
          <span>폴더</span>
          <code>{project.rootPath}</code>
          {project.missing && <span role="status">⚠ 폴더를 찾을 수 없어요</span>}
          <button type="button" onClick={onRelink}>
            폴더 다시 연결
          </button>
        </div>
        <label>
          기본 AI
          <select value={d.engine ?? FOLLOW} onChange={(e) => set('engine', e.target.value)}>
            <option value={FOLLOW}>{FOLLOW_LABEL}</option>
            {engines.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
            {d.engine && !engines.some((x) => x.id === d.engine) && (
              <option value={d.engine}>{d.engine}</option>
            )}
          </select>
        </label>
        <label>
          기본 모델
          <input
            value={d.model ?? ''}
            placeholder={FOLLOW_LABEL}
            onChange={(e) => set('model', e.target.value)}
          />
        </label>
        <label>
          기본 모드
          <select value={d.mode ?? FOLLOW} onChange={(e) => set('mode', e.target.value)}>
            <option value={FOLLOW}>{FOLLOW_LABEL}</option>
            {Object.entries(MODE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          기본 권한
          <select value={d.permission ?? FOLLOW} onChange={(e) => set('permission', e.target.value)}>
            <option value={FOLLOW}>{FOLLOW_LABEL}</option>
            {(Object.keys(PERMISSION_LABEL) as PermissionMode[]).map((k) => (
              <option key={k} value={k}>
                {PERMISSION_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          기본 에이전트
          <select value={d.agent ?? FOLLOW} onChange={(e) => set('agent', e.target.value)}>
            <option value={FOLLOW}>{FOLLOW_LABEL}</option>
            {agents.map((a) => (
              <option key={a.command} value={a.command}>
                {a.name} ({a.command})
              </option>
            ))}
          </select>
        </label>
        <ul className="hx-project-settings__files" aria-label="지침 파일">
          <li>AGENTS.md {info?.hasAgentsMd ? '있음' : '없음'}</li>
          <li>CLAUDE.md {info?.hasClaudeMd ? '있음' : '없음'}</li>
        </ul>
        <div className="hx-project-settings__actions">
          <button type="submit">저장</button>
          <button type="button" onClick={onClose}>
            닫기
          </button>
          {saved && <span role="status">저장했어요</span>}
        </div>
      </form>
      {settings && (
        <section className="hx-project-settings__scoped" aria-label="이 프로젝트에서만 바꿀 설정">
          <h3>이 프로젝트에서만 바꿀 설정</h3>
          <p className="hx-project-settings__scope">
            여기서 바꾼 값은 이 프로젝트에만 쓰이고, 전체 설정보다 먼저 쓰여요.
          </p>
          <SettingsForm
            api={settings.api}
            {...(settings.ctx ? { ctx: settings.ctx } : {})}
            scope="project"
            project={project.id}
            showAdvanced
            hideEmpty
            emptyText="프로젝트마다 바꿀 수 있는 설정이 아직 없어요. 나머지는 전체 설정 화면에서 바꿔요."
          />
        </section>
      )}
    </section>
  );
}
