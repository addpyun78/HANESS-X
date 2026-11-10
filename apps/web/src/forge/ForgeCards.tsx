import { createContext, useContext, useState } from 'react';
import './forge.css';

/**
 * Forge 카드 (approval_request kind = forge_question / forge_spec / forge_install)
 * - 질문 카드(51.2): 선택지 버튼, 제안 답 강조, 여러 개 고르기(확인 버튼), 직접 입력
 * - spec 확인 카드(51.3): spec 요약 + 확인/취소
 * - 설치 카드(52.4): 파일 diff, 권한 요약, 네트워크·셸 권한이면 빨간 경고, 신뢰 등급
 * 버튼은 ForgeAnswerContext.onAnswer → POST /api/forge/answers/:id (서버가 forge_answer 이벤트를 남긴다)
 */

export interface ForgeAnswerPayload {
  value: string | string[];
  text?: string;
}

export interface ForgeActions {
  onAnswer(approvalId: string, answer: ForgeAnswerPayload): void;
}

export const ForgeAnswerContext = createContext<ForgeActions | undefined>(undefined);

export const FORGE_CARD_KINDS = ['forge_question', 'forge_spec', 'forge_install'] as const;
export function isForgeCard(kind: string): boolean {
  return (FORGE_CARD_KINDS as readonly string[]).includes(kind);
}

export interface ForgeCardBlock {
  approvalId: string;
  approvalKind: string;
  title: string;
  detail?: Record<string, unknown>;
  options: string[];
}

interface Choice {
  value: string;
  label: string;
}

const asChoices = (v: unknown, options: string[]): Choice[] =>
  Array.isArray(v)
    ? v.filter(
        (c): c is Choice => typeof c === 'object' && c !== null && typeof (c as Choice).value === 'string',
      )
    : options.map((o) => ({ value: o, label: o }));

const asList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? [v] : [];

export function ForgeCard({ block }: { block: ForgeCardBlock }) {
  if (block.approvalKind === 'forge_spec') return <ForgeSpecCard block={block} />;
  if (block.approvalKind === 'forge_install') return <ForgeInstallCard block={block} />;
  return <ForgeQuestionCard block={block} />;
}

