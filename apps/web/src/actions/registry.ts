/**
 * T-101 0C.1 상호작용 계약: 화면의 모든 버튼·메뉴 항목·링크는 `data-action="<id>"`를 달고,
 * 그 id는 이 레지스트리에 있어야 한다. 항목마다 쉬운 말 설명과 "누르면 무엇이 일어나는지"(기대 효과 종류)를 적는다.
 *
 * 처리 함수는 보통 화면 컴포넌트의 onClick 안에 있다(그 자리의 상태를 써야 하므로).
 * 화면 어디서나 같은 일을 하는 전역 동작만 `registerActionHandler`로 등록하고 `runAction`으로 부른다.
 * 개발 모드 경고(0C.3)와 "전부 눌러 보기" 검사(0C.4)가 이 목록을 기준으로 삼는다.
 */

/** 기대 효과 종류: 화면이동 | 창열기 | API요청 | 상태변경 | 파일받기 */
export type ActionEffect = 'navigate' | 'open' | 'api' | 'state' | 'download';

export const ACTION_EFFECT_LABEL: Record<ActionEffect, string> = {
  navigate: '화면이동',
  open: '창열기',
  api: 'API요청',
  state: '상태변경',
  download: '파일받기',
};

export interface ActionSpec {
  /** 쉬운 말 설명 (누르면 무엇을 하나요?) */
  description: string;
  /** 기대 효과 종류 (여러 개면 주된 것부터) */
  effect: ActionEffect | readonly ActionEffect[];
}

