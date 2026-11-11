import type { AgentSummary } from '@harness-x/protocol';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { formatSize, imagesFromClipboard, toAttachments } from './attachments.js';
import { ChipMenu } from './ChipMenu.js';
import { PlusMenu, type PlusMenuProps } from './PlusMenu.js';
import { useSlashPalette, type PaletteSkill } from './SlashPalette.js';
import {
  PERMISSION_DESC,
  PERMISSION_LABEL,
  RUNG_LABEL,
  type AttachEvent,
  type Attachment,
  type ComposerSettings,
  type EngineOption,
  type PermissionMode,
  type SendPayload,
  type Verdict,
} from './types.js';
import './composer.css';

export interface ComposerProps {
  engines: EngineOption[];
  initialSettings?: Partial<ComposerSettings>;
  /** 칩으로 바꾼 세션 설정 (다음 턴부터 적용) */
  onSettingsChange?: (s: ComposerSettings) => void;
  onSend: (p: SendPayload) => void;
  /** 첨부 이벤트 (드래그앤드롭·붙여넣기) */
  onAttach?: (e: AttachEvent) => void;
  /** + 버튼 클릭 알림 */
  onPlus?: () => void;
  /** + 메뉴(T-034): 주어지면 + 클릭 시 "프로젝트 폴더 열기… / 최근 프로젝트 / 파일 첨부" 팝오버 */
  plusMenu?: Omit<PlusMenuProps, 'onClose' | 'onAttachFiles'>;
  verdict?: Verdict;
  disabled?: boolean;
  placeholder?: string;
  /** / 팔레트 목록 (GET /api/agents) */
  agents?: readonly AgentSummary[];
  /** / 팔레트 스킬 묶음 */
  skills?: readonly PaletteSkill[];
  /** 간단 모드 (빌더 대화 탭): 엔진·인증·권한 칩과 판정 줄을 숨긴다 */
  compact?: boolean;
  /** 입력창 접근성 이름 (기본 '지시 입력') */
  inputLabel?: string;
  /**
   * 바깥에서 입력창 채우기 (예: 음성 → 글). seq가 바뀔 때마다 지금 글 뒤에 이어 붙인다.
   * 채우기만 하고 전송하지 않는다 — 전송은 사용자가 한다.
   */
  fill?: { text: string; seq: number };
  /** 도구줄 오른쪽(전송 버튼 앞)에 붙일 것 (예: 🎤 버튼) */
  toolbarExtra?: ReactNode;
  /** T-101 5C.1 아래 줄 오른쪽(전송 버튼 왼쪽) `[엔진 · 모델 ▾]` — 예전 왼쪽 엔진 칩·인증 칩을 대신한다 */
  modelPicker?: ReactNode;
  /** 지금 고른 AI (메인 AI 등) — 보내는 지시의 엔진 */
  ai?: { engine: string; model?: string } | undefined;
}

const isEnter = (e: KeyboardEvent) => e.key === 'Enter';

function pickEngine(engines: EngineOption[], wanted?: string): string {
  if (wanted && engines.some((e) => e.id === wanted && e.available)) return wanted;
  return engines.find((e) => e.available)?.id ?? wanted ?? '';
}

/**
 * 지시 입력창.
 * 아래 도구줄 순서 고정: + → 권한 칩 → … (오른쪽) [엔진 · 모델 ▾] → 전송 (T-101 5C.1).
 * 그 아래 오른쪽에 판정 줄.
 */
