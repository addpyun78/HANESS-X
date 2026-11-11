/**
 * T-101 0C.5 "전부 눌러 보기"(0C.4) 검사 대상 화면 목록.
 *
 * 데이터만 둔다. 화면을 그리는 함수(가짜 서버·가짜 API 포함)는 같은 id로
 * `apps/web/test/click-all/renderers.tsx`에 있다. 검사: `apps/web/test/click-all.test.tsx` (`pnpm check:dead-buttons`).
 * 새 화면을 만들면 여기에 한 줄 + renderers.tsx에 그리는 함수를 더한다(없으면 검사가 실패한다).
 * 아직 없는 화면은 `pending`에 무엇을 기다리는지 적어 두고, 생기면 지운다.
 */
export interface ScreenSpec {
  /** 영문 kebab-case */
  id: string;
  /** 쉬운 말 이름 */
  name: string;
  /** 0C.5 목록의 어느 부분인가 */
  parts: readonly string[];
  /** 아직 화면이 없으면: 무엇을 기다리는지 (검사는 건너뛰고 목록에 남긴다) */
  pending?: string;
}

export const SCREENS: readonly ScreenSpec[] = [
  {
    id: 'main',
    name: '메인 화면',
    parts: ['사이드바', '채팅', '입력창', '우측 패널 탭', '상단 바'],
  },
  { id: 'main-plus-menu', name: '메인 화면 — + 메뉴 열림', parts: ['+ 메뉴', '최근 프로젝트'] },
  {
    id: 'main-narrow',
    name: '메인 화면 — 좁은 화면(사이드바·패널 시트)',
    parts: ['사이드바', '우측 패널 탭'],
  },
  { id: 'empty-session', name: '빈 세션 화면', parts: ['빈 세션 화면', '입력창'] },
  { id: 'chat-blocks', name: '채팅 블록(도구·바뀐 파일·승인 요청·종료 차단)', parts: ['채팅'] },
  { id: 'composer-agent', name: '입력창 — 에이전트 칩·칩 메뉴·서브에이전트 확인', parts: ['입력창'] },
  {
    id: 'project-picker',
    name: '프로젝트 고르기 카드',
    parts: ['프로젝트 고르기 카드'],
    pending: '0-2(0B) 프로젝트 고르기 카드',
  },
  { id: 'settings-engines', name: '설정 — 엔진', parts: ['설정 전 섹션'] },
  {
    id: 'settings-sections',
    name: '설정 — 나머지 섹션',
    parts: ['설정 전 섹션'],
    pending: '0-1 설정 레지스트리 · 6번 설정 화면',
  },
  { id: 'install-installed', name: '설치 관리 — 설치됨', parts: ['설치 관리'] },
  { id: 'install-search', name: '설치 관리 — 찾기(결과 있음)', parts: ['설치 관리'] },
  { id: 'install-url', name: '설치 관리 — 주소로 설치(방법 있음)', parts: ['설치 관리'] },
  { id: 'install-plan-card', name: '설치 계획 카드·첫 실행 확인 카드', parts: ['설치 관리', '승인 카드'] },
  { id: 'tool-picker', name: '도구 고르기 카드', parts: ['도구 고르기 카드'] },
  { id: 'approval-card', name: '승인 카드(쉬운 말)·알림·작은 카드', parts: ['승인 카드'] },
  {
    id: 'checklist',
    name: '체크리스트 패널(트리·단계 확인·계획 검토)',
    parts: ['우측 패널 탭', '승인 카드'],
  },
  { id: 'recovery', name: '이어서 하기 카드', parts: ['채팅'] },
  { id: 'forge-cards', name: 'Forge 질문 카드', parts: ['채팅'] },
  { id: 'builder-start', name: '에이전트 만들기 — 시작 고르기', parts: ['에이전트 만들기(블록·대화)'] },
  {
    id: 'builder-blocks',
    name: '에이전트 만들기 — 블록(캔버스·속성·저장)',
    parts: ['에이전트 만들기(블록·대화)'],
  },
  { id: 'builder-chat', name: '에이전트 만들기 — 대화(초안 카드)', parts: ['에이전트 만들기(블록·대화)'] },
];

/** 검사 대상(아직 없는 화면 제외) */
export const READY_SCREENS = SCREENS.filter((s) => !s.pending);
