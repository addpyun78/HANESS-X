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
import {
  MODE_CHIP_NAME,
  modeOptions,
  permissionView,
  PLAN_LOCK_REASON,
  planModeChange,
  RUN_MODE_LABEL,
  type ModeChange,
} from './run-mode.js';
import { PlusMenu, type PlusMenuProps } from './PlusMenu.js';
import { useSlashPalette, type PaletteSkill } from './SlashPalette.js';
import { StopButton, type StopControls } from './StopButton.js';
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
import { act, NOT_READY } from '../actions/registry.js';

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
  /** T-101 0B.18 바깥에서 / 에이전트 칩 고르기 (seq가 바뀔 때마다) */
  pinAgent?: { command: string; seq: number };
  /** T-101 0B.14 바뀔 때마다 입력창에 커서 */
  focusSeq?: number;
  /** 도구줄 오른쪽(전송 버튼 앞)에 붙일 것 (예: 🎤 버튼) */
  toolbarExtra?: ReactNode;
  /** T-101 5C.1 아래 줄 오른쪽(전송 버튼 왼쪽) `[엔진 · 모델 ▾]` — 예전 왼쪽 엔진 칩·인증 칩을 대신한다 */
  modelPicker?: ReactNode;
  /** 지금 고른 AI (메인 AI 등) — 보내는 지시의 엔진 */
  ai?: { engine: string; model?: string } | undefined;
  /** T-101 2A.8 실행 중이면 전송 버튼 자리가 [■ 정지] (일시정지·지금 멈추기, Esc 두 번) */
  stop?: StopControls;
}

const isEnter = (e: KeyboardEvent) => e.key === 'Enter';

function pickEngine(engines: EngineOption[], wanted?: string): string {
  if (wanted && engines.some((e) => e.id === wanted && e.available)) return wanted;
  return engines.find((e) => e.available)?.id ?? wanted ?? '';
}

/**
 * 지시 입력창.
 * 아래 도구줄 순서 고정: + → 권한 칩 → 모드 칩(T-101 3A.3) → … (오른쪽) [엔진 · 모델 ▾] → 전송 (T-101 5C.1).
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
  pinAgent,
  focusSeq,
  toolbarExtra,
  modelPicker,
  ai,
  stop,
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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pinned = useRef(0);
  const { pick } = slash;
  useEffect(() => {
    if (!pinAgent || pinAgent.seq === pinned.current) return;
    pinned.current = pinAgent.seq;
    if (!pick(pinAgent.command)) setText(`${pinAgent.command} `);
  }, [pinAgent, pick]);
  useEffect(() => {
    if (focusSeq) inputRef.current?.focus();
  }, [focusSeq]);
  const [settings, setSettings] = useState<ComposerSettings>(() => ({
    engineId: pickEngine(engines, initialSettings?.engineId),
    auth: initialSettings?.auth ?? 'subscription',
    permission: initialSettings?.permission ?? 'workspace-write',
    // T-101 3E.3 고르기 전에는 비워 둔다(화면은 '일반') — 칩을 직접 고른 값만 에이전트·프로젝트 기본값보다 앞선다
    ...(initialSettings?.mode ? { mode: initialSettings.mode } : {}),
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

  // T-101 3A.4 모드-권한 연동: 계획이면 권한 칩을 읽기 전용으로 잠근다, 오토 + 읽기 전용이면 먼저 묻는다
  const [modeAsk, setModeAsk] = useState<Extract<ModeChange, { kind: 'confirm-write' }>>();
  const perm = permissionView(settings.mode ?? 'normal', settings.permission);
  const chooseMode = (mode: NonNullable<ComposerSettings['mode']>) => {
    const c = planModeChange(mode, settings.permission);
    if (c.kind === 'apply') update({ mode });
    else setModeAsk(c);
  };

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
      settings: { ...settings, permission: perm.permission },
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
                {...act('composer.remove-attachment')}
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
        ref={inputRef}
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
          {...act('composer.plus')}
          type="button"
          className="hx-plus"
          aria-label="추가"
          data-slot="plus"
          {...(plusMenu ? { 'aria-haspopup': 'menu' as const, 'aria-expanded': plusOpen } : {})}
          // T-101 0C.F6 + 메뉴도 처리 함수도 없으면(빌더 대화 탭) 눌러도 아무 일 없으므로 비활성 + 이유
          disabled={!plusMenu && !onPlus}
          title={!plusMenu && !onPlus ? NOT_READY : undefined}
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
              value={perm.permission}
              valueLabel={PERMISSION_LABEL[perm.permission]}
              {...(perm.locked ? { locked: PLAN_LOCK_REASON } : {})}
              options={(Object.keys(PERMISSION_LABEL) as PermissionMode[]).map((v) => ({
                value: v,
                label: PERMISSION_LABEL[v],
                description: PERMISSION_DESC[v],
              }))}
              onChange={(permission) => update({ permission })}
            />
            <ChipMenu
              name={MODE_CHIP_NAME}
              className="hx-chip--mode"
              value={settings.mode ?? 'normal'}
              valueLabel={RUN_MODE_LABEL[settings.mode ?? 'normal']}
              options={modeOptions()}
              onChange={chooseMode}
            />
          </>
        )}
        <span className="hx-composer__spacer" />
        {!compact && modelPicker}
        {toolbarExtra}
        {stop?.running ? (
          <StopButton onPause={stop.onPause} onStopNow={stop.onStopNow} />
        ) : (
          <button
            {...act('composer.send')}
            type="button"
            className="hx-send"
            aria-label="전송"
            disabled={!canSend}
            title={canSend ? undefined : disabled ? '지금은 보낼 수 없어요' : '보낼 내용을 먼저 적어 주세요'}
            onClick={send}
          >
            ↑
          </button>
        )}
      </div>
      {modeAsk && (
        <div className="hx-mode-confirm" role="alertdialog" aria-label="모드 바꾸기 확인">
          <p>{modeAsk.question}</p>
          <button
            type="button"
            className="hx-mode-confirm__yes"
            {...act('composer.mode-upgrade')}
            onClick={() => {
              update({ mode: modeAsk.mode, permission: modeAsk.upgradeTo });
              setModeAsk(undefined);
            }}
          >
            워크스페이스 쓰기로 바꾸기
          </button>
          <button
            type="button"
            className="hx-mode-confirm__no"
            {...act('composer.mode-keep')}
            onClick={() => setModeAsk(undefined)}
          >
            그대로 두기
          </button>
        </div>
      )}
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
