import { useState, type ReactNode } from 'react';

export function ItemTag({ itemId }: { itemId?: string }) {
  if (!itemId) return null;
  return (
    <span className="hx-item-tag hx-mono" title={`체크리스트 항목 ${itemId}`} aria-label={`항목 ${itemId}`}>
      #{itemId}
    </span>
  );
}

export interface CollapsibleCardProps {
  className?: string;
  icon: string;
  title: ReactNode;
  summary?: ReactNode;
  status?: 'ok' | 'fail' | 'pending';
  itemId?: string;
  defaultOpen?: boolean;
  children?: ReactNode;
}

const STATUS_LABEL = { ok: '성공', fail: '실패', pending: '실행 중' } as const;
const STATUS_ICON = { ok: '✓', fail: '✗', pending: '…' } as const;

/** 접기/펼치기 카드 — 헤더 오른쪽에 체크리스트 항목 id 태그 */
export function CollapsibleCard({
  className = '',
  icon,
  title,
  summary,
  status,
  itemId,
  defaultOpen = false,
  children,
}: CollapsibleCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const hasBody = children !== undefined && children !== null && children !== false;
  return (
    <div className={`hx-card ${className}`} data-open={open} data-status={status}>
      <div className="hx-card__head">
        <button
          type="button"
          className="hx-card__toggle"
          aria-expanded={hasBody ? open : undefined}
          disabled={!hasBody}
          onClick={() => setOpen(!open)}
        >
          <span className="hx-card__chev" aria-hidden="true">
            {hasBody ? (open ? '▾' : '▸') : '·'}
          </span>
          <span aria-hidden="true">{icon}</span>
          <span className="hx-card__title">{title}</span>
          {summary !== undefined && <span className="hx-card__summary hx-mono">{summary}</span>}
        </button>
        {status && (
          <span className={`hx-card__status hx-card__status--${status}`} aria-label={STATUS_LABEL[status]}>
            {STATUS_ICON[status]}
          </span>
        )}
        <ItemTag itemId={itemId} />
      </div>
      {open && hasBody && <div className="hx-card__body">{children}</div>}
    </div>
  );
}

export function formatValue(v: unknown): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v, null, 2) ?? String(v);
  } catch {
    return String(v);
  }
}

/** 입력에서 한 줄 요약 (command·path·file_path·pattern 순) */
export function toolSummary(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return typeof input === 'string' ? input : undefined;
  const o = input as Record<string, unknown>;
  for (const k of ['command', 'file_path', 'path', 'pattern', 'url', 'query']) {
    if (typeof o[k] === 'string') return truncate(o[k] as string, 80);
  }
  return undefined;
}

export const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export interface ToolCardProps {
  tool: string;
  input: unknown;
  result?: { ok: boolean; output: unknown };
  itemId?: string;
  defaultOpen?: boolean;
}

export function ToolCard({ tool, input, result, itemId, defaultOpen }: ToolCardProps) {
  return (
    <CollapsibleCard
      className="hx-card--tool"
      icon="⚒"
      title={tool}
      summary={toolSummary(input)}
      status={result ? (result.ok ? 'ok' : 'fail') : 'pending'}
      itemId={itemId}
      defaultOpen={defaultOpen}
    >
      <div className="hx-card__section">
        <div className="hx-card__label">입력</div>
        <pre className="hx-pre">{formatValue(input)}</pre>
      </div>
      {result && (
        <div className="hx-card__section">
          <div className="hx-card__label">{result.ok ? '결과' : '실패 결과'}</div>
          <pre className="hx-pre">{formatValue(result.output)}</pre>
        </div>
      )}
    </CollapsibleCard>
  );
}
