import { useEffect, useState } from 'react';
import { errorMessage, type SettingsWidgetContext } from './api.js';
import { StringWidget, type WidgetProps } from './widgets.js';

/**
 * T-101 0A.6 맞춤 위젯 3종
 *  - 엔진·모델 선택기: 엔진은 지금 있는 엔진 목록(ctx.listEngines), 모델은 ctx.listModels(5번에서 채움) 또는 직접 입력
 *  - 키 입력기: 키체인에만 저장(ctx.saveSecret), 화면에는 가린 값만
 *  - 폴더 선택기: T-034 폴더 대화상자(ctx.pickFolder) 재사용
 */

export interface CustomWidgetProps extends WidgetProps {
  ctx: SettingsWidgetContext;
  /** 지금 화면의 모든 값 (모델 선택기가 짝 엔진 값을 본다) */
  values: Record<string, unknown>;
  /** 키체인 상태 (가린 값, 없으면 null) */
  masked?: string | null;
  /** 키 저장·지우기 후 가린 값 갱신 */
  onMasked?: (masked: string | null) => void;
}

type EngineItem = { id: string; displayName?: string };

function useEngines(ctx: SettingsWidgetContext): EngineItem[] {
  const [list, setList] = useState<EngineItem[]>([]);
  useEffect(() => {
    let live = true;
    ctx
      .listEngines?.()
      .then((l) => live && setList(l))
      .catch(() => live && setList([]));
    return () => {
      live = false;
    };
  }, [ctx]);
  return list;
}

/** 엔진 고르기 — 빈 값 = 자동 */
export function EnginePicker({ value, onCommit, disabled, inputId, ctx }: CustomWidgetProps) {
  const engines = useEngines(ctx);
  const cur = typeof value === 'string' ? value : '';
  const known = engines.some((e) => e.id === cur);
  return (
    <select
      id={inputId}
      className="hx-setting__select"
      value={cur}
      disabled={disabled}
      onChange={(e) => onCommit(e.currentTarget.value)}
    >
      <option value="">자동으로 고르기</option>
      {engines.map((e) => (
        <option key={e.id} value={e.id}>
          {e.displayName ?? e.id}
        </option>
      ))}
      {cur && !known && <option value={cur}>{cur} (지금 없음)</option>}
    </select>
  );
}

/** 모델 고르기 — 짝 엔진(field.engineKey)의 모델 목록을 제안하고, 직접 입력도 된다 */
export function ModelPicker(p: CustomWidgetProps) {
  const { field, ctx, values, inputId } = p;
  const engine = field.engineKey ? values[field.engineKey] : undefined;
  const [models, setModels] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    if (typeof engine === 'string' && engine && ctx.listModels)
      ctx
        .listModels(engine)
        .then((m) => live && setModels(m))
        .catch(() => live && setModels([]));
    else setModels([]);
    return () => {
      live = false;
    };
  }, [ctx, engine]);
  const listId = `${inputId}-models`;
  return (
    <span className="hx-setting__model">
      <StringWidget {...p} {...(models.length > 0 ? { listId } : {})} />
      {models.length > 0 && (
        <datalist id={listId} data-testid="model-options">
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      )}
    </span>
  );
}

/** 키 입력기 — 입력한 키는 화면에 남기지 않고 가린 값만 보인다 */
export function SecretKeyInput({ field, disabled, inputId, ctx, masked, onMasked }: CustomWidgetProps) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!text.trim()) return setError('키를 넣어 주세요.');
    if (!ctx.saveSecret) return setError('키 보관함을 쓸 수 없어요.');
    setBusy(true);
    try {
      const r = await ctx.saveSecret(field.key, text);
      setText('');
      setError(undefined);
      onMasked?.(r.masked);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await ctx.deleteSecret?.(field.key);
      onMasked?.(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="hx-setting__secret">
      <span className="hx-setting__masked" data-testid="secret-state">
        {masked ? `저장됨 ${masked}` : '저장된 키 없음'}
      </span>
      <input
        id={inputId}
        type="password"
        autoComplete="off"
        className="hx-setting__input"
        value={text}
        placeholder={masked ? '새 키로 바꾸기' : '키 붙여 넣기'}
        disabled={disabled || busy}
        onChange={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) void save();
        }}
      />
      <button type="button" data-action="settings.secret-save" disabled={disabled || busy} onClick={save}>
        저장
      </button>
      {masked && (
        <button
          type="button"
          className="hx-setting__link"
          data-action="settings.secret-delete"
          disabled={disabled || busy}
          onClick={remove}
        >
          지우기
        </button>
      )}
      {error && (
        <span role="alert" className="hx-setting__error">
          {error}
        </span>
      )}
    </span>
  );
}

/** 폴더 선택기 — [폴더 고르기]는 T-034 대화상자, 직접 입력도 된다 */
export function FolderPicker(p: CustomWidgetProps) {
  const { value, onCommit, disabled, ctx } = p;
  const [error, setError] = useState<string>();
  const pick = async () => {
    if (!ctx.pickFolder) return;
    try {
      const r = await ctx.pickFolder(typeof value === 'string' && value ? value : undefined);
      setError(undefined);
      if (!r.cancelled) onCommit(r.path);
    } catch (e) {
      setError((e as { status?: number }).status === 409 ? '폴더 창이 이미 열려 있어요.' : errorMessage(e));
    }
  };
  return (
    <span className="hx-setting__folder">
      <StringWidget {...p} />
      {ctx.pickFolder && (
        <button type="button" data-action="settings.pick-folder" disabled={disabled} onClick={pick}>
          폴더 고르기
        </button>
      )}
      {error && (
        <span role="alert" className="hx-setting__error">
          {error}
        </span>
      )}
    </span>
  );
}

/** 엔진별 로그인·모델 묶음 — 설정 > 엔진 화면을 그대로 넣거나 안내만 */
export function EngineSettingsWidget({ ctx }: CustomWidgetProps) {
  if (ctx.renderEngineSettings) return <div className="hx-setting__embed">{ctx.renderEngineSettings()}</div>;
  return <span className="hx-setting__hint">엔진 화면에서 엔진마다 바꿀 수 있어요.</span>;
}

export const CUSTOM_WIDGETS = {
  engine: EnginePicker,
  model: ModelPicker,
  secret: SecretKeyInput,
  folder: FolderPicker,
  'engine-settings': EngineSettingsWidget,
} as const;
