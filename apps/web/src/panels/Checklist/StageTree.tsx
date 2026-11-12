import {
  STAGE_STATUS_LABEL,
  circled,
  currentTopStage,
  isActiveStage,
  stageItemIcon,
  stageName,
  stageProgressLabel,
  type StageTreeView,
  type StageView,
} from './stages.js';

/**
 * T-101 4F.4 단계 트리: 현재 단계는 펼침, 끝난 단계는 접힘 + 요약, 예상 단계는 흐리게.
 * 진행률 = "단계 2/3 · 이번 단계 항목 4/7"
 */
export function StageTree({ tree }: { tree: StageTreeView }) {
  const { label } = stageProgressLabel(tree);
  const cur = currentTopStage(tree);
  return (
    <div className="hx-ck-stages">
      <p className="hx-ck-progress hx-ck-stages__progress" data-testid="stage-progress">
        {label}
      </p>
      <ol className="hx-ck-stages__list" aria-label="단계">
        {tree.stages.map((s, k) => (
          <Stage key={s.stageId} stage={s} num={circled(k + 1)} open={s === cur || isActiveStage(s)} />
        ))}
      </ol>
    </div>
  );
}

function Stage({ stage: s, num, open }: { stage: StageView; num: string; open: boolean }) {
  const cls = `hx-ck-stage hx-ck-stage--${s.status}`;
  const head = (
    <>
      <span className="hx-ck-stage__num">{num}</span>
      <span className="hx-ck-stage__title">{stageName(s)}</span>
      <span className="hx-ck-stage__status">{STAGE_STATUS_LABEL[s.status]}</span>
    </>
  );
  const body = (
    <>
      {open && s.summary && <p className="hx-ck-stage__summary">{s.summary}</p>}
      {s.reason && (s.status === 'skipped' || s.status === 'blocked') && (
        <p className="hx-ck-stage__reason">{s.reason}</p>
      )}
      {s.items.length > 0 && (
        <ul className="hx-ck-stage__items">
          {s.items.map((it) => {
            const m = s.itemMeta[it.id];
            return (
              <li key={it.id} data-item-id={it.id} data-status={it.status}>
                <span className="hx-ck-stage__icon" aria-hidden="true">
                  {stageItemIcon(it, s)}
                </span>
                <span>{it.title}</span>
                {m?.origin === 'rework' && <span className="hx-ck-stage__badge">다시 하기 {m.rework}</span>}
              </li>
            );
          })}
        </ul>
      )}
      {s.children.length > 0 && (
        <ol className="hx-ck-stages__list hx-ck-stages__list--inner">
          {s.children.map((c, k) => (
            <Stage key={c.stageId} stage={c} num={`${k + 1}.`} open={isActiveStage(c)} />
          ))}
        </ol>
      )}
    </>
  );
  return (
    <li className={cls} data-stage-id={s.stageId} data-status={s.status}>
      <details open={open}>
        <summary className="hx-ck-stage__head">{head}</summary>
        {body}
      </details>
      {!open && s.status === 'done' && s.summary && (
        <p className="hx-ck-stage__summary hx-ck-stage__summary--folded">{s.summary}</p>
      )}
    </li>
  );
}
