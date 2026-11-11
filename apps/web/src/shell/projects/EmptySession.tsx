import { act } from '../../actions/registry.js';
/** 0B.18 빈 세션(초안) 화면 */

export const EXAMPLE_PROMPTS = [
  '이 프로젝트가 어떤 일을 하는지 쉽게 설명해 줘',
  '고칠 만한 문제를 찾아서 목록으로 보여 줘',
  '처음 시작하는 방법을 정리해서 알려 줘',
] as const;

export interface RecentAgent {
  command: string;
  name: string;
  icon?: string;
}

export interface EmptySessionProps {
  projectName: string;
  /** 최근 쓴 에이전트 (앞 3개만 보인다) */
  recentAgents: RecentAgent[];
  /** 예시 지시 → 입력창에 채움 (보내지는 않는다) */
  onExample: (text: string) => void;
  /** 에이전트 → 입력창에 / 칩 */
  onAgent: (command: string) => void;
  /** 고지: 0B.13 "그 폴더에서 새 세션을 열게요" 같은 안내 */
  notice?: string;
}

export function EmptySession({ projectName, recentAgents, onExample, onAgent, notice }: EmptySessionProps) {
  const agents = recentAgents.slice(0, 3);
  return (
    <section className="hx-empty-session" aria-label="새 세션">
      {notice && (
        <p className="hx-empty-session__notice" role="status">
          {notice}
        </p>
      )}
      <h2>{projectName}에서 무엇을 할까요?</h2>
      <ul className="hx-empty-session__examples" aria-label="예시 지시">
        {EXAMPLE_PROMPTS.map((t) => (
          <li key={t}>
            <button {...act('empty.example')} type="button" onClick={() => onExample(t)}>
              {t}
            </button>
          </li>
        ))}
      </ul>
      {agents.length > 0 && (
        <ul className="hx-empty-session__agents" aria-label="최근 쓴 에이전트">
          {agents.map((a) => (
            <li key={a.command}>
              <button {...act('empty.agent')} type="button" onClick={() => onAgent(a.command)}>
                <span aria-hidden="true">{a.icon ?? '✦'}</span> {a.name}
                <span className="hx-mono"> {a.command}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="hx-empty-session__drop">파일을 입력창에 끌어다 놓아도 돼요.</p>
    </section>
  );
}