/** 화면별 동작 목록. id = `<화면>.<동작>` (영문 kebab-case) */
export const ACTIONS = {
  'shell.open-sidebar': { description: '사이드바를 열어요', effect: 'state' },
  'shell.open-panel': { description: '오른쪽 패널을 열어요', effect: 'state' },

  'sidebar.new-session': { description: '새 대화를 시작해요', effect: 'state' },
  'sidebar.select-session': { description: '고른 대화를 보여 줘요', effect: 'state' },

  'nav.agent-builder': { description: '에이전트 만들기 화면으로 가요', effect: 'navigate' },
  'nav.plugins': { description: '플러그인 화면으로 가요', effect: 'navigate' },
  'nav.skills': { description: '스킬 화면으로 가요', effect: 'navigate' },
  'nav.install': { description: '설치 관리 화면으로 가요', effect: 'navigate' },
  'nav.engines': { description: '엔진 설정 화면으로 가요', effect: 'navigate' },
  'nav.settings': { description: '설정 화면으로 가요', effect: 'navigate' },

  'panel.tab': { description: '오른쪽 패널의 탭을 바꿔요', effect: 'state' },

  'topbar.theme': { description: '밝게·어둡게·자동 테마를 바꿔요', effect: 'state' },

  'chat.mode': { description: '대화를 보는 방식을 바꿔요', effect: 'state' },
  'chat.approval-option': { description: '승인 요청에 답해요', effect: 'api' },
  'chat.open-diff': { description: '바뀐 파일 내용을 패널에서 열어요', effect: 'open' },
  'chat.tool-toggle': { description: '도구 카드를 펼치거나 접어요', effect: 'state' },

  'composer.plus': { description: '+ 메뉴를 열어요', effect: 'open' },
  'composer.send': { description: '적은 내용을 보내요', effect: 'api' },
  'composer.remove-attachment': { description: '첨부한 파일을 빼요', effect: 'state' },
  'composer.chip': { description: '선택 메뉴를 열어요', effect: 'open' },
  'composer.chip-option': { description: '메뉴에서 값을 골라요', effect: 'state' },
  'composer.clear-agent': { description: '고른 에이전트를 해제해요', effect: 'state' },

  'plus.open-folder': { description: '프로젝트 폴더를 고르는 창을 열어요', effect: 'open' },
  'plus.recent': { description: '최근 프로젝트 목록을 펼쳐요', effect: 'state' },
  'plus.pick-recent': { description: '최근 프로젝트를 열어요', effect: 'api' },
  'plus.pin': { description: '프로젝트를 고정하거나 고정을 풀어요', effect: 'api' },
  'plus.attach': { description: '첨부할 파일을 고르는 창을 열어요', effect: 'open' },

  'subagent.add': { description: '지금 하는 대화에 도우미로 더해요', effect: 'api' },
  'subagent.new-session': { description: '새 대화로 실행해요', effect: 'api' },
  'subagent.cancel': { description: '묻는 창을 닫아요', effect: 'state' },

  'recovery.resume': { description: '멈춘 작업을 이어서 해요', effect: 'api' },

  'terminal.login': { description: '터미널에서 엔진 로그인을 시작해요', effect: 'state' },

  'approvals.mini-open': { description: '채팅의 작은 확인 카드를 패널에서 열어요', effect: 'state' },
  'approvals.undo': { description: '방금 고른 답을 취소해요', effect: 'api' },
  'approvals.toast': { description: '알림을 눌러 해당 카드로 가요', effect: 'state' },
  'approvals.choose': { description: '확인 카드에 답해요', effect: 'api' },
  'approvals.more': { description: '자세한 내용을 펼쳐요', effect: 'state' },

  'checklist.toggle': { description: '체크리스트 항목을 펼치거나 접어요', effect: 'state' },
  'checklist.decide': { description: '단계 확인 요청에 답해요', effect: 'api' },
  'checklist.approve-plan': { description: '계획을 승인해요', effect: 'api' },

  'toolpicker.source-link': { description: '가격 출처 페이지를 새 창으로 열어요', effect: 'open' },

  'engines.rescan': { description: 'PC에 설치된 엔진을 다시 찾아요', effect: 'api' },
  'engines.install-guide': { description: '엔진 설치 안내 페이지를 새 창으로 열어요', effect: 'open' },
  'engines.save-key': { description: '열쇠 값을 안전한 보관함에 저장해요', effect: 'api' },
  'engines.save-settings': { description: '모델과 대신 쓸 엔진 설정을 저장해요', effect: 'api' },
  'engines.ping': { description: '엔진이 응답하는지 시험해요', effect: 'api' },

  'install.tab': { description: '설치 관리의 탭을 바꿔요', effect: 'state' },
  'install.update': { description: '도구를 새 버전으로 바꿔요', effect: 'api' },
  'install.remove': { description: '도구를 지워요', effect: 'api' },
  'install.search': { description: '조건에 맞는 도구를 찾아요', effect: 'api' },
  'install.add-plan': { description: '고른 도구의 설치 계획 카드를 열어요', effect: 'state' },
  'install.url-check': { description: '주소로 설치할 방법을 살펴봐요', effect: 'api' },
  'install.pick-method': { description: '고른 설치 방법의 계획을 봐요', effect: 'api' },

  'forge.choice': { description: '만들기 도우미 질문의 보기를 골라요', effect: 'api' },
  'forge.submit': { description: '고른 답을 보내요', effect: 'api' },
  'forge.option': { description: '만들기 도우미 질문에 답해요', effect: 'api' },

  'builder.back': { description: '대화 화면으로 돌아가요', effect: 'navigate' },
  'builder.undo': { description: '방금 한 일을 되돌려요', effect: 'state' },
  'builder.redo': { description: '되돌린 일을 다시 해요', effect: 'state' },
  'builder.save-open': { description: '저장 창을 열어요', effect: 'open' },
  'builder.start-empty': { description: '빈 캔버스로 시작해요', effect: 'state' },
  'builder.start-plugin-list': { description: '플러그인 목록을 보여 줘요', effect: 'state' },
  'builder.start-clone-list': { description: '내 에이전트 목록을 보여 줘요', effect: 'state' },
  'builder.start-chat': { description: '대화로 만들기를 시작해요', effect: 'state' },
  'builder.start-plugin': { description: '고른 플러그인에서 시작해요', effect: 'state' },
  'builder.start-clone': { description: '고른 에이전트를 복사해서 시작해요', effect: 'state' },
  'builder.drawer-tab': { description: '블록 서랍의 탭을 바꿔요', effect: 'state' },
  'builder.sidebar-tab': { description: '대화와 블록 탭을 바꿔요', effect: 'state' },
  'builder.mic': { description: '말로 입력을 시작하거나 끝내요', effect: 'state' },
  'builder.mic-consent-yes': { description: '마이크 사용을 허락해요', effect: 'state' },
  'builder.mic-consent-no': { description: '마이크 사용을 거절해요', effect: 'state' },

  'draft.versions-toggle': { description: '버전 목록을 펼쳐요', effect: 'state' },
  'draft.version-peek': { description: '그 버전의 내용을 봐요', effect: 'state' },
  'draft.version-revert': { description: '그 버전으로 되돌려요', effect: 'state' },
  'draft.peek-close': { description: '버전 보기를 닫아요', effect: 'state' },
  'draft.question-choice': { description: '질문의 보기를 골라요', effect: 'state' },
  'draft.questions-submit': { description: '고른 답을 보내요', effect: 'api' },
  'draft.questions-skip': { description: '질문을 건너뛰어요', effect: 'api' },
  'draft.gap-find-tool': { description: '빈 칸에 맞는 도구를 찾아요', effect: 'open' },
  'draft.gap-forge': { description: '빈 칸을 새로 만들러 가요', effect: 'navigate' },
  'draft.gap-remove': { description: '빈 칸을 빼요', effect: 'state' },
  'draft.patch-apply': { description: '제안한 수정을 적용해요', effect: 'state' },
  'draft.patch-cancel': { description: '제안한 수정을 취소해요', effect: 'state' },
  'draft.resume': { description: '하던 초안을 이어서 해요', effect: 'state' },
  'draft.start-new': { description: '초안을 새로 만들어요', effect: 'state' },
  'draft.list-resume': { description: '고른 초안을 이어서 해요', effect: 'state' },
  'draft.list-delete': { description: '고른 초안을 지워요', effect: 'api' },

  'save.use-suggestion': { description: '추천한 이름을 써요', effect: 'state' },
  'save.fill-gaps': { description: '빈 칸을 채우러 가요', effect: 'state' },
  'save.save-incomplete': { description: '빈 칸이 있어도 저장해요', effect: 'api' },
  'save.save': { description: '에이전트를 저장해요', effect: 'api' },
  'save.close': { description: '저장 창을 닫아요', effect: 'state' },

  'inspector.tab': { description: '속성 창의 탭을 바꿔요', effect: 'state' },
  'inspector.skill-up': { description: '스킬을 위로 옮겨요', effect: 'state' },
  'inspector.skill-down': { description: '스킬을 아래로 옮겨요', effect: 'state' },
  'inspector.save': { description: '에이전트를 저장해요', effect: 'api' },
  'inspector.overwrite': { description: '같은 이름의 에이전트를 덮어써요', effect: 'api' },
  'inspector.dry-run': { description: '시험 실행을 해요', effect: 'state' },
  'inspector.clear-overlay': { description: '시험 실행 표시를 지워요', effect: 'state' },
  'inspector.yaml-apply': { description: '고친 설정 글을 블록 그림에 적용해요', effect: 'state' },
  'inspector.yaml-reset': { description: '고친 설정 글을 되돌려요', effect: 'state' },

  'dev.dismiss-banner': { description: '개발 경고 띠를 닫아요', effect: 'state' },

  'lego.detach-plugin': { description: '플러그인 묶음을 떼어내요', effect: 'state' },
  'lego.remove-skill': { description: '블록에서 스킬을 빼요', effect: 'state' },
} as const satisfies Record<string, ActionSpec>;

