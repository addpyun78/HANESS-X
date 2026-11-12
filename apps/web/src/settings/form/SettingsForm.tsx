import { useCallback, useEffect, useMemo, useState } from 'react';
import { applyTheme, THEME_KEY, type ThemePref } from '../../design/theme.js';
import { errorMessage, type SettingsApi, type SettingsWidgetContext } from './api.js';
import { CUSTOM_WIDGETS } from './custom-widgets.js';
import type { SaveScope, SettingField, SettingGroup, SettingsResponse, SettingValueState } from './types.js';
import { BASIC_WIDGETS, enumValues } from './widgets.js';
import './settings-form.css';

/**
 * T-101 0-1 설정 폼 자동 렌더러 — 레지스트리(GET /api/settings)만 보고 그룹 → 섹션 → 항목을 그린다.
 *  - 저장 즉시 적용(0A.7): 바꾸면 바로 PUT, restartRequired 항목은 "다시 시작하면 적용돼요."
 *  - 잘못된 값은 서버의 쉬운 말 오류를 항목 아래에 보여 준다
 *  - 되돌리기(0A.8): 항목 / 섹션 / 전체를 기본값으로
 *  - 플러그인 그룹은 플러그인별 소제목 아래에(0A.9)
 * 화면 메뉴 연결·섹션별 꾸미기는 6번(설정 화면 채우기)이 한다.
 */

export interface SettingsFormProps {
  api: SettingsApi;
  ctx?: SettingsWidgetContext;
  /** 이 그룹들만 그린다 (기본: 전부) */
  groups?: readonly string[];
  /** 고급 항목도 보이기 (기본 false) */
  showAdvanced?: boolean;
  /** 프로젝트 범위로 저장 (scope project|both 항목만 보임) */
  scope?: SaveScope;
  project?: string;
  /** 브라우저 저장 항목용 저장소 (기본 localStorage) */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  /** 브라우저 저장 항목이 바뀐 뒤 (기본: 테마는 바로 적용) */
  onBrowserChange?: (field: SettingField, value: unknown) => void;
}

const RESTART_NOTICE = '다시 시작하면 적용돼요.';
const SAVED_NOTICE = '저장했어요.';