export function ForgeQuestionCard({ block: b }: { block: ForgeCardBlock }) {
  const actions = useContext(ForgeAnswerContext);
  const d = b.detail ?? {};
  const choices = asChoices(d.choices, b.options);
  const suggested = new Set(asList(d.suggested));
  const multiple = d.multiple === true;
  const [picked, setPicked] = useState<string[]>(multiple ? [...suggested] : []);
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);
  const send = (answer: ForgeAnswerPayload) => {
    setSent(true);
    actions?.onAnswer(b.approvalId, answer);
  };
  return (
    <div className="hx-forge hx-forge--question" role="group" aria-label={`Forge 질문: ${b.title}`}>
      <div className="hx-forge__head">
        <strong>Forge</strong>
        {typeof d.index === 'number' && typeof d.total === 'number' && (
          <span className="hx-mono">
            {d.index}/{d.total}
          </span>
        )}
      </div>
      <p className="hx-forge__title">{b.title}</p>
      <div className="hx-forge__choices">
        {choices.map((c) => {
          const on = multiple ? picked.includes(c.value) : false;
          return (
            <button
              key={c.value}
              type="button"
              className="hx-forge__choice"
              data-option={c.value}
              data-suggested={suggested.has(c.value) || undefined}
              aria-pressed={multiple ? on : undefined}
              disabled={sent}
              onClick={() =>
                multiple
                  ? setPicked((p) => (p.includes(c.value) ? p.filter((x) => x !== c.value) : [...p, c.value]))
                  : send({ value: c.value })
              }
            >
              {c.label}
            </button>
          );
        })}
      </div>
      {(multiple || d.allowText === true) && (
        <div className="hx-forge__row">
          {d.allowText === true && (
            <input
              className="hx-forge__text"
              aria-label="직접 입력"
              value={text}
              disabled={sent}
              onChange={(e) => setText(e.target.value)}
            />
          )}
          {(multiple || text.trim()) && (
            <button
              type="button"
              className="hx-forge__submit"
              disabled={sent || (multiple && picked.length === 0)}
              onClick={() =>
                send({
                  value: multiple ? picked : 'text',
                  ...(text.trim() ? { text: text.trim() } : {}),
                })
              }
            >
              확인
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function ForgeSpecCard({ block: b }: { block: ForgeCardBlock }) {
  const actions = useContext(ForgeAnswerContext);
  const spec = (b.detail?.spec ?? {}) as Record<string, unknown>;
  const perms = (spec.permissions ?? {}) as { fs?: string[]; net?: string[]; shell?: boolean };
  const trigger = (spec.trigger ?? {}) as { hook?: string; match?: string };
  const examples = Array.isArray(spec.examples) ? (spec.examples as { name?: string }[]) : [];
  return (
    <div className="hx-forge hx-forge--spec" role="group" aria-label={`Forge spec 확인: ${b.title}`}>
      <div className="hx-forge__head">
        <strong>forge-spec.json</strong> <span className="hx-mono">{String(spec.id ?? '')}</span>
      </div>
      <p className="hx-forge__title">{b.title}</p>
      <dl className="hx-forge__spec">
        <dt>종류</dt>
        <dd>{String(spec.kind ?? '')}</dd>
        {trigger.hook && (
          <>
            <dt>발동</dt>
            <dd>
              {trigger.hook}
              {trigger.match ? ` · ${trigger.match}` : ''}
            </dd>
          </>
        )}
        <dt>권한</dt>
        <dd>{permissionSummary(perms)}</dd>
        <dt>예시</dt>
        <dd>{examples.map((e) => e.name).join(', ')}</dd>
      </dl>
      <div className="hx-forge__choices">
        {b.options.map((o) => (
          <button
            key={o}
            type="button"
            className="hx-forge__choice"
            data-option={o}
            onClick={() => actions?.onAnswer(b.approvalId, { value: o })}
          >
            {o === 'confirm' ? '확인' : o === 'cancel' ? '취소' : o}
          </button>
        ))}
      </div>
    </div>
  );
}

export function permissionSummary(p: { fs?: string[]; net?: string[]; shell?: boolean }): string {
  const parts = [
    ...(p.fs ?? []).map((f) => (f === 'workspace:write' ? '워크스페이스 쓰기' : '워크스페이스 읽기')),
    ...((p.net ?? []).length ? [`네트워크(${(p.net ?? []).join(', ')})`] : []),
    ...(p.shell ? ['셸 실행'] : []),
  ];
  return parts.length ? parts.join(' · ') : '권한 없음';
}

interface InstallFile {
  path: string;
  change: string;
  diff?: string;
}
interface InstallWarning {
  kind: string;
  level: string;
  message: string;
}

export function ForgeInstallCard({ block: b }: { block: ForgeCardBlock }) {
  const actions = useContext(ForgeAnswerContext);
  const d = b.detail ?? {};
  const files = Array.isArray(d.files) ? (d.files as InstallFile[]) : [];
  const warnings = Array.isArray(d.warnings) ? (d.warnings as InstallWarning[]) : [];
  const perms = (d.permissions ?? {}) as { fs?: string[]; net?: string[]; shell?: boolean };
  return (
    <div className="hx-forge hx-forge--install" role="group" aria-label={`Forge 설치: ${b.title}`}>
      <div className="hx-forge__head">
        <strong>설치</strong> <span className="hx-mono">{String(d.target ?? '')}</span>
        {typeof d.trustLabel === 'string' && <span className="hx-forge__trust">{d.trustLabel}</span>}
      </div>
      <p className="hx-forge__title">{b.title}</p>
      {warnings.map((w) => (
        <div
          key={w.kind}
          className={`hx-forge__warn hx-forge__warn--${w.level}`}
          role="alert"
          data-kind={w.kind}
        >
          {w.message}
        </div>
      ))}
      <p className="hx-forge__perms">권한: {permissionSummary(perms)}</p>
      <ul className="hx-forge__files">
        {files.map((f) => (
          <li key={f.path} data-change={f.change}>
            <span className="hx-mono">{f.path}</span> <span>{f.change}</span>
            {f.diff && <pre className="hx-forge__diff">{f.diff}</pre>}
          </li>
        ))}
      </ul>
      <div className="hx-forge__choices">
        {b.options.map((o) => (
          <button
            key={o}
            type="button"
            className="hx-forge__choice"
            data-option={o}
            onClick={() => actions?.onAnswer(b.approvalId, { value: o })}
          >
            {o === 'install' ? '설치' : o === 'cancel' ? '취소' : o}
          </button>
        ))}
      </div>
    </div>
  );
}
