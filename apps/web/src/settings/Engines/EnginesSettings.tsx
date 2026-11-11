import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EnginesApi } from './api.js';
import { EngineCard } from './EngineCard.js';
import { buildEngineCards, type EngineCardModel } from './model.js';
import './engines.css';

export interface EnginesSettingsProps {
  api: EnginesApi;
}

/** T-038 설정 > 엔진: 엔진 카드 그리드 + 다시 스캔 */
export function EnginesSettings({ api }: EnginesSettingsProps) {
  const [cards, setCards] = useState<EngineCardModel[]>();
  const [scannedAt, setScannedAt] = useState<string>();
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string>();
  /** 카드 상태 초기화용 (다시 스캔 후 새로 그림) */
  const [gen, setGen] = useState(0);

  const reload = useCallback(async () => {
    try {
      const r = await api.list();
      setCards(buildEngineCards(r));
      setScannedAt(r.scan?.scannedAt);
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [api]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const rescan = async () => {
    setScanning(true);
    try {
      await api.rescan();
      await reload();
      setGen((g) => g + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  };

  const fallbackOptions = useMemo(
    () => (cards ?? []).filter((c) => c.installed).map((c) => ({ id: c.id, label: c.label })),
    [cards],
  );

  return (
    <section className="hx-engines" aria-label="엔진 설정">
      <header className="hx-engines__head">
        <h2>엔진</h2>
        {scannedAt && (
          <span className="hx-engines__scanned">
            마지막으로 찾은 때 <time dateTime={scannedAt}>{scannedAt.slice(0, 16).replace('T', ' ')}</time>
          </span>
        )}
        <button type="button" className="hx-icon-btn" onClick={rescan} disabled={scanning}>
          {scanning ? '찾는 중…' : '다시 찾기'}
        </button>
      </header>
      {error && (
        <p role="alert" className="hx-engine-card__error">
          {error}
        </p>
      )}
      {cards === undefined && !error && <p className="hx-engines__loading">불러오는 중…</p>}
      {cards && (
        <div className="hx-engines__grid">
          {cards.map((c) => (
            <EngineCard key={`${c.id}:${gen}`} card={c} api={api} fallbackOptions={fallbackOptions} />
          ))}
        </div>
      )}
    </section>
  );
}
