import { useCallback, useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ApiError } from '../api/client.js';
import type { InstallApi } from './api.js';
import { isPlan } from './api.js';
import {
  INSTALL_KINDS,
  KIND_LABEL,
  historyLine,
  pricingBadge,
  type CandidateView,
  type InstallKind,
  type InstallLogRecordView,
  type InstallPlanView,
  type PricingTier,
  type ResolveResultView,
  type ToolEntryView,
} from './model.js';
import './install.css';
import { act } from '../actions/registry.js';

export const INSTALL_TABS = [
  { id: 'installed', label: '설치됨' },
  { id: 'search', label: '찾기' },
  { id: 'url', label: '주소로 설치' },
  { id: 'history', label: '기록' },
] as const;
export type InstallTab = (typeof INSTALL_TABS)[number]['id'];

/** 카드를 띄울 곳 (승인 카드 영역 — useInstallCards) */
export interface InstallCardSink {
  add(plan: InstallPlanView): void;
  addFailure(result: ResolveResultView): void;
}

export interface InstallManagerProps {
  api: InstallApi;
  cards: InstallCardSink;
  initialTab?: InstallTab;
  initialQuery?: string;
}

function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const b = err.body as { message?: string } | undefined;
    return b?.message ?? err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

function Badge({ tier, name }: { tier: PricingTier; name: string }) {
  const b = pricingBadge({ tier }, name);
  return (
    <span className={`hx-action-card__badge hx-action-card__badge--${b.tone}`} data-tone={b.tone}>
      [{b.label}]
    </span>
  );
}

/**
 * 설정 > 설치 관리 (T-100 P2-G.2~G.6)
 *  [설치됨] 이름·배지·종류·버전·[업데이트]·[지우기]
 *  [찾기] 검색창 + 종류 필터 + 무료/유료 필터 → 결과를 고르면 계획 카드
 *  [주소로 설치] 주소 입력 → 후보·추천 → 계획 카드 (실패 카드)
 *  [기록] installs.jsonl 쉬운 말 목록
 * 카드는 모두 승인 카드 영역에 뜬다. 여기서는 실행하지 않는다.
 */