export function Composer({
  engines,
  initialSettings,
  onSettingsChange,
  onSend,
  onAttach,
  onPlus,
  plusMenu,
  verdict,
  disabled,
  placeholder = '지시를 입력하세요 (Enter 전송 · Shift+Enter 줄바꿈)',
  agents,
  skills,
  compact,
  inputLabel = '지시 입력',
  fill,
  toolbarExtra,
  modelPicker,
  ai,
}: ComposerProps) {
  const [text, setText] = useState('');
  // 바깥 채우기: 같은 seq는 한 번만 반영
  const filled = useRef(0);
  useEffect(() => {
    if (!fill || fill.seq === filled.current) return;
    filled.current = fill.seq;
    setText((cur) => (cur.trim() ? `${cur.replace(/\s+$/, '')} ${fill.text}` : fill.text));
  }, [fill]);
  const slash = useSlashPalette({ agents, skills, text, setText });
  const [settings, setSettings] = useState<ComposerSettings>(() => ({
    engineId: pickEngine(engines, initialSettings?.engineId),
    auth: initialSettings?.auth ?? 'subscription',
    permission: initialSettings?.permission ?? 'workspace-write',
  }));
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const composing = useRef(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const closePlus = useCallback(() => setPlusOpen(false), []);

  // 엔진 목록이 늦게 도착하면(API) 사용 가능한 첫 엔진으로
  useEffect(() => {
    setSettings((s) => {
      const engineId = ai?.engine ?? pickEngine(engines, s.engineId);
      return engineId === s.engineId ? s : { ...s, engineId };
    });
  }, [engines, ai?.engine]);

  const update = (patch: Partial<ComposerSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    onSettingsChange?.(next);
  };

  const addFiles = (files: File[], source: Attachment['source']) => {
    if (files.length === 0) return;
    const list = toAttachments(files, source);
    setAttachments((a) => [...a, ...list]);
    onAttach?.({ type: 'attach', attachments: list });
  };

  const canSend = !disabled && (text.trim().length > 0 || attachments.length > 0);
  const send = () => {
    if (!canSend) return;
    onSend({
      text: text.trim(),
      settings,
      attachments,
      ...(slash.agent ? { agent: slash.agent.command } : {}),
    });
    setText('');
    setAttachments([]);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!e.nativeEvent.isComposing && slash.onKeyDown(e)) return;
    if (!isEnter(e)) return;
    // 한글 IME 조합 중 Enter는 글자 확정용 → 무시
    if (e.nativeEvent.isComposing || composing.current || e.keyCode === 229) return;
    if (e.shiftKey) return; // 줄바꿈
    e.preventDefault();
    send();
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(Array.from(e.dataTransfer?.files ?? []), 'drop');
  };

  return (
    <div
      className="hx-composer"
      data-drag-over={dragOver || undefined}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {attachments.length > 0 && (
        <ul className="hx-attachments" aria-label="첨부 파일">
          {attachments.map((a) => (
            <li key={a.id} className="hx-attachment">
              <span aria-hidden="true">{a.mime.startsWith('image/') ? '🖼' : '📄'}</span>
              <span className="hx-attachment__name">{a.name}</span>
              <span className="hx-attachment__size">{formatSize(a.size)}</span>
              <button
                type="button"
                className="hx-attachment__remove"
                aria-label={`${a.name} 첨부 빼기`}
                onClick={() => setAttachments((xs) => xs.filter((x) => x.id !== a.id))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {slash.popover}
      {slash.chip}
      <textarea
        {...slash.inputProps}
        className="hx-composer__input"
        aria-label={inputLabel}
        rows={2}
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onCompositionStart={() => (composing.current = true)}
        onCompositionEnd={() => (composing.current = false)}
        onPaste={(e) => {
          const imgs = imagesFromClipboard(e.clipboardData);
          if (imgs.length) {
            e.preventDefault();
            addFiles(imgs, 'paste');
          }
        }}
      />
      {plusMenu && plusOpen && (
        <PlusMenu {...plusMenu} onClose={closePlus} onAttachFiles={() => fileInput.current?.click()} />
      )}
      {plusMenu && (
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          data-testid="attach-input"
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []), 'picker');
            e.target.value = '';
          }}
        />
      )}
      <div className="hx-composer__bar" role="toolbar" aria-label="입력 도구">
        <button
          type="button"
          className="hx-plus"
          aria-label="추가"
          data-slot="plus"
          {...(plusMenu ? { 'aria-haspopup': 'menu' as const, 'aria-expanded': plusOpen } : {})}
          onClick={() => {
            if (plusMenu) setPlusOpen((v) => !v);
            onPlus?.();
          }}
        >
          +
        </button>
        {!compact && (
          <>
            <ChipMenu
              name="권한"
              className="hx-chip--permission"
              icon="◎"
              value={settings.permission}
              valueLabel={PERMISSION_LABEL[settings.permission]}
              options={(Object.keys(PERMISSION_LABEL) as PermissionMode[]).map((v) => ({
                value: v,
                label: PERMISSION_LABEL[v],
                description: PERMISSION_DESC[v],
              }))}
              onChange={(permission) => update({ permission })}
            />
          </>
        )}
        <span className="hx-composer__spacer" />
        {!compact && modelPicker}
        {toolbarExtra}
        <button type="button" className="hx-send" aria-label="전송" disabled={!canSend} onClick={send}>
          ↑
        </button>
      </div>
      {!compact && (
        <div className="hx-verdict" aria-live="polite" data-testid="verdict">
          {verdict ? (
            <span data-passed={verdict.passed}>
              판정 · 항목 <span className="hx-mono">{verdict.itemId}</span> {verdict.passed ? '통과' : '실패'}{' '}
              · 사다리 {verdict.rung}번째 칸({RUNG_LABEL[verdict.rung]})
            </span>
          ) : (
            <span className="hx-verdict__empty">판정 대기</span>
          )}
        </div>
      )}
    </div>
  );
}