function safeStorage(s?: SettingsFormProps['storage']) {
  try {
    return s ?? globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** 브라우저 저장 값 읽기 (선택지에 없으면 기본값) */
function readBrowser(f: SettingField, st?: SettingsFormProps['storage']): SettingValueState {
  let raw: string | null = null;
  try {
    raw = st?.getItem(f.browserKey!) ?? null;
  } catch {
    raw = null;
  }
  if (raw === null) return { effective: f.default, source: 'default' };
  const vals = enumValues(f);
  if (vals.length && !vals.includes(raw)) return { effective: f.default, source: 'default' };
  return { effective: raw, source: 'global', global: raw };
}

const defaultBrowserChange = (f: SettingField, v: unknown) => {
  if (f.browserKey === THEME_KEY && typeof document !== 'undefined') applyTheme(v as ThemePref);
};

export function SettingsForm(props: SettingsFormProps) {
  const { api, ctx: ctxIn, showAdvanced = false, scope = 'global', project } = props;
  const storage = safeStorage(props.storage);
  const [data, setData] = useState<SettingsResponse>();
  const [values, setValues] = useState<Record<string, SettingValueState>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notices, setNotices] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string>();
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(false);

  const withBrowser = useCallback(
    (r: SettingsResponse, v: Record<string, SettingValueState>) => {
      const out = { ...v };
      for (const f of r.fields) if (f.storage === 'browser') out[f.key] = readBrowser(f, storage);
      return out;
    },
    [storage],
  );

  const load = useCallback(async () => {
    try {
      const r = await api.load(project);
      setData(r);
      setValues(withBrowser(r, r.values));
      setLoadError(undefined);
    } catch (e) {
      setLoadError(errorMessage(e).replace('저장하지', '설정을 불러오지'));
    }
  }, [api, project, withBrowser]);

  useEffect(() => {
    void load();
  }, [load]);

  const ctx = useMemo<SettingsWidgetContext>(
    () => ({
      saveSecret: (k, v) => api.saveSecret(k, v),
      deleteSecret: (k) => api.deleteSecret(k),
      ...ctxIn,
    }),
    [api, ctxIn],
  );

  const flat = useMemo(
    () => Object.fromEntries(Object.entries(values).map(([k, s]) => [k, s.effective])),
    [values],
  );

  const visible = useCallback(
    (f: SettingField) =>
      (showAdvanced || !f.advanced) &&
      (!props.groups || props.groups.includes(f.group)) &&
      (scope === 'global' ? f.scope !== 'project' : f.scope !== 'global'),
    [showAdvanced, props.groups, scope],
  );

  const commit = async (f: SettingField, v: unknown) => {
    setErrors(({ [f.key]: _e, ...rest }) => rest);
    if (f.storage === 'browser') {
      try {
        storage?.setItem(f.browserKey!, String(v));
      } catch {
        /* 저장소를 쓸 수 없음 */
      }
      setValues((s) => ({ ...s, [f.key]: { effective: v, source: 'global', global: v } }));
      setNotices((n) => ({ ...n, [f.key]: SAVED_NOTICE }));
      (props.onBrowserChange ?? defaultBrowserChange)(f, v);
      return;
    }
    try {
      const r = await api.save(f.key, v, scope, project);
      setValues((s) => ({ ...s, [f.key]: r.state }));
      setNotices((n) => ({ ...n, [f.key]: r.restartRequired ? (r.notice ?? RESTART_NOTICE) : SAVED_NOTICE }));
    } catch (e) {
      setErrors((x) => ({ ...x, [f.key]: errorMessage(e) }));
      setNotices(({ [f.key]: _n, ...rest }) => rest);
    }
  };

  /** 0A.8 되돌리기 — 브라우저 항목은 여기서 지우고, 나머지는 서버에 맡긴다 */
  const reset = async (target: { key: string } | { group: string } | { all: true }) => {
    if (!data) return;
    setBusy(true);
    const fields = data.fields.filter((f) =>
      'key' in target ? f.key === target.key : 'group' in target ? f.group === target.group : true,
    );
    for (const f of fields)
      if (f.storage === 'browser') {
        try {
          storage?.removeItem(f.browserKey!);
        } catch {
          /* noop */
        }
        (props.onBrowserChange ?? defaultBrowserChange)(f, f.default);
      }
    try {
      const needServer = fields.some((f) => f.storage === 'settings');
      const r = needServer ? await api.reset(target, scope, project) : undefined;
      setValues((s) => withBrowser(data, { ...s, ...(r?.values ?? {}) }));
      const keys = new Set(fields.map((f) => f.key));
      setErrors((x) => Object.fromEntries(Object.entries(x).filter(([k]) => !keys.has(k))));
      setNotices((n) => ({
        ...Object.fromEntries(Object.entries(n).filter(([k]) => !keys.has(k))),
        ...Object.fromEntries(
          fields
            .filter((f) => f.storage === 'settings' || f.storage === 'browser')
            .map((f) => [
              f.key,
              f.restartRequired ? `기본값으로 되돌렸어요. ${RESTART_NOTICE}` : '기본값으로 되돌렸어요.',
            ]),
        ),
      }));
    } catch (e) {
      const msg = errorMessage(e);
      setErrors((x) => ({ ...x, ...Object.fromEntries(fields.map((f) => [f.key, msg])) }));
    } finally {
      setBusy(false);
      setConfirmAll(false);
    }
  };

  if (loadError)
    return (
      <div className="hx-settings-form" role="alert">
        {loadError}
      </div>
    );
  if (!data) return <div className="hx-settings-form">설정을 불러오는 중…</div>;

  const renderField = (f: SettingField) => {
    const st = values[f.key];
    const inputId = `hx-setting-${f.key.replace(/[^a-zA-Z0-9-]/g, '-')}`;
    const common = {
      field: f,
      value: st?.effective ?? f.default,
      onCommit: (v: unknown) => void commit(f, v),
      disabled: busy,
      inputId,
    };
    const Custom = (CUSTOM_WIDGETS as Record<string, (typeof CUSTOM_WIDGETS)[keyof typeof CUSTOM_WIDGETS]>)[
      f.widget
    ];
    const Basic = (BASIC_WIDGETS as Record<string, (typeof BASIC_WIDGETS)[keyof typeof BASIC_WIDGETS]>)[
      f.widget
    ];
    const resettable = (f.storage === 'settings' || f.storage === 'browser') && st?.source !== 'default';
    return (
      <div
        key={f.key}
        className="hx-setting"
        data-setting-key={f.key}
        data-widget={f.widget}
        {...(f.advanced ? { 'data-advanced': '' } : {})}
      >
        <div className="hx-setting__head">
          <label className="hx-setting__title" htmlFor={inputId}>
            {f.title}
          </label>
          {f.restartRequired && <span className="hx-setting__tag">다시 시작 필요</span>}
          {f.advanced && <span className="hx-setting__tag">고급</span>}
          {resettable && (
            <button
              type="button"
              className="hx-setting__link hx-setting__reset"
              data-action="settings.reset-field"
              disabled={busy}
              title={busy ? '저장하는 중이에요' : undefined}
              onClick={() => void reset({ key: f.key })}
            >
              기본값으로
            </button>
          )}
        </div>
        <p className="hx-setting__desc">{f.description}</p>
        <div className="hx-setting__control">
          {Custom ? (
            <Custom
              {...common}
              ctx={ctx}
              values={flat}
              masked={st?.masked ?? null}
              onMasked={(m) => setValues((s) => ({ ...s, [f.key]: { ...s[f.key]!, masked: m } }))}
            />
          ) : Basic ? (
            <Basic {...common} />
          ) : (
            <BASIC_WIDGETS.string {...common} />
          )}
        </div>
        {st?.invalid && !errors[f.key] && (
          <p className="hx-setting__warn">저장된 값이 맞지 않아 기본값을 쓰고 있어요. {st.invalid}</p>
        )}
        {errors[f.key] ? (
          <p role="alert" className="hx-setting__error">
            {errors[f.key]}
          </p>
        ) : (
          notices[f.key] && (
            <p role="status" className="hx-setting__notice">
              {notices[f.key]}
            </p>
          )
        )}
      </div>
    );
  };

  const renderGroup = (g: SettingGroup) => {
    const fields = data.fields.filter((f) => f.group === g.id && visible(f));
    if (props.groups && !props.groups.includes(g.id)) return null;
    const plugins = [...new Set(fields.filter((f) => f.plugin).map((f) => f.plugin!.id))];
    const plain = fields.filter((f) => !f.plugin);
    return (
      <section
        key={g.id}
        className="hx-settings-form__section"
        data-setting-group={g.id}
        aria-label={g.title}
      >
        <header className="hx-settings-form__section-head">
          <h3>{g.title}</h3>
          {fields.some((f) => f.storage === 'settings' || f.storage === 'browser') && (
            <button
              type="button"
              className="hx-setting__link"
              data-action="settings.reset-group"
              disabled={busy}
              title={busy ? '저장하는 중이에요' : undefined}
              onClick={() => void reset({ group: g.id })}
            >
              이 묶음 기본값으로
            </button>
          )}
        </header>
        <p className="hx-settings-form__section-desc">{g.description}</p>
        {plain.map(renderField)}
        {plugins.map((id) => {
          const pf = fields.filter((f) => f.plugin?.id === id);
          return (
            <div key={id} className="hx-settings-form__plugin" data-setting-plugin={id}>
              <h4>{pf[0]!.plugin!.title}</h4>
              {pf.map(renderField)}
            </div>
          );
        })}
        {fields.length === 0 && <p className="hx-settings-form__empty">아직 바꿀 수 있는 설정이 없어요.</p>}
      </section>
    );
  };

  return (
    <div className="hx-settings-form">
      <div className="hx-settings-form__top">
        {confirmAll ? (
          <span className="hx-settings-form__confirm" role="group" aria-label="모두 되돌리기 확인">
            모든 설정을 기본값으로 되돌릴까요?
            <button
              type="button"
              data-action="settings.reset-all-confirm"
              disabled={busy}
              title={busy ? '저장하는 중이에요' : undefined}
              onClick={() => void reset({ all: true })}
            >
              되돌리기
            </button>
            <button
              type="button"
              data-action="settings.reset-all-cancel"
              onClick={() => setConfirmAll(false)}
            >
              그만두기
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="hx-setting__link"
            data-action="settings.reset-all"
            onClick={() => setConfirmAll(true)}
          >
            모든 설정 기본값으로
          </button>
        )}
      </div>
      {data.groups.map(renderGroup)}
    </div>
  );
}
