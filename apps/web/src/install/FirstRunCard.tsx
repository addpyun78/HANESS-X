import { useState } from 'react';
import { ActionCard } from '../panels/Approvals/ActionCard.js';
import type { ActionCardModel } from '../panels/Approvals/model.js';

/**
 * T-100 P2-F.6 새 도구 첫 실행 확인 카드 (서버 kernel tool-first-run-asker.ts)
 *  - approval_request(kind 'tool.first-run') → 패널 카드, 같은 approvalId의 approval_resolved가 오면 사라진다
 *  - 버튼: 이번만 허락 / 앞으로 허락 / 허락 안 함 → POST /api/install/first-run/:id {choice}
 *  - 시간 안에 안 누르면 서버가 거부한다 (자동 허락 없음)
 */

export const FIRST_RUN_KIND = 'tool.first-run';
export type FirstRunChoice = 'once' | 'always' | 'deny';
export const FIRST_RUN_BUTTONS: readonly { id: FirstRunChoice; label: string; primary?: boolean }[] = [
  { id: 'once', label: '이번만 허락', primary: true },
  { id: 'always', label: '앞으로 허락' },
  { id: 'deny', label: '허락 안 함' },
];

export interface FirstRunCardData {
  id: string;
  title: string;
  toolName: string;
  command: string;
  whatHappened: string;
  whyAsking: string;
  timeoutNote?: string;
}

/** 이벤트 → 아직 답하지 않은 첫 실행 카드 */
export function firstRunsFromEvents(events: readonly unknown[]): FirstRunCardData[] {
  const done = new Set<string>();
  for (const e of events) {
    const r = e as { type?: string; approvalId?: string };
    if (r.type === 'approval_resolved' && r.approvalId) done.add(r.approvalId);
  }
  const out: FirstRunCardData[] = [];
  for (const e of events) {
    const r = e as {
      type?: string;
      kind?: string;
      approvalId?: string;
      title?: string;
      detail?: Record<string, unknown>;
    };
    if (r.type !== 'approval_request' || r.kind !== FIRST_RUN_KIND || !r.approvalId) continue;
    if (done.has(r.approvalId) || out.some((x) => x.id === r.approvalId)) continue;
    const d = r.detail ?? {};
    const s = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : '');
    out.push({
      id: r.approvalId,
      title: r.title || '새 도구를 처음 써요',
      toolName: s('toolName'),
      command: s('command'),
      whatHappened: s('whatHappened'),
      whyAsking: s('whyAsking'),
      ...(s('timeoutNote') ? { timeoutNote: s('timeoutNote') } : {}),
    });
  }
  return out;
}

export interface FirstRunCardProps {
  data: FirstRunCardData;
  answer?: (id: string, choice: FirstRunChoice) => Promise<unknown>;
  onDone?: (choice: FirstRunChoice) => void;
  autoFocus?: boolean;
}

export function FirstRunCard({ data, answer, onDone, autoFocus }: FirstRunCardProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const model: ActionCardModel = {
    id: data.id,
    icon: '🔧',
    title: data.title,
    subtitle: data.toolName,
    sections: [
      { heading: '무슨 일이 있었나요?', text: data.whatHappened },
      { heading: '왜 묻나요?', text: data.whyAsking },
      ...(data.timeoutNote ? [{ text: data.timeoutNote }] : []),
    ],
    buttons: FIRST_RUN_BUTTONS.map((b) => ({ ...b })),
    technical: [{ label: '실행하려는 명령', value: data.command }],
  };
  const choose = (id: string) => {
    if (!answer || busy) return;
    const choice = id as FirstRunChoice;
    setBusy(true);
    setError(undefined);
    answer(data.id, choice)
      .then(() => onDone?.(choice))
      .catch(() => setError('답을 보내지 못했어요. 다시 눌러 주세요.'))
      .finally(() => setBusy(false));
  };
  return (
    <ActionCard
      card={model}
      onChoose={choose}
      {...(busy ? { busy } : {})}
      {...(error ? { error } : {})}
      {...(autoFocus ? { autoFocus } : {})}
    />
  );
}