export type ActionId = keyof typeof ACTIONS;

export function isActionId(id: string | null | undefined): id is ActionId {
  return !!id && Object.prototype.hasOwnProperty.call(ACTIONS, id);
}

export function actionSpec(id: ActionId): ActionSpec {
  return ACTIONS[id];
}

export function actionEffects(id: ActionId): readonly ActionEffect[] {
  const e = (ACTIONS[id] as ActionSpec).effect;
  return typeof e === 'string' ? [e] : e;
}

/** JSX에 펼쳐 쓰는 도우미: `<button {...act('chat.send')}>` (id 오타는 타입 오류) */
export function act(id: ActionId): { 'data-action': ActionId } {
  return { 'data-action': id };
}

export type ActionHandler = (arg?: unknown) => void;
const handlers = new Map<ActionId, ActionHandler>();

/** 전역 동작의 처리 함수 등록. 돌려받은 함수를 부르면 등록 해제 */
export function registerActionHandler(id: ActionId, fn: ActionHandler): () => void {
  handlers.set(id, fn);
  return () => {
    if (handlers.get(id) === fn) handlers.delete(id);
  };
}

/** 등록된 처리 함수 실행. 없으면 false (부른 쪽이 "아직 준비 중" 처리) */
export function runAction(id: ActionId, arg?: unknown): boolean {
  const fn = handlers.get(id);
  if (!fn) return false;
  fn(arg);
  return true;
}
