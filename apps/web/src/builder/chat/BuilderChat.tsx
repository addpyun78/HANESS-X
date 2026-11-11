import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Composer } from '../../composer/Composer.js';
import type { SendPayload } from '../../composer/types.js';
import { MicButton } from './MicButton.js';
import type { SttHandle } from './stt.js';
import './chat.css';

export interface ChatMessage {
  id: string;
  role: 'user' | 'ai';
  text: string;
  /** 글 아래에 붙는 카드 (요약·질문·바뀐 점 — T-100 P4-C/D/E) */
  card?: ReactNode;
}

export interface BuilderChatProps {
  /** 음성 입력 (없으면 마이크 버튼 없음 — 설정 off 또는 사용 불가) */
  stt?: SttHandle | undefined;
  /** STT를 늦게 정하는 경우 (기본: 없음) */
  loadStt?: () => Promise<SttHandle | undefined>;
  /** 사용자가 [전송]을 눌렀을 때 (설계 AI 연결은 Part 4 C) */
  onSend?: (text: string) => void;
  initialMessages?: ChatMessage[];
  /**
   * 설계 AI 연결 (T-100 P4-C): 있으면 대화 목록을 부모가 정한다(제어 모드).
   * 전송은 onSend로만 알리고, 목록에 "요청을 받았어요" 같은 자리표시 답을 붙이지 않는다.
   */
  messages?: ChatMessage[];
  /** 설계 AI가 일하는 중 */
  busy?: boolean;
  /** 목록 아래(입력창 위)에 붙는 영역 — 질문 카드·바뀐 점 미리보기 */
  extra?: ReactNode;
}

export const BUILDER_CHAT_WELCOME: ChatMessage = {
  id: 'welcome',
  role: 'ai',
  text: '어떤 에이전트를 만들고 싶은지 글이나 말로 설명해 주세요. 예: "임장노트 화면 디자인을 검수해 주는 에이전트 만들어 줘"',
};

let seq = 0;
const nextId = () => `m${++seq}`;

/**
 * P4-B.2 대화로 만들기 탭 (채팅 형태)
 * P4-B.3 입력창은 지시 입력창(Composer)을 그대로 쓴다 — 한글 IME 처리 포함
 * P4-B.9 음성으로 바꾼 글은 입력창에 채우기만 하고, 보내기는 사용자가 한다
 */
export function BuilderChat({
  stt: given,
  loadStt,
  onSend,
  initialMessages,
  messages: controlled,
  busy,
  extra,
}: BuilderChatProps) {
  const [own, setMessages] = useState<ChatMessage[]>(initialMessages ?? [BUILDER_CHAT_WELCOME]);
  const messages = controlled ?? own;
  const [fill, setFill] = useState<{ text: string; seq: number }>();
  const [stt, setStt] = useState<SttHandle | undefined>(given);

  useEffect(() => {
    if (given || !loadStt) return;
    let live = true;
    loadStt()
      .then((s) => live && setStt(s))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [given, loadStt]);

  const fillInput = useCallback((text: string) => setFill((f) => ({ text, seq: (f?.seq ?? 0) + 1 })), []);

  const send = (p: SendPayload) => {
    if (controlled) return onSend?.(p.text);
    setMessages((ms) => [
      ...ms,
      { id: nextId(), role: 'user', text: p.text },
      {
        id: nextId(),
        role: 'ai',
        text: '요청을 받았어요. 에이전트 초안 설계는 곧 연결돼요 — 지금은 왼쪽 [블록] 탭에서 직접 조립할 수 있어요.',
      },
    ]);
    onSend?.(p.text);
  };

  return (
    <section className="hx-bchat" aria-label="대화로 만들기">
      <ol className="hx-bchat__list" aria-label="대화">
        {messages.map((m) => (
          <li key={m.id} className="hx-bchat__msg" data-role={m.role}>
            <span className="hx-bchat__who">{m.role === 'user' ? '나' : 'AI'}</span>
            <p className="hx-bchat__text">{m.text}</p>
            {m.card}
          </li>
        ))}
        {busy && (
          <li className="hx-bchat__msg" data-role="ai" aria-busy="true">
            <span className="hx-bchat__who">AI</span>
            <p className="hx-bchat__text">초안을 만들고 있어요…</p>
          </li>
        )}
      </ol>
      {extra}
      <Composer
        compact
        engines={[]}
        inputLabel="설명 입력"
        placeholder="만들고 싶은 에이전트를 설명하세요 (Enter 전송 · Shift+Enter 줄바꿈)"
        onSend={send}
        {...(fill ? { fill } : {})}
        {...(stt ? { toolbarExtra: <MicButton stt={stt} onText={fillInput} /> } : {})}
      />
    </section>
  );
}
