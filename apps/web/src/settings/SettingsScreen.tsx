import { useEffect, useState, type ReactNode } from 'react';
import { errorMessage, type SettingsApi, type SettingsWidgetContext } from './form/api.js';
import { SettingsForm, type SettingsFormProps } from './form/SettingsForm.js';
import type { SettingGroup } from './form/types.js';
import './settings-screen.css';

/**
 * T-101 6번 설정 화면 — 설계 그림 그대로:
 *   [검색…]                       ☐ 고급 설정 보기
 *   일반 │ AI·엔진 │ 모드·권한 │ … │ 정보   (13개 탭 = 레지스트리 그룹)
 *   ─────────────────────────────────
 *   항목들 (SettingsForm이 레지스트리를 보고 그림)
 * 탭 하나 = 레지스트리 그룹 하나라서, 다른 구역이 키를 등록하면 그 탭에 저절로 나타난다.
 * 레지스트리로 그릴 수 없는 것(엔진 카드·프로젝트 목록·저장된 키·버전)은 `sections`로 탭 아래에 붙인다.
 */

export interface SettingsScreenProps {
  api: SettingsApi;
  ctx?: SettingsWidgetContext;
  /** 처음 열 탭 (그룹 id, 기본 general) */
  initialTab?: string;
  /** 탭 아래에 덧붙일 화면 (그룹 id → 내용) */
  sections?: Readonly<Partial<Record<string, ReactNode>>>;
  /** 지금 고른 프로젝트 (6B.14 "이 프로젝트에서는 ○○을 써요") */
  project?: string;
  projectName?: string;
  storage?: SettingsFormProps['storage'];
  onBrowserChange?: SettingsFormProps['onBrowserChange'];
}

export function SettingsScreen(props: SettingsScreenProps) {
  const { api } = props;
  const [groups, setGroups] = useState<SettingGroup[]>();
  const [loadError, setLoadError] = useState<string>();
  const [tab, setTab] = useState(props.initialTab ?? 'general');
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    let live = true;
    api.load(props.project).then(
      (r) => live && setGroups(r.groups),
      (e: unknown) => live && setLoadError(errorMessage(e).replace('저장하지', '설정을 불러오지')),
    );
    return () => {
      live = false;
    };
  }, [api, props.project]);

  useEffect(() => {
    if (props.initialTab) setTab(props.initialTab);
  }, [props.initialTab]);

  if (loadError)
    return (
      <section className="hx-settings-screen" aria-label="설정">
        <h2>설정</h2>
        <p role="alert">{loadError}</p>
      </section>
    );
  if (!groups)
    return (
      <section className="hx-settings-screen" aria-label="설정">
        <h2>설정</h2>
        <p>설정을 불러오는 중…</p>
      </section>
    );

  const active = groups.find((g) => g.id === tab) ?? groups[0]!;
  const extra = props.sections?.[active.id];

  return (
    <section className="hx-settings-screen" aria-label="설정">
      <header className="hx-settings-screen__head">
        <h2>설정</h2>
        <label className="hx-settings-screen__advanced">
          <input
            type="checkbox"
            checked={advanced}
            data-action="settings.show-advanced"
            onChange={(e) => setAdvanced(e.currentTarget.checked)}
          />
          고급 설정 보기
        </label>
      </header>
      <div className="hx-settings-screen__tabs" role="tablist" aria-label="설정 묶음">
        {groups.map((g) => (
          <button
            key={g.id}
            type="button"
            role="tab"
            id={`hx-settings-tab-${g.id}`}
            aria-selected={g.id === active.id}
            aria-controls="hx-settings-panel"
            data-action="settings.tab"
            data-group={g.id}
            className="hx-settings-screen__tab"
            onClick={() => setTab(g.id)}
          >
            {g.title}
          </button>
        ))}
      </div>
      <div
        className="hx-settings-screen__panel"
        role="tabpanel"
        id="hx-settings-panel"
        aria-labelledby={`hx-settings-tab-${active.id}`}
      >
        <SettingsForm
          key={active.id}
          api={api}
          {...(props.ctx ? { ctx: props.ctx } : {})}
          groups={[active.id]}
          showAdvanced={advanced}
          {...(props.project ? { project: props.project } : {})}
          {...(props.storage ? { storage: props.storage } : {})}
          {...(props.onBrowserChange ? { onBrowserChange: props.onBrowserChange } : {})}
        />
        {extra && (
          <div className="hx-settings-screen__extra" data-settings-extra={active.id}>
            {extra}
          </div>
        )}
      </div>
    </section>
  );
}
