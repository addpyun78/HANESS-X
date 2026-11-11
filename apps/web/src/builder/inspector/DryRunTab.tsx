import { PipelineSchema } from '@harness-x/protocol';
import { useEffect, useRef, useState } from 'react';
import type { BuilderGraph } from '../graph.js';
import {
  dryRunEvents,
  formatUsd,
  overlayFromEvents,
  totalCost,
  type Overlay,
  type RunEvent,
} from './dryrun.js';
import { stageRunView } from './dryrun-stages.js';
import { graphToPipeline, type PipelineMeta } from './yaml.js';

export interface DryRunTabProps {
  graph: BuilderGraph;
  meta: PipelineMeta;
  defaultEngine?: string;
  overlay: Overlay | undefined;
  onOverlay: (o: Overlay | undefined) => void;
  /** 리플레이 한 단계 간격 (기본 250ms, 0이면 한 번에) */
  stepMs?: number;
}

const STATUS_LABEL: Record<string, string> = {
  pending: '대기',
  running: '실행 중',
  completed: '완료',
  incomplete: '미완료',
  failed: '실패',
  error: '오류',
};

/** 46.4 "시험 실행": 샘플 입력으로 드라이런(엔진 호출 없음) → 노드별 진행·비용을 캔버스에 오버레이 */
export function DryRunTab({ graph, meta, defaultEngine, overlay, onOverlay, stepMs = 250 }: DryRunTabProps) {
  const [sample, setSample] = useState('로그인 화면 디자인을 점검해 줘');
  const [errors, setErrors] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const replay = (events: RunEvent[], ids: string[]) => {
    clearTimeout(timer.current);
    if (stepMs <= 0) {
      onOverlay(overlayFromEvents(events, ids));
      return;
    }
    setRunning(true);
    let k = 0;
    const step = () => {
      k++;
      onOverlay(overlayFromEvents(events.slice(0, k), ids));
      if (k < events.length) timer.current = setTimeout(step, stepMs);
      else setRunning(false);
    };
    onOverlay(overlayFromEvents([], ids));
    timer.current = setTimeout(step, stepMs);
  };

  const run = () => {
    const pipeline = graphToPipeline(graph, meta);
    const checked = PipelineSchema.safeParse(pipeline);
    if (!checked.success) {
      setErrors(checked.error.issues.map((i) => i.message));
      onOverlay(undefined);
      return;
    }
    setErrors([]);
    replay(
      dryRunEvents(pipeline, sample, defaultEngine),
      graph.nodes.map((n) => n.id),
    );
  };

  const stages = overlay ? stageRunView(graphToPipeline(graph, meta), overlay) : undefined;
  const rows = overlay ? Object.entries(overlay).sort((a, b) => (a[1].order ?? 99) - (b[1].order ?? 99)) : [];

  return (
    <div className="hx-dryrun">
      <label className="hx-field">
        <span>샘플 입력</span>
        <textarea
          aria-label="샘플 입력"
          rows={3}
          value={sample}
          onChange={(e) => setSample(e.target.value)}
        />
      </label>
      <div className="hx-yaml__bar">
        <button type="button" className="hx-insp-btn" disabled={running} onClick={run}>
          시험 실행
        </button>
        {overlay && (
          <button
            type="button"
            className="hx-insp-btn hx-insp-btn--ghost"
            onClick={() => {
              clearTimeout(timer.current);
              setRunning(false);
              onOverlay(undefined);
            }}
          >
            오버레이 지우기
          </button>
        )}
      </div>
      <p className="hx-dryrun__note">드라이런: 엔진을 부르지 않고 추정 비용만 계산합니다</p>
      {errors.length > 0 && (
        <ul className="hx-yaml__errors" role="alert">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {stages && (
        <div className="hx-dryrun__stages">
          <p className="hx-dryrun__stage-progress" data-testid="dryrun-stage-progress">
            {stages.label}
          </p>
          <ol className="hx-dryrun__list" aria-label="단계별 진행">
            {stages.rows.map((r, k) => (
              <li key={r.nodeId} data-stage={r.nodeId} data-status={r.status}>
                <span>
                  {k + 1}. {r.title}
                </span>
                <span>{STATUS_LABEL[r.status]}</span>
                <span />
              </li>
            ))}
          </ol>
        </div>
      )}
      {overlay && (
        <>
          <ul className="hx-dryrun__list" aria-label="노드별 진행">
            {rows.map(([id, o]) => (
              <li key={id} data-node-id={id} data-status={o.status}>
                <span className="hx-mono">{id}</span>
                <span>{STATUS_LABEL[o.status]}</span>
                <span className="hx-mono">{formatUsd(o.costUsd)}</span>
              </li>
            ))}
          </ul>
          <p className="hx-dryrun__total" data-testid="dryrun-total">
            추정 비용 합계 {formatUsd(totalCost(overlay))}
          </p>
        </>
      )}
    </div>
  );
}
