import { useEffect, useState } from 'react';
import type { EnginesApi } from './api.js';
import {
  LOGIN_LABEL,
  type AuthMode,
  type EngineCardModel,
  type LoginState,
  type PingResult,
} from './model.js';
import { act } from '../../actions/registry.js';

export interface EngineCardProps {
  card: EngineCardModel;
  api: EnginesApi;
  /** 폴백 후보 (자기 자신 제외는 카드가 한다) */
  fallbackOptions: { id: string; label: string }[];
  /** 저장 뒤 목록 다시 읽기 */
  onSaved?: () => void;
}

/** 엔진 카드 — 설치된 엔진: 이름·버전·위치·로그인 배지 + 인증·모델·폴백·테스트 / 미설치: 회색 + 설치 안내 */
export function EngineCard({ card, api, fallbackOptions, onSaved }: EngineCardProps) {
  if (!card.installed) {
    return (
      <article className="hx-engine-card" data-installed="false" aria-label={`${card.label} (미설치)`}>
        <header className="hx-engine-card__head">
          <strong>{card.label}</strong>
          <span className="hx-badge hx-badge--muted">미설치</span>
        </header>
        {card.installUrl && (
          <a
            {...act('engines.install-guide')}
            className="hx-engine-card__install"
            href={card.installUrl}
            target="_blank"
            rel="noreferrer"
          >
            설치 안내
          </a>
        )}
      </article>
    );
  }
  return <InstalledCard card={card} api={api} fallbackOptions={fallbackOptions} onSaved={onSaved} />;
}

function InstalledCard({ card, api, fallbackOptions, onSaved }: EngineCardProps) {
  // T-101 5D.7 자동 상태: 스캔이 이미 확인했으면 그대로 보여 주고, 모를 때만 상태 명령으로 묻는다
  const [login, setLogin] = useState<LoginState | undefined>(card.login);
  const [mode, setMode] = useState<AuthMode>(card.mode);
  const [keyInput, setKeyInput] = useState('');
  const [masked, setMasked] = useState(card.key?.masked);
  const [model, setModel] = useState(card.model ?? '');
  const [fallback, setFallback] = useState(card.fallback[0] ?? '');
  const [ping, setPing] = useState<PingResult | 'running'>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (card.login) return;
    let live = true;
    api
      .login(card.id)
      .then((r) => live && setLogin(r.state))
      .catch(() => live && setLogin('unknown'));
    return () => {
      live = false;
    };
  }, [api, card.id, card.login]);

  const guard = async (fn: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await fn();
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const changeMode = (m: AuthMode) => {
    setMode(m);
    void guard(() => api.saveSettings(card.id, { mode: m }));
  };

  const saveKey = () =>
    guard(async () => {
      const r = await api.saveKey(card.id, keyInput);
      setMasked(r.key.masked);
      setKeyInput(''); // 원문은 화면에 남기지 않는다
    });

  const runPing = async () => {
    setPing('running');
    try {
      setPing(await api.ping(card.id));
    } catch (e) {
      setPing({
        ok: false,
        engineId: card.id,
        text: '',
        latencyMs: 0,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const loc = card.locations[0];
  return (
    <article className="hx-engine-card" data-installed="true" data-engine={card.id} aria-label={card.label}>
      <header className="hx-engine-card__head">
        <strong>{card.label}</strong>
        {card.version && <span className="hx-mono">v{card.version}</span>}
        {login && (
          <span className={`hx-badge hx-badge--${login}`} data-testid="login-badge">
            {LOGIN_LABEL[login]}
          </span>
        )}
      </header>
      <ul className="hx-engine-card__locs">
        {card.locations.map((l) => (
          <li key={l.location + l.path}>
            <span className="hx-badge">{l.label}</span>{' '}
            <span className="hx-mono" title={l.path}>
              {l.path}
            </span>
            {l.status === 'outdated' && <span className="hx-badge hx-badge--warn">업데이트 필요</span>}
          </li>
        ))}
      </ul>

      <fieldset className="hx-engine-card__mode">
        <legend>인증</legend>
        <label>
          <input
            type="radio"
            name={`mode-${card.id}`}
            checked={mode === 'subscription'}
            onChange={() => changeMode('subscription')}
          />
          구독
        </label>
        <label>
          <input
            type="radio"
            name={`mode-${card.id}`}
            checked={mode === 'apiKey'}
            onChange={() => changeMode('apiKey')}
          />
          API
        </label>
      </fieldset>

      {mode === 'apiKey' && (
        <div className="hx-engine-card__row">
          <span className="hx-mono" data-testid="key-masked">
            {masked ?? '키 없음'}
          </span>
          <input
            type="password"
            autoComplete="off"
            aria-label={`${card.label} API 키`}
            placeholder="API 키 입력"
            value={keyInput}
            onChange={(e) => setKeyInput(e.currentTarget.value)}
          />
          <button
            {...act('engines.save-key')}
            type="button"
            className="hx-icon-btn"
            disabled={!keyInput.trim()}
            title={keyInput.trim() ? undefined : '키를 먼저 넣어 주세요'}
            onClick={saveKey}
          >
            키 저장
          </button>
        </div>
      )}

      <div className="hx-engine-card__row">
        <label>
          기본 모델{' '}
          <input
            aria-label={`${card.label} 기본 모델`}
            placeholder="엔진 기본값"
            value={model}
            onChange={(e) => setModel(e.currentTarget.value)}
          />
        </label>
        <label>
          폴백{' '}
          <select
            aria-label={`${card.label} 폴백 엔진`}
            value={fallback}
            onChange={(e) => setFallback(e.currentTarget.value)}
          >
            <option value="">없음</option>
            {fallbackOptions
              .filter((o) => o.id !== card.id)
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
          </select>
        </label>
        <button
          {...act('engines.save-settings')}
          type="button"
          className="hx-icon-btn"
          onClick={() =>
            guard(() =>
              api.saveSettings(card.id, {
                model: model.trim() || null,
                fallback: fallback ? [fallback] : [],
              }),
            )
          }
        >
          저장
        </button>
      </div>

      <div className="hx-engine-card__row">
        <button
          {...act('engines.ping')}
          type="button"
          className="hx-icon-btn"
          disabled={ping === 'running'}
          title={ping === 'running' ? '시험하는 중이에요' : 'AI를 실제로 한 번 불러 봐요. 사용량이 조금 들어요.'}
          onClick={runPing}
        >
          테스트 실행
        </button>
        <span className="hx-engine-card__note">선택 · 상태는 자동으로 확인해요</span>
        {ping && (
          <span role="status" data-testid="ping-result" data-ok={ping !== 'running' && ping.ok}>
            {ping === 'running'
              ? '실행 중…'
              : ping.ok
                ? `성공 · ${ping.latencyMs}ms · ${ping.text}`
                : `실패 · ${ping.error ?? ''}`}
          </span>
        )}
      </div>
      {loc?.status === 'unknown' && <p className="hx-engine-card__note">버전을 확인하지 못했습니다</p>}
      {error && (
        <p role="alert" className="hx-engine-card__error">
          {error}
        </p>
      )}
    </article>
  );
}
