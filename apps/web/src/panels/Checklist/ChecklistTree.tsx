import {
  acceptanceText,
  buildTree,
  fmtProbability,
  LADDER_LEVEL_LABEL,
  ladderSteps,
  progressOf,
  STATUS_ICON,
  STATUS_LABEL,
  type ChecklistItem,
  type TreeNode,
} from './model.js';

/** 36.1 진행률 바 */
export function ChecklistProgress({ items }: { items: readonly ChecklistItem[] }) {
  const p = progressOf(items);
  return (
    <div className="hx-ck-progress">
      <div
        className="hx-ck-progress__track"
        role="progressbar"
        aria-label="체크리스트 진행률"
        aria-valuemin={0}
        aria-valuemax={p.total}
        aria-valuenow={p.done}
      >
        <div className="hx-ck-progress__bar" style={{ width: `${Math.round(p.ratio * 100)}%` }} />
      </div>
      <span className="hx-ck-progress__text" data-testid="checklist-progress">
        {p.done}/{p.total} 완료 · {Math.round(p.ratio * 100)}%
      </span>
    </div>
  );
}

/** 36.3 항목 펼침: acceptance · evidence · 판정 사다리 결과 */
export function ItemDetail({ item }: { item: ChecklistItem }) {
  const steps = ladderSteps(item);
  const others = item.evidence.filter((e) => typeof e.level !== 'number');
  return (
    <div className="hx-ck-detail" data-testid={`checklist-detail-${item.id}`}>
      <section aria-label="검증 조건">
        <h4 className="hx-ck-detail__title">검증 조건</h4>
        <ul className="hx-ck-detail__list">
          {item.acceptance.map((a, k) => (
            <li key={k}>
              <span className="hx-ck-tag">{a.type}</span> <span className="hx-mono">{acceptanceText(a)}</span>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="판정 사다리">
        <h4 className="hx-ck-detail__title">판정 사다리</h4>
        {steps.length === 0 ? (
          <p className="hx-ck-detail__empty">아직 판정 결과가 없습니다</p>
        ) : (
          <ol className="hx-ck-ladder">
            {steps.map((s, k) => (
              <li key={k} className="hx-ck-ladder__step" data-level={s.level}>
                <span className="hx-ck-ladder__level">L{s.level}</span>
                <span className="hx-ck-ladder__name">{LADDER_LEVEL_LABEL[s.level] ?? ''}</span>
                <span className="hx-ck-tag">{s.verdict}</span>
                <span className="hx-ck-ladder__prob" aria-label={`L${s.level} 확률`}>
                  {fmtProbability(s.confidence)}
                </span>
                {s.decision && <span className="hx-ck-tag">{s.decision}</span>}
                <p className="hx-ck-ladder__reason">{s.reason}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section aria-label="증거">
        <h4 className="hx-ck-detail__title">증거</h4>
        {others.length === 0 ? (
          <p className="hx-ck-detail__empty">증거 없음</p>
        ) : (
          <ul className="hx-ck-detail__list">
            {others.map((e, k) => (
              <li key={k}>
                <span className="hx-ck-tag">{e.kind}</span> {e.summary ?? ''}
                {e.ts && <span className="hx-mono hx-ck-detail__ts"> {e.ts.slice(11, 19)}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export interface ChecklistTreeProps {
  items: readonly ChecklistItem[];
  currentItemId: string | null;
  expanded: ReadonlySet<string>;
  onToggle: (id: string) => void;
  /** 린트 위반이 있는 항목 (계획 검토 화면) */
  flagged?: ReadonlySet<string>;
}

/** 36.1 트리 렌더: 상태 아이콘 · 현재 항목 강조 · 펼침 */
export function ChecklistTree({ items, currentItemId, expanded, onToggle, flagged }: ChecklistTreeProps) {
  const renderNode = (n: TreeNode) => {
    const it = n.item;
    const open = expanded.has(it.id);
    const current = it.id === currentItemId;
    return (
      <li
        key={it.id}
        role="treeitem"
        aria-expanded={open}
        aria-current={current ? 'step' : undefined}
        aria-selected={current}
        className="hx-ck-item"
        data-status={it.status}
        data-current={current ? 'true' : undefined}
        data-flagged={flagged?.has(it.id) ? 'true' : undefined}
      >
        <button
          type="button"
          className="hx-ck-row"
          style={{ paddingLeft: `calc(var(--hx-space-3) * ${n.depth + 1})` }}
          onClick={() => onToggle(it.id)}
          aria-label={`${it.id} ${it.title} (${STATUS_LABEL[it.status]})`}
        >
          <span className="hx-ck-icon" data-status={it.status} aria-hidden="true">
            {STATUS_ICON[it.status]}
          </span>
          <span className="hx-mono hx-ck-row__id">{it.id}</span>
          <span className="hx-ck-row__title">{it.title}</span>
          <span className="hx-ck-row__status">{STATUS_LABEL[it.status]}</span>
        </button>
        {open && <ItemDetail item={it} />}
        {n.children.length > 0 && (
          <ul role="group" className="hx-ck-tree__group">
            {n.children.map(renderNode)}
          </ul>
        )}
      </li>
    );
  };
  return (
    <ul role="tree" aria-label="체크리스트 항목" className="hx-ck-tree">
      {buildTree(items).map(renderNode)}
    </ul>
  );
}