export function InstallManager({
  api,
  cards,
  initialTab = 'installed',
  initialQuery = '',
}: InstallManagerProps) {
  const [tab, setTab] = useState<InstallTab>(initialTab);
  useEffect(() => setTab(initialTab), [initialTab]);

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = INSTALL_TABS.findIndex((t) => t.id === tab);
    const n = (i + (e.key === 'ArrowRight' ? 1 : INSTALL_TABS.length - 1)) % INSTALL_TABS.length;
    setTab(INSTALL_TABS[n]!.id);
    e.preventDefault();
  };

  return (
    <section className="hx-install" aria-label="설치 관리">
      <h2 className="hx-install__title">설치 관리</h2>
      <div className="hx-install__tabs" role="tablist" aria-label="설치 관리 탭" onKeyDown={onTabKey}>
        {INSTALL_TABS.map((t) => (
          <button
            {...act('install.tab')}
            key={t.id}
            type="button"
            role="tab"
            id={`hx-install-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`hx-install-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className="hx-install__tab"
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        className="hx-install__panel"
        role="tabpanel"
        id={`hx-install-panel-${tab}`}
        aria-labelledby={`hx-install-tab-${tab}`}
      >
        {tab === 'installed' && <InstalledTab api={api} cards={cards} />}
        {tab === 'search' && <SearchTab api={api} cards={cards} initialQuery={initialQuery} />}
        {tab === 'url' && <UrlTab api={api} cards={cards} />}
        {tab === 'history' && <HistoryTab api={api} />}
      </div>
    </section>
  );
}

// ── G.3 설치됨 ───────────────────────────────────────────────────
function InstalledTab({ api, cards }: { api: InstallApi; cards: InstallCardSink }) {
  const [tools, setTools] = useState<ToolEntryView[]>();
  const [msg, setMsg] = useState<string>();
  const [updates, setUpdates] = useState<Map<string, InstallPlanView>>();

  useEffect(() => {
    let alive = true;
    api
      .tools()
      .then((r) => alive && setTools(r.tools))
      .catch((err: unknown) => alive && setMsg(errorText(err)));
    return () => {
      alive = false;
    };
  }, [api]);

  const update = async (t: ToolEntryView) => {
    try {
      let map = updates;
      if (!map) {
        const r = await api.updates();
        map = new Map(r.updates.flatMap((p) => (p.toolId ? [[p.toolId, p] as const] : [])));
        setUpdates(map);
      }
      const plan = map.get(t.id);
      if (plan) cards.add(plan);
      else setMsg(`"${t.name}"은(는) 최신 버전이에요.`);
    } catch (err) {
      setMsg(errorText(err));
    }
  };
  const remove = async (t: ToolEntryView) => {
    try {
      cards.add(await api.uninstallPlan(t.id));
    } catch (err) {
      setMsg(errorText(err));
    }
  };

  if (!tools) return <p className="hx-install__empty">{msg ?? '불러오는 중…'}</p>;
  return (
    <>
      {msg && (
        <p className="hx-install__msg" role="status">
          {msg}
        </p>
      )}
      {tools.length === 0 ? (
        <p className="hx-install__empty">
          아직 설치한 도구가 없어요. [찾기]나 [주소로 설치]로 시작해 보세요.
        </p>
      ) : (
        <ul className="hx-install__list" aria-label="설치된 도구">
          {tools.map((t) => (
            <li key={t.id} className="hx-install__row" data-tool-id={t.id}>
              <span className="hx-install__name">{t.name}</span>
              <Badge tier={t.pricing.tier} name={t.name} />
              <span className="hx-install__kind">{KIND_LABEL[t.kind] ?? t.kind}</span>
              <span className="hx-install__version">{t.version || '—'}</span>
              {t.origin === 'imported' && <span className="hx-install__origin">이미 있던 도구</span>}
              <span className="hx-install__actions">
                <button
                  {...act('install.update')}
                  type="button"
                  className="hx-install__btn"
                  onClick={() => void update(t)}
                >
                  업데이트
                </button>
                <button
                  {...act('install.remove')}
                  type="button"
                  className="hx-install__btn"
                  onClick={() => void remove(t)}
                >
                  지우기
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ── G.4 찾기 ─────────────────────────────────────────────────────
/** 종류 필터 묶음 */
export const KIND_FILTERS: { id: string; label: string; kinds: readonly InstallKind[] }[] = [
  { id: 'all', label: '전체', kinds: INSTALL_KINDS },
  { id: 'app', label: '윈도우 앱', kinds: ['winget', 'scoop', 'choco'] },
  { id: 'cli', label: '명령줄 도구', kinds: ['npm-cli', 'python-cli', 'cargo', 'go'] },
  { id: 'model', label: 'AI 모델', kinds: ['ollama-model'] },
  { id: 'mcp', label: 'AI 연결 도구', kinds: ['mcp-local', 'mcp-remote'] },
  { id: 'plugin', label: '플러그인·스킬', kinds: ['harness-plugin', 'skill'] },
  { id: 'ext', label: '확장·이미지', kinds: ['vscode-ext', 'docker-image', 'wsl-apt'] },
];

/** 무료/유료 필터 */
export const PRICE_FILTERS: { id: string; label: string; tiers: readonly PricingTier[] }[] = [
  { id: 'all', label: '전체', tiers: ['free', 'freemium', 'trial', 'paid', 'unknown'] },
  { id: 'free', label: '무료만', tiers: ['free'] },
  { id: 'free-first', label: '무료+유료 기능까지', tiers: ['free', 'freemium'] },
  { id: 'paid', label: '유료·체험판', tiers: ['paid', 'trial'] },
  { id: 'unknown', label: '확인 못 한 것', tiers: ['unknown'] },
];

interface SearchRow {
  key: string;
  candidate: CandidateView;
  plan?: InstallPlanView;
  unavailable?: string;
}

export function filterRows<T extends { candidate: CandidateView; plan?: { pricing: { tier: PricingTier } } }>(
  rows: readonly T[],
  kindFilter: string,
  priceFilter: string,
): T[] {
  const kinds = KIND_FILTERS.find((k) => k.id === kindFilter)?.kinds ?? INSTALL_KINDS;
  const tiers = PRICE_FILTERS.find((p) => p.id === priceFilter)?.tiers ?? PRICE_FILTERS[0]!.tiers;
  return rows.filter(
    (r) => kinds.includes(r.candidate.kind) && tiers.includes(r.plan?.pricing.tier ?? 'unknown'),
  );
}

function SearchTab({
  api,
  cards,
  initialQuery,
}: {
  api: InstallApi;
  cards: InstallCardSink;
  initialQuery: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [kind, setKind] = useState('all');
  const [price, setPrice] = useState('all');
  const [rows, setRows] = useState<SearchRow[]>();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();

  const run = useCallback(
    async (q: string) => {
      if (!q.trim()) return;
      setBusy(true);
      setMsg(undefined);
      try {
        const r = await api.search(q.trim());
        // 무료/유료는 계획을 만들어야 알 수 있다 (계획 = 조회만, 실행 아님)
        const out = await Promise.all(
          r.candidates.slice(0, 8).map(async (c, i): Promise<SearchRow> => {
            const key = `${c.kind}:${c.target.id}:${i}`;
            try {
              const p = await api.plan({ kind: c.kind, target: c.target });
              return isPlan(p)
                ? { key, candidate: c, plan: p }
                : {
                    key,
                    candidate: c,
                    unavailable: `${p.missing.join(', ')}이(가) 없어서 바로 설치할 수 없어요.`,
                  };
            } catch (err) {
              return { key, candidate: c, unavailable: errorText(err) };
            }
          }),
        );
        setRows(out);
      } catch (err) {
        setMsg(errorText(err));
      } finally {
        setBusy(false);
      }
    },
    [api],
  );

  useEffect(() => {
    if (initialQuery) void run(initialQuery);
  }, [initialQuery, run]);

  const shown = useMemo(() => (rows ? filterRows(rows, kind, price) : undefined), [rows, kind, price]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(query);
  };

  return (
    <>
      <form className="hx-install__form" role="search" onSubmit={submit}>
        <input
          type="search"
          className="hx-install__input"
          aria-label="찾을 도구 이름"
          placeholder="예: ffmpeg"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="종류"
          className="hx-install__select"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          {KIND_FILTERS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
        <select
          aria-label="무료/유료"
          className="hx-install__select"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        >
          {PRICE_FILTERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <button
          {...act('install.search')}
          type="submit"
          className="hx-install__btn"
          disabled={busy}
          title={busy ? '찾는 중이에요' : undefined}
        >
          {busy ? '찾는 중…' : '찾기'}
        </button>
      </form>
      {msg && (
        <p className="hx-install__msg" role="alert">
          {msg}
        </p>
      )}
      {shown &&
        (shown.length === 0 ? (
          <p className="hx-install__empty">조건에 맞는 도구가 없어요.</p>
        ) : (
          <ul className="hx-install__list" aria-label="찾은 도구">
            {shown.map((r) => (
              <li key={r.key} className="hx-install__row" data-kind={r.candidate.kind}>
                <span className="hx-install__name">
                  {r.plan?.name ?? r.candidate.target.name ?? r.candidate.target.id}
                </span>
                <Badge tier={r.plan?.pricing.tier ?? 'unknown'} name={r.candidate.label} />
                <span className="hx-install__kind">{KIND_LABEL[r.candidate.kind]}</span>
                <span className="hx-install__label">{r.candidate.label}</span>
                {r.candidate.trust && <span className="hx-install__trust">{r.candidate.trust.level}</span>}
                <span className="hx-install__actions">
                  {r.plan ? (
                    <button
                      {...act('install.add-plan')}
                      type="button"
                      className="hx-install__btn"
                      onClick={() => cards.add(r.plan!)}
                    >
                      이걸로 설치
                    </button>
                  ) : (
                    <span className="hx-install__note">{r.unavailable}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ))}
    </>
  );
}

// ── 주소로 설치 ──────────────────────────────────────────────────
function UrlTab({ api, cards }: { api: InstallApi; cards: InstallCardSink }) {
  const [url, setUrl] = useState('');
  const [result, setResult] = useState<ResolveResultView>();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setMsg(undefined);
    try {
      const r = await api.resolve(url.trim());
      setResult(r);
      if (r.failure || r.candidates.length === 0) cards.addFailure(r);
    } catch (err) {
      setMsg(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const pick = async (c: CandidateView) => {
    try {
      const p = await api.plan({ kind: c.kind, target: c.target });
      if (isPlan(p)) cards.add(p);
      else if (p.bootstrap) cards.add(p.bootstrap);
      else setMsg(`${p.missing.join(', ')}이(가) 없어서 이 방법은 쓸 수 없어요.`);
    } catch (err) {
      setMsg(errorText(err));
    }
  };

  const rec = result?.recommended;
  return (
    <>
      <form className="hx-install__form" onSubmit={(e) => void submit(e)}>
        <input
          type="url"
          className="hx-install__input"
          aria-label="설치할 주소"
          placeholder="https://github.com/..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button
          {...act('install.url-check')}
          type="submit"
          className="hx-install__btn"
          disabled={busy}
          title={busy ? '살펴보는 중이에요' : undefined}
        >
          {busy ? '살펴보는 중…' : '확인'}
        </button>
      </form>
      {msg && (
        <p className="hx-install__msg" role="alert">
          {msg}
        </p>
      )}
      {result && result.candidates.length > 0 && (
        <>
          {result.reason && <p className="hx-install__msg">추천: {result.reason}</p>}
          <ul className="hx-install__list" aria-label="설치 방법">
            {result.candidates.map((c, i) => {
              const best = rec && rec.kind === c.kind && rec.target.id === c.target.id;
              return (
                <li key={`${c.kind}:${c.target.id}:${i}`} className="hx-install__row" data-kind={c.kind}>
                  <span className="hx-install__name">
                    {best && <span aria-label="추천">⭐ </span>}
                    {c.label}
                  </span>
                  <span className="hx-install__kind">{KIND_LABEL[c.kind]}</span>
                  {c.trust && <span className="hx-install__trust">{c.trust.level}</span>}
                  <span className="hx-install__actions">
                    <button
                      {...act('install.pick-method')}
                      type="button"
                      className="hx-install__btn"
                      onClick={() => void pick(c)}
                    >
                      이 방법으로 계획 보기
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}

// ── G.6 기록 ─────────────────────────────────────────────────────
function HistoryTab({ api }: { api: InstallApi }) {
  const [records, setRecords] = useState<InstallLogRecordView[]>();
  const [msg, setMsg] = useState<string>();
  useEffect(() => {
    let alive = true;
    api
      .history()
      .then((r) => alive && setRecords(r.records))
      .catch((err: unknown) => alive && setMsg(errorText(err)));
    return () => {
      alive = false;
    };
  }, [api]);
  if (!records) return <p className="hx-install__empty">{msg ?? '불러오는 중…'}</p>;
  if (records.length === 0) return <p className="hx-install__empty">아직 기록이 없어요.</p>;
  return (
    <ol className="hx-install__list" aria-label="설치 기록">
      {[...records].reverse().map((r, i) => {
        const l = historyLine(r);
        return (
          <li key={`${r.ts}-${i}`} className={`hx-install__row hx-install__row--${l.ok ? 'ok' : 'fail'}`}>
            <time className="hx-install__when" dateTime={r.ts}>
              {l.when}
            </time>
            <span>{l.text}</span>
          </li>
        );
      })}
    </ol>
  );
}
