import type { AgentDraft, DraftChange, DraftGap, DraftQuestion } from '@harness-x/protocol';
import { useState } from 'react';
import { draftEngines, draftPermissions, type CheckRow } from './model.js';
import type { DraftListItem, DraftVersionInfo, EngineSuggestion } from './api.js';
import './draft.css';

/** 대화로 만들기 화면 조각들 — 사용자에게 보이는 글은 모두 쉬운 말(H.6) */

export const SKIP_QUESTIONS = '알아서 해 줘';

// ── P4-D.1 초안 띠 (+ P4-E.6 버전 목록) ───────────────────────
export function DraftBanner({
  version,
  versions,
  onRevert,
}: {
  version: number;
  versions: DraftVersionInfo[];
  onRevert?: (v: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [peek, setPeek] = useState<number>();
  const shown = versions.find((x) => x.v === peek);
  return (
    <div className="hx-draft-banner" role="status" aria-label="초안 상태">
      <span className="hx-draft-banner__text">초안 v{version} · 아직 저장 안 됨</span>
      {versions.length > 0 && (
        <button type="button" className="hx-insp-btn hx-insp-btn--ghost" onClick={() => setOpen((o) => !o)}>
          버전 기록 ({versions.length})
        </button>
      )}
      {open && (
        <ol className="hx-draft-versions" aria-label="버전 목록">
          {versions.map((x) => (
            <li key={x.v} data-current={x.v === version || undefined}>
              <span>
                v{x.v} · {SOURCE_LABEL[x.source]}
                {x.note ? ` · ${x.note}` : ''}
              </span>
              <button type="button" className="hx-insp-btn hx-insp-btn--ghost" onClick={() => setPeek(x.v)}>
                v{x.v} 보기
              </button>
              {x.v !== version && onRevert && (
                <button type="button" className="hx-insp-btn" onClick={() => onRevert(x.v)}>
                  v{x.v}로 되돌리기
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
      {shown && (
        <div className="hx-draft-peek" aria-label={`v${shown.v} 내용`}>
          <strong>v{shown.v}</strong> {shown.draft.nodes.map((n) => n.role).join(' → ')}
          <button type="button" className="hx-insp-btn hx-insp-btn--ghost" onClick={() => setPeek(undefined)}>
            닫기
          </button>
        </div>
      )}
    </div>
  );
}

const SOURCE_LABEL: Record<DraftVersionInfo['source'], string> = {
  ai: 'AI가 만든 초안',
  'ai-patch': '말로 고침',
  canvas: '캔버스에서 고침',
  yaml: '설정 글에서 고침',
  revert: '되돌림',
};

// ── P4-D.3 요약 카드 ─────────────────────────────────────────
export function SummaryCard({
  draft,
  suggestions = [],
}: {
  draft: AgentDraft;
  suggestions?: EngineSuggestion[];
}) {
  return (
    <section className="hx-draft-card" aria-label="초안 요약">
      <h3 className="hx-draft-card__title">이 에이전트는 이런 일을 해요</h3>
      <ul className="hx-draft-card__summary">
        {draft.summary
          .split('\n')
          .filter((l) => l.trim())
          .map((l) => (
            <li key={l}>{l}</li>
          ))}
      </ul>
      <h4 className="hx-draft-card__sub">일을 맡을 AI 목록</h4>
      <p className="hx-draft-card__engines">
        {draftEngines(draft).map((e) => (
          <span key={e} className="hx-engine-chip" data-engine={e}>
            {e}
          </span>
        ))}
      </p>
      <h4 className="hx-draft-card__sub">필요한 권한</h4>
      <ul className="hx-draft-card__perms">
        {draftPermissions(draft).map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      {suggestions.length > 0 && (
        <ul className="hx-draft-card__warn" aria-label="AI 바꾸기 제안">
          {suggestions.map((s) => (
            <li key={s.nodeId}>{s.message}</li>
          ))}
        </ul>
      )}
      <p className="hx-draft-card__cost">{draft.estimatedCostHint}</p>
    </section>
  );
}

// ── P4-C.3 질문 카드 ─────────────────────────────────────────
export function QuestionCard({
  questions,
  onAnswer,
  onSkip,
}: {
  questions: DraftQuestion[];
  onAnswer: (answers: { question: string; answer: string }[]) => void;
  onSkip: () => void;
}) {
  const [picked, setPicked] = useState<Record<string, string>>({});
  const done = questions.every((q) => picked[q.id]);
  return (
    <section className="hx-draft-card" aria-label="AI의 질문">
      {questions.map((q) => (
        <fieldset key={q.id} className="hx-draft-q">
          <legend>{q.text}</legend>
          {q.choices.map((c) => (
            <button
              key={c}
              type="button"
              className="hx-insp-btn hx-insp-btn--ghost"
              aria-pressed={picked[q.id] === c}
              onClick={() => setPicked((p) => ({ ...p, [q.id]: c }))}
            >
              {c}
            </button>
          ))}
        </fieldset>
      ))}
      <div className="hx-draft-card__actions">
        <button
          type="button"
          className="hx-insp-btn"
          disabled={!done}
          onClick={() => onAnswer(questions.map((q) => ({ question: q.text, answer: picked[q.id]! })))}
        >
          이대로 만들기
        </button>
        <button type="button" className="hx-insp-btn hx-insp-btn--ghost" onClick={onSkip}>
          {SKIP_QUESTIONS}
        </button>
      </div>
    </section>
  );
}

// ── P4-C.10 빈 칸 (캔버스 빨간 점선 노드) ─────────────────────
export interface GapActions {
  /** [도구 찾기] — Part 3 도구 고르기 카드가 연결한다 */
  onFindTool?: (gap: DraftGap) => void;
  /** [Forge로 만들기] */
  onForge?: (gap: DraftGap) => void;
  /** [이 칸 빼기] */
  onRemove?: (gap: DraftGap) => void;
}

export function GapLayer({ gaps, ...a }: { gaps: DraftGap[] } & GapActions) {
  if (gaps.length === 0) return null;
  return (
    <ul className="hx-gap-layer" aria-label="빈 칸">
      {gaps.map((g) => (
        <li key={g.id} className="hx-gap-node" data-gap-id={g.id} data-node-id={g.nodeId}>
          <span className="hx-gap-node__title">빈 칸: {g.need}</span>
          <span className="hx-gap-node__actions">
            <button type="button" className="hx-insp-btn" onClick={() => a.onFindTool?.(g)}>
              도구 찾기
            </button>
            <button type="button" className="hx-insp-btn hx-insp-btn--ghost" onClick={() => a.onForge?.(g)}>
              Forge로 만들기
            </button>
            <button type="button" className="hx-insp-btn hx-insp-btn--ghost" onClick={() => a.onRemove?.(g)}>
              이 칸 빼기
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}

// ── P4-D.6 저장 전 점검표 ─────────────────────────────────────
export function Checklist({ rows }: { rows: CheckRow[] }) {
  return (
    <section className="hx-draft-check" aria-label="저장 전 점검표">
      <h3 className="hx-draft-card__title">저장 전 점검</h3>
      <ul>
        {rows.map((r) => (
          <li key={r.id} data-ok={r.ok}>
            <span aria-hidden="true">{r.ok ? '✓' : '!'}</span> {r.text}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── P4-E.4 / E.5 바뀐 점 미리보기 ─────────────────────────────
export const CONFLICT_TEXT = '직접 고치신 부분을 바꾸려고 해요. 바꿀까요?';

export function PatchPreview({
  changes,
  conflicts,
  onApply,
  onCancel,
}: {
  changes: DraftChange[];
  conflicts: DraftChange[];
  onApply: () => void;
  onCancel: () => void;
}) {
  return (
    <section className="hx-draft-card hx-draft-card--preview" aria-label="바뀐 점">
      <h3 className="hx-draft-card__title">바뀐 점</h3>
      <ul>
        {changes.map((c, i) => (
          <li key={i} data-conflict={conflicts.includes(c) || undefined}>
            {c.message}
          </li>
        ))}
      </ul>
      {conflicts.length > 0 && (
        <p className="hx-draft-card__warn" role="alert">
          {CONFLICT_TEXT}
        </p>
      )}
      <div className="hx-draft-card__actions">
        <button type="button" className="hx-insp-btn" onClick={onApply}>
          {conflicts.length > 0 ? '네, 바꿀게요' : '적용'}
        </button>
        <button type="button" className="hx-insp-btn hx-insp-btn--ghost" onClick={onCancel}>
          취소
        </button>
      </div>
    </section>
  );
}

// ── P4-F.9 이어서 하기 ────────────────────────────────────────
export const RESUME_TEXT = '만들던 초안이 있어요. 이어서 할까요?';

export function ResumePrompt({
  item,
  onResume,
  onDismiss,
}: {
  item: DraftListItem;
  onResume: () => void;
  onDismiss: () => void;
}) {
  return (
    <section className="hx-draft-card" aria-label="이어서 하기">
      <p>{RESUME_TEXT}</p>
      <p className="hx-draft-card__sub">
        "{item.displayName}" · 버전 {item.versions}개
      </p>
      <div className="hx-draft-card__actions">
        <button type="button" className="hx-insp-btn" onClick={onResume}>
          이어서 하기
        </button>
        <button type="button" className="hx-insp-btn hx-insp-btn--ghost" onClick={onDismiss}>
          새로 만들기
        </button>
      </div>
    </section>
  );
}

// ── P4-F.10 초안 목록 ────────────────────────────────────────
export const STALE_TEXT = '30일이 지난 초안이 있어요. 필요 없으면 지워 주세요.';

export function DraftList({
  items,
  onResume,
  onDelete,
}: {
  items: DraftListItem[];
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const stale = items.filter((i) => i.stale);
  return (
    <section className="hx-draft-list" aria-label="만들던 초안">
      <h3 className="hx-draft-card__title">만들던 초안</h3>
      {items.length === 0 && <p>만들던 초안이 없어요.</p>}
      {stale.length > 0 && (
        <p className="hx-draft-card__warn" role="note">
          {STALE_TEXT}
        </p>
      )}
      <ul>
        {items.map((i) => (
          <li key={i.id} data-stale={i.stale || undefined}>
            <span>
              {i.displayName} · 버전 {i.versions}개{i.gaps ? ` · 빈 칸 ${i.gaps}개` : ''}
              {i.stale ? ' · 오래됨' : ''}
            </span>
            <button type="button" className="hx-insp-btn" onClick={() => onResume(i.id)}>
              이어서 하기
            </button>
            <button type="button" className="hx-insp-btn hx-insp-btn--ghost" onClick={() => onDelete(i.id)}>
              삭제
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
