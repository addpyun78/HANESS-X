# T-101 0C.6 기존 화면 전수 점검 — 동작 없는 버튼

만든 방법: `HX_DEAD_BUTTONS_REPORT=<json> pnpm exec vitest run apps/web/test/click-all.test.tsx` (0C.4 "전부 눌러 보기", e2e/screens.ts의 준비된 화면 19개)
+ `pnpm exec eslint apps/web/src` (0C.2 `hx/no-dead-button`). 실행일 2026-11-12, 수정 전 상태.

- 누른 버튼·링크·메뉴 항목·탭: **207개** (화면마다 새로 그려서 하나씩)
- 2초 안에 아무 일도 없었던 것: **19건** (같은 버튼이 여러 화면에 나온 것 포함, 서로 다른 원인 6개 → 0C.F1~F6)
- 비활성인데 "왜 못 누르는지" 툴팁이 없는 버튼(린트 disabledNoReason): **25건** → 0C.F7~F13 (린트 noHandler 1건 = 채팅 승인 요청 보기 버튼, 0C.F5와 같음)
- 아직 없는 화면(검사 보류): 프로젝트 고르기 카드(0-2), 설정 나머지 섹션(0-1·6번) — e2e/screens.ts `pending`

## A. 전부 눌러 보기 결과

| 화면 | 버튼 (data-action) | 지금 동작 | 조치 |
| --- | --- | --- | --- |
| main | 테마 바꾸기 (현재: 시스템 테마) (`topbar.theme`) | 화면 바뀜, 설정 저장 | 없음(정상) |
| main | + 새 세션 (`sidebar.new-session`) | **아무 일 없음** | 0C.F1 |
| main | ✦/reviewer 로그인 화면 검토준비 중0% (`sidebar.select-session`) | 화면 바뀜 | 없음(정상) |
| main | ✦에이전트 만들기 (`nav.agent-builder`) | 화면 바뀜, 주소 바뀜 | 없음(정상) |
| main | ⧉플러그인 (`nav.plugins`) | **아무 일 없음** | 0C.F2 |
| main | ◇스킬 (`nav.skills`) | **아무 일 없음** | 0C.F3 |
| main | ⬇설치 관리 (`nav.install`) | API 요청, 화면 바뀜 | 없음(정상) |
| main | ⚙엔진 (`nav.engines`) | API 요청, 화면 바뀜 | 없음(정상) |
| main | ☰설정 (`nav.settings`) | **아무 일 없음** | 0C.F4 |
| main | 자세히 (`chat.mode`) | 화면 바뀜 | 없음(정상) |
| main | 보통 (`chat.mode`) | 이미 골라져 있음(그대로가 정상) | 없음(정상) |
| main | 요약 (`chat.mode`) | 화면 바뀜 | 없음(정상) |
| main | ▸⚒Bashpnpm test (`chat.tool-toggle`) | 화면 바뀜 | 없음(정상) |
| main | ▸✎수정 src/app.ts (`chat.tool-toggle`) | 화면 바뀜 | 없음(정상) |
| main | Diff 열기: src/app.ts (`chat.open-diff`) | 화면 바뀜 | 없음(정상) |
| main | 동치 인정 (`chat.approval-option`) | **아무 일 없음** | 0C.F5 |
| main | 이동 (`chat.approval-option`) | **아무 일 없음** | 0C.F5 |
| main | 실패 (`chat.approval-option`) | **아무 일 없음** | 0C.F5 |
| main | 추가 (`composer.plus`) | 화면 바뀜 | 없음(정상) |
| main | 엔진: Claude Code (`composer.chip`) | 화면 바뀜 | 없음(정상) |
| main | 인증: 구독 (`composer.chip`) | 화면 바뀜 | 없음(정상) |
| main | 권한: 워크스페이스 쓰기 (`composer.chip`) | 화면 바뀜 | 없음(정상) |
| main | 체크리스트 (`panel.tab`) | 화면 바뀜 | 없음(정상) |
| main | Diff (`panel.tab`) | 화면 바뀜 | 없음(정상) |
| main | 터미널 (`panel.tab`) | 화면 바뀜 | 없음(정상) |
| main | 궤적 (`panel.tab`) | 화면 바뀜 | 없음(정상) |
| main-plus-menu | 📁프로젝트 폴더 열기… (`plus.open-folder`) | API 요청, 화면 바뀜 | 없음(정상) |
| main-plus-menu | 🕘최근 프로젝트 (`plus.recent`) | 화면 바뀜 | 없음(정상) |
| main-plus-menu | ★old/mnt/c/work/old (`plus.pick-recent`) | API 요청, 화면 바뀜 | 없음(정상) |
| main-plus-menu | old 고정 해제 (`plus.pin`) | API 요청, 화면 바뀜 | 없음(정상) |
| main-plus-menu | app/mnt/c/work/app (`plus.pick-recent`) | API 요청, 화면 바뀜 | 없음(정상) |
| main-plus-menu | app 고정 (`plus.pin`) | API 요청, 화면 바뀜 | 없음(정상) |
| main-plus-menu | 📎파일 첨부 (`plus.attach`) | 화면 바뀜, 창 열림 | 없음(정상) |
| main-narrow | 사이드바 열기 (`shell.open-sidebar`) | 화면 바뀜 | 없음(정상) |
| main-narrow | 테마 바꾸기 (현재: 시스템 테마) (`topbar.theme`) | 화면 바뀜, 설정 저장 | 없음(정상) |
| main-narrow | 패널 열기 (`shell.open-panel`) | API 요청, 화면 바뀜 | 없음(정상) |
| empty-session | 테마 바꾸기 (현재: 시스템 테마) (`topbar.theme`) | 화면 바뀜, 설정 저장 | 없음(정상) |
| empty-session | + 새 세션 (`sidebar.new-session`) | **아무 일 없음** | 0C.F1 |
| empty-session | ✦에이전트 만들기 (`nav.agent-builder`) | 화면 바뀜, 주소 바뀜 | 없음(정상) |
| empty-session | ⧉플러그인 (`nav.plugins`) | **아무 일 없음** | 0C.F2 |
| empty-session | ◇스킬 (`nav.skills`) | **아무 일 없음** | 0C.F3 |
| empty-session | ⬇설치 관리 (`nav.install`) | API 요청, 화면 바뀜 | 없음(정상) |
| empty-session | ⚙엔진 (`nav.engines`) | API 요청, 화면 바뀜 | 없음(정상) |
| empty-session | ☰설정 (`nav.settings`) | **아무 일 없음** | 0C.F4 |
| empty-session | 자세히 (`chat.mode`) | 화면 바뀜 | 없음(정상) |
| empty-session | 보통 (`chat.mode`) | 이미 골라져 있음(그대로가 정상) | 없음(정상) |
| empty-session | 요약 (`chat.mode`) | 화면 바뀜 | 없음(정상) |
| empty-session | 추가 (`composer.plus`) | 화면 바뀜 | 없음(정상) |
| empty-session | 엔진: Claude Code (`composer.chip`) | 화면 바뀜 | 없음(정상) |
| empty-session | 인증: 구독 (`composer.chip`) | 화면 바뀜 | 없음(정상) |
| empty-session | 권한: 워크스페이스 쓰기 (`composer.chip`) | 화면 바뀜 | 없음(정상) |
| empty-session | 체크리스트 (`panel.tab`) | 화면 바뀜 | 없음(정상) |
| empty-session | Diff (`panel.tab`) | 화면 바뀜 | 없음(정상) |
| empty-session | 터미널 (`panel.tab`) | 화면 바뀜 | 없음(정상) |
| empty-session | 궤적 (`panel.tab`) | 화면 바뀜 | 없음(정상) |
| chat-blocks | 자세히 (`chat.mode`) | 이벤트(부모에게 알림) | 없음(정상) |
| chat-blocks | 보통 (`chat.mode`) | 이벤트(부모에게 알림) | 없음(정상) |
| chat-blocks | 요약 (`chat.mode`) | 이벤트(부모에게 알림) | 없음(정상) |
| chat-blocks | ▸⚒Bashpnpm test (`chat.tool-toggle`) | 화면 바뀜 | 없음(정상) |
| chat-blocks | ▸✎수정 src/app.ts (`chat.tool-toggle`) | 화면 바뀜 | 없음(정상) |
| chat-blocks | 동치 인정 (`chat.approval-option`) | **아무 일 없음** | 0C.F5 |
| chat-blocks | 이동 (`chat.approval-option`) | **아무 일 없음** | 0C.F5 |
| chat-blocks | 실패 (`chat.approval-option`) | **아무 일 없음** | 0C.F5 |
| composer-agent | 추가 (`composer.plus`) | 화면 바뀜 | 없음(정상) |
| composer-agent | 엔진: Claude Code (`composer.chip`) | 화면 바뀜 | 없음(정상) |
| composer-agent | 인증: 구독 (`composer.chip`) | 화면 바뀜 | 없음(정상) |
| composer-agent | 권한: 워크스페이스 쓰기 (`composer.chip`) | 화면 바뀜 | 없음(정상) |
| composer-agent | 전송 (`composer.send`) | 화면 바뀜, 이벤트(부모에게 알림) | 없음(정상) |
| composer-agent | 서브에이전트로 추가 (`subagent.add`) | 이벤트(부모에게 알림) | 없음(정상) |
| composer-agent | 새 세션으로 실행 (`subagent.new-session`) | 이벤트(부모에게 알림) | 없음(정상) |
| composer-agent | 취소 (`subagent.cancel`) | 이벤트(부모에게 알림) | 없음(정상) |
| settings-engines | 다시 스캔 (`engines.rescan`) | API 요청, 화면 바뀜 | 없음(정상) |
| settings-engines | 저장 (`engines.save-settings`) | API 요청 | 없음(정상) |
| settings-engines | 테스트 실행 (`engines.ping`) | API 요청, 화면 바뀜 | 없음(정상) |
| settings-engines | 저장 (`engines.save-settings`) | API 요청 | 없음(정상) |
| settings-engines | 테스트 실행 (`engines.ping`) | API 요청, 화면 바뀜 | 없음(정상) |
| settings-engines | 설치 안내 (`engines.install-guide`) | 창 열림 | 없음(정상) |
| settings-engines | 설치 안내 (`engines.install-guide`) | 창 열림 | 없음(정상) |
| install-installed | 설치됨 (`install.tab`) | 이미 골라져 있음(그대로가 정상) | 없음(정상) |
| install-installed | 찾기 (`install.tab`) | 화면 바뀜 | 없음(정상) |
| install-installed | 주소로 설치 (`install.tab`) | 화면 바뀜 | 없음(정상) |
| install-installed | 기록 (`install.tab`) | API 요청, 화면 바뀜 | 없음(정상) |
| install-installed | 업데이트 (`install.update`) | API 요청, 화면 바뀜 | 없음(정상) |
| install-installed | 지우기 (`install.remove`) | API 요청, 이벤트(부모에게 알림) | 없음(정상) |
| install-search | 설치됨 (`install.tab`) | API 요청, 화면 바뀜 | 없음(정상) |
| install-search | 찾기 (`install.tab`) | 이미 골라져 있음(그대로가 정상) | 없음(정상) |
| install-search | 주소로 설치 (`install.tab`) | 화면 바뀜 | 없음(정상) |
| install-search | 기록 (`install.tab`) | API 요청, 화면 바뀜 | 없음(정상) |
| install-search | 찾기 (`install.search`) | API 요청, 화면 바뀜 | 없음(정상) |
| install-search | 이걸로 설치 (`install.add-plan`) | 이벤트(부모에게 알림) | 없음(정상) |
| install-url | 설치됨 (`install.tab`) | API 요청, 화면 바뀜 | 없음(정상) |
| install-url | 찾기 (`install.tab`) | 화면 바뀜 | 없음(정상) |
| install-url | 주소로 설치 (`install.tab`) | 이미 골라져 있음(그대로가 정상) | 없음(정상) |
| install-url | 기록 (`install.tab`) | API 요청, 화면 바뀜 | 없음(정상) |
| install-url | 확인 (`install.url-check`) | API 요청, 화면 바뀜 | 없음(정상) |
| install-url | 이 방법으로 계획 보기 (`install.pick-method`) | API 요청, 이벤트(부모에게 알림) | 없음(정상) |
| install-plan-card | ① 설치 (`approvals.choose`) | API 요청, 화면 바뀜 | 없음(정상) |
| install-plan-card | ② 다른 방법 보기 (`approvals.choose`) | 이벤트(부모에게 알림) | 없음(정상) |
| install-plan-card | ③ 취소 (`approvals.choose`) | 이벤트(부모에게 알림) | 없음(정상) |
| install-plan-card | ▸ 자세히 보기 (기술 정보) (`approvals.more`) | 화면 바뀜 | 없음(정상) |
| install-plan-card | ① 이번만 허락 (`approvals.choose`) | API 요청, 화면 바뀜, 이벤트(부모에게 알림) | 없음(정상) |
| install-plan-card | ② 앞으로 허락 (`approvals.choose`) | API 요청, 화면 바뀜, 이벤트(부모에게 알림) | 없음(정상) |
| install-plan-card | ③ 허락 안 함 (`approvals.choose`) | API 요청, 화면 바뀜, 이벤트(부모에게 알림) | 없음(정상) |
| install-plan-card | ▸ 자세히 보기 (기술 정보) (`approvals.more`) | 화면 바뀜 | 없음(정상) |
| tool-picker | 출처 링크 (`toolpicker.source-link`) | 창 열림 | 없음(정상) |
| tool-picker | 출처 링크 (`toolpicker.source-link`) | 창 열림 | 없음(정상) |
| tool-picker | 출처 링크 (`toolpicker.source-link`) | 창 열림 | 없음(정상) |
| tool-picker | ① 선택한 걸로 설치 (`approvals.choose`) | 이벤트(부모에게 알림) | 없음(정상) |
| tool-picker | ② 주소 직접 넣기 (`approvals.choose`) | 이벤트(부모에게 알림) | 없음(정상) |
| tool-picker | ③ 설치 없이 계속 (`approvals.choose`) | 이벤트(부모에게 알림) | 없음(정상) |
| approval-card | 테마 바꾸기 (현재: 시스템 테마) (`topbar.theme`) | 화면 바뀜, 설정 저장 | 없음(정상) |
| approval-card | + 새 세션 (`sidebar.new-session`) | **아무 일 없음** | 0C.F1 |
| approval-card | ✦에이전트 만들기 (`nav.agent-builder`) | 화면 바뀜, 주소 바뀜 | 없음(정상) |
| approval-card | ⧉플러그인 (`nav.plugins`) | **아무 일 없음** | 0C.F2 |
| approval-card | ◇스킬 (`nav.skills`) | **아무 일 없음** | 0C.F3 |
| approval-card | ⬇설치 관리 (`nav.install`) | API 요청, 화면 바뀜 | 없음(정상) |
| approval-card | ⚙엔진 (`nav.engines`) | API 요청, 화면 바뀜 | 없음(정상) |
| approval-card | ☰설정 (`nav.settings`) | **아무 일 없음** | 0C.F4 |
| approval-card | 자세히 (`chat.mode`) | 화면 바뀜 | 없음(정상) |
| approval-card | 보통 (`chat.mode`) | 이미 골라져 있음(그대로가 정상) | 없음(정상) |
| approval-card | 요약 (`chat.mode`) | 화면 바뀜 | 없음(정상) |
| approval-card | 확인이 필요해요 (항목 3.2.2) — 카드 보기 (`approvals.mini-open`) | 화면 바뀜 | 없음(정상) |
| approval-card | 확인이 필요해요 (항목 4.1) — 카드 보기 (`approvals.mini-open`) | 화면 바뀜 | 없음(정상) |
| approval-card | 확인이 필요해요 (항목 5.3) — 카드 보기 (`approvals.mini-open`) | 화면 바뀜 | 없음(정상) |
| approval-card | 추가 (`composer.plus`) | 화면 바뀜 | 없음(정상) |
| approval-card | 엔진: Claude Code (`composer.chip`) | 화면 바뀜 | 없음(정상) |
| approval-card | 인증: 구독 (`composer.chip`) | 화면 바뀜 | 없음(정상) |
| approval-card | 권한: 워크스페이스 쓰기 (`composer.chip`) | 화면 바뀜 | 없음(정상) |
| approval-card | ① 같은 걸로 인정 (`approvals.choose`) | API 요청, 화면 바뀜 | 없음(정상) |
| approval-card | ② 원래 자리로 다시 만들기 (`approvals.choose`) | API 요청, 화면 바뀜 | 없음(정상) |
| approval-card | ③ 잘 모르겠어요 — 안전하게 멈추기 (`approvals.choose`) | API 요청, 화면 바뀜 | 없음(정상) |
| approval-card | ④ 이 위치로 옮긴 걸 허락 (`approvals.choose`) | API 요청, 화면 바뀜 | 없음(정상) |
| approval-card | ▸ 자세히 보기 (기술 정보) (`approvals.more`) | 화면 바뀜 | 없음(정상) |
| approval-card | ① 같은 걸로 인정 (`approvals.choose`) | API 요청, 화면 바뀜 | 없음(정상) |
| approval-card | ② 원래 자리로 다시 만들기 (`approvals.choose`) | API 요청, 화면 바뀜 | 없음(정상) |
| approval-card | ③ 잘 모르겠어요 — 안전하게 멈추기 (`approvals.choose`) | API 요청, 화면 바뀜 | 없음(정상) |
| approval-card | ▸ 자세히 보기 (기술 정보) (`approvals.more`) | 화면 바뀜 | 없음(정상) |
| approval-card | ① 같은 걸로 인정 (`approvals.choose`) | API 요청, 화면 바뀜 | 없음(정상) |
| approval-card | ② 원래 자리로 다시 만들기 (`approvals.choose`) | API 요청, 화면 바뀜 | 없음(정상) |
| approval-card | ③ 잘 모르겠어요 — 안전하게 멈추기 (`approvals.choose`) | API 요청, 화면 바뀜 | 없음(정상) |
| approval-card | ▸ 자세히 보기 (기술 정보) (`approvals.more`) | 화면 바뀜 | 없음(정상) |
| approval-card | 체크리스트 (`panel.tab`) | 화면 바뀜 | 없음(정상) |
| approval-card | Diff (`panel.tab`) | 화면 바뀜 | 없음(정상) |
| approval-card | 터미널 (`panel.tab`) | 화면 바뀜 | 없음(정상) |
| approval-card | 궤적 (`panel.tab`) | 화면 바뀜 | 없음(정상) |
| approval-card | 확인이 필요해요 — 계획에는 "하네스/모바일" 폴더에 만들기로 했어요. 그런데 AI가 "ai/mobile"  (`approvals.toast`) | 화면 바뀜 | 없음(정상) |
| approval-card | 확인이 필요해요 — 계획에는 "로그인 성공"이라는 글이 나와야 했어요. 실제로는 "로그인에 성공했습니다"라는 (`approvals.toast`) | 화면 바뀜 | 없음(정상) |
| approval-card | 확인이 필요해요 — 계획에는 "1,000"이라는 숫자가 나와야 했어요. 실제로는 "1000.0"이라는 숫자가 (`approvals.toast`) | 화면 바뀜 | 없음(정상) |
| checklist | 동치 인정 (`checklist.decide`) | API 요청, 화면 바뀜 | 없음(정상) |
| checklist | 이동 승인 (`checklist.decide`) | API 요청, 화면 바뀜 | 없음(정상) |
| checklist | 실패 (`checklist.decide`) | API 요청, 화면 바뀜 | 없음(정상) |
| checklist | 1 모바일 앱 폴더 생성 (완료) (`checklist.toggle`) | 화면 바뀜 | 없음(정상) |
| checklist | 1.1 앱 진입점 작성 (완료) (`checklist.toggle`) | 화면 바뀜 | 없음(정상) |
| checklist | 2 로그인 화면 구현 (진행 중) (`checklist.toggle`) | 화면 바뀜 | 없음(정상) |
| checklist | 2.1 로그인 폼 검증 추가 (대기) (`checklist.toggle`) | 화면 바뀜 | 없음(정상) |
| checklist | 3 배포 스크립트 작성 (대기) (`checklist.toggle`) | 화면 바뀜 | 없음(정상) |
| checklist | 1 모바일 앱 폴더 생성 (완료) (`checklist.toggle`) | 화면 바뀜 | 없음(정상) |
| checklist | 1.1 앱 진입점 작성 (완료) (`checklist.toggle`) | 화면 바뀜 | 없음(정상) |
| checklist | 2 로그인 화면 구현 (진행 중) (`checklist.toggle`) | 화면 바뀜 | 없음(정상) |
| checklist | 2.1 로그인 폼 검증 추가 (대기) (`checklist.toggle`) | 화면 바뀜 | 없음(정상) |
| checklist | 3 배포 스크립트 작성 (대기) (`checklist.toggle`) | 화면 바뀜 | 없음(정상) |
| recovery | 이어서 하기 (`recovery.resume`) | API 요청, 화면 바뀜 | 없음(정상) |
| forge-cards | 자세히 (`chat.mode`) | 이벤트(부모에게 알림) | 없음(정상) |
| forge-cards | 보통 (`chat.mode`) | 이벤트(부모에게 알림) | 없음(정상) |
| forge-cards | 요약 (`chat.mode`) | 이벤트(부모에게 알림) | 없음(정상) |
| forge-cards | 훅 (`forge.choice`) | 화면 바뀜, 이벤트(부모에게 알림) | 없음(정상) |
| forge-cards | 스킬 (`forge.choice`) | 화면 바뀜, 이벤트(부모에게 알림) | 없음(정상) |
| forge-cards | 가 (`forge.choice`) | 화면 바뀜 | 없음(정상) |
| forge-cards | 나 (`forge.choice`) | 화면 바뀜 | 없음(정상) |
| forge-cards | 저장 (`forge.choice`) | 화면 바뀜, 이벤트(부모에게 알림) | 없음(정상) |
| forge-cards | 취소 (`forge.choice`) | 화면 바뀜, 이벤트(부모에게 알림) | 없음(정상) |
| builder-start | ← 대화로 (`builder.back`) | 주소 바뀜 | 없음(정상) |
| builder-start | 빈 캔버스노드를 하나씩 끌어다 놓습니다 (`builder.start-empty`) | 화면 바뀜 | 없음(정상) |
| builder-start | 플러그인에서 시작플러그인 파이프라인을 펼쳐 고칩니다 (`builder.start-plugin-list`) | 화면 바뀜 | 없음(정상) |
| builder-start | 기존 에이전트 복제등록된 에이전트를 복사해 고칩니다 (`builder.start-clone-list`) | 화면 바뀜 | 없음(정상) |
| builder-start | 말이나 글로 설명해서 만들기AI에게 원하는 에이전트를 설명하면 초안을 만들어 줘요 (`builder.start-chat`) | 화면 바뀜 | 없음(정상) |
| builder-blocks | ← 대화로 (`builder.back`) | 주소 바뀜 | 없음(정상) |
| builder-blocks | 실행 취소 (`builder.undo`) | 화면 바뀜 | 없음(정상) |
| builder-blocks | 저장 (`inspector.save`) | API 요청, 화면 바뀜 | 없음(정상) |
| builder-blocks | 블록 (`builder.sidebar-tab`) | 이미 골라져 있음(그대로가 정상) | 없음(정상) |
| builder-blocks | 💬 대화로 만들기 (`builder.sidebar-tab`) | 화면 바뀜 | 없음(정상) |
| builder-blocks | 노드 (`builder.drawer-tab`) | 이미 골라져 있음(그대로가 정상) | 없음(정상) |
| builder-blocks | 플러그인 (`builder.drawer-tab`) | 화면 바뀜 | 없음(정상) |
| builder-blocks | 스킬 (`builder.drawer-tab`) | 화면 바뀜 | 없음(정상) |
| builder-blocks | 엔진 (`builder.drawer-tab`) | 화면 바뀜 | 없음(정상) |
| builder-blocks | 도구 (`builder.drawer-tab`) | 화면 바뀜 | 없음(정상) |
| builder-blocks | Zoom In (`third-party:react-flow-controls`) | 화면 바뀜 | 없음(정상) |
| builder-blocks | Zoom Out (`third-party:react-flow-controls`) | 화면 바뀜 | 없음(정상) |
| builder-blocks | Fit View (`third-party:react-flow-controls`) | **아무 일 없음** | 없음 — 라이브러리(React Flow) 버튼, 이미 화면에 맞춰져 있어 그대로 |
| builder-blocks | 노드 (`inspector.tab`) | 이미 골라져 있음(그대로가 정상) | 없음(정상) |
| builder-blocks | YAML 보기 (`inspector.tab`) | 화면 바뀜 | 없음(정상) |
| builder-blocks | 시험 실행 (`inspector.tab`) | 화면 바뀜 | 없음(정상) |
| builder-chat | ← 대화로 (`builder.back`) | 주소 바뀜 | 없음(정상) |
| builder-chat | 블록 (`builder.sidebar-tab`) | 화면 바뀜 | 없음(정상) |
| builder-chat | 💬 대화로 만들기 (`builder.sidebar-tab`) | 이미 골라져 있음(그대로가 정상) | 없음(정상) |
| builder-chat | 화면 고치기 (`draft.question-choice`) | 화면 바뀜 | 없음(정상) |
| builder-chat | 코드 검사 (`draft.question-choice`) | 화면 바뀜 | 없음(정상) |
| builder-chat | 고쳐도 돼요 (`draft.question-choice`) | 화면 바뀜 | 없음(정상) |
| builder-chat | 읽기만 해요 (`draft.question-choice`) | 화면 바뀜 | 없음(정상) |
| builder-chat | 알아서 해 줘 (`draft.questions-skip`) | API 요청, 화면 바뀜 | 없음(정상) |
| builder-chat | 추가 (`composer.plus`) | **아무 일 없음** | 0C.F6 |
| builder-chat | Zoom In (`third-party:react-flow-controls`) | 화면 바뀜 | 없음(정상) |
| builder-chat | Zoom Out (`third-party:react-flow-controls`) | 화면 바뀜 | 없음(정상) |
| builder-chat | Fit View (`third-party:react-flow-controls`) | **아무 일 없음** | 없음 — 라이브러리(React Flow) 버튼, 이미 화면에 맞춰져 있어 그대로 |
| builder-chat | 노드 (`inspector.tab`) | 이미 골라져 있음(그대로가 정상) | 없음(정상) |
| builder-chat | YAML 보기 (`inspector.tab`) | 화면 바뀜 | 없음(정상) |
| builder-chat | 시험 실행 (`inspector.tab`) | 화면 바뀜 | 없음(정상) |

## B. 린트: 비활성 버튼에 이유(툴팁) 없음

| 화면 | 버튼 (파일) | 지금 동작 | 조치 |
| --- | --- | --- | --- |
| 입력창 | 전송 ↑ (composer/Composer.tsx) | 비활성일 때 이유가 안 보임 | 0C.F7 |
| 입력창 | 칩 메뉴의 고를 수 없는 값 (composer/ChipMenu.tsx) | 비활성일 때 이유가 안 보임 | 0C.F7 |
| 채팅 | 도구 카드 펼치기(내용 없음) (chat/ToolCard.tsx) | 비활성일 때 이유가 안 보임 | 0C.F7 |
| Forge 카드 | 보기 버튼(답한 뒤) (forge/ForgeCards.tsx) | 비활성일 때 이유가 안 보임 | 0C.F8 |
| Forge 카드 | 확인(고른 것 없음·답한 뒤) (forge/ForgeCards.tsx) | 비활성일 때 이유가 안 보임 | 0C.F8 |
| 승인 카드 | 답 버튼(처리 중·확인 체크 전) (panels/Approvals/ActionCard.tsx) | 비활성일 때 이유가 안 보임 | 0C.F9 |
| 체크리스트 | 단계 확인 답 버튼 (panels/Checklist/ApprovalCard.tsx) | 비활성일 때 이유가 안 보임 | 0C.F9 |
| 체크리스트 | 계획 승인 (panels/Checklist/PlanReview.tsx) | 비활성일 때 이유가 안 보임 | 0C.F9 |
| 이어서 하기 | 이어서 하기(진행 중·끝남) (recovery/ResumeCard.tsx) | 비활성일 때 이유가 안 보임 | 0C.F9 |
| 설정 — 엔진 | 키 저장(빈 칸) (settings/Engines/EngineCard.tsx) | 비활성일 때 이유가 안 보임 | 0C.F10 |
| 설정 — 엔진 | 테스트 실행(진행 중) (settings/Engines/EngineCard.tsx) | 비활성일 때 이유가 안 보임 | 0C.F10 |
| 설정 — 엔진 | 다시 찾기(찾는 중) (settings/Engines/EnginesSettings.tsx) | 비활성일 때 이유가 안 보임 | 0C.F10 |
| 설치 관리 | 찾기(찾는 중) (install/InstallManager.tsx) | 비활성일 때 이유가 안 보임 | 0C.F11 |
| 설치 관리 | 주소 확인(살펴보는 중) (install/InstallManager.tsx) | 비활성일 때 이유가 안 보임 | 0C.F11 |
| 에이전트 만들기(블록) | 저장 창 열기(블록 없음) (builder/BuilderPage.tsx) | 비활성일 때 이유가 안 보임 | 0C.F12 |
| 에이전트 만들기(블록) | 스킬 위로·아래로(맨 끝) ×2 (builder/inspector/NodeFields.tsx) | 비활성일 때 이유가 안 보임 | 0C.F12 |
| 에이전트 만들기(블록) | 시험 실행(실행 중) (builder/inspector/DryRunTab.tsx) | 비활성일 때 이유가 안 보임 | 0C.F12 |
| 에이전트 만들기(블록) | 저장(이름 오류·블록 없음 등) (builder/inspector/SaveBar.tsx) | 비활성일 때 이유가 안 보임 | 0C.F12 |
| 에이전트 만들기(블록) | 설정 글 적용·되돌리기(고친 것 없음) ×2 (builder/inspector/YamlTab.tsx) | 비활성일 때 이유가 안 보임 | 0C.F12 |
| 에이전트 만들기(대화) | 말로 입력(처리 중·허락 묻는 중) (builder/chat/MicButton.tsx) | 비활성일 때 이유가 안 보임 | 0C.F13 |
| 에이전트 만들기(대화) | 질문 답 보내기(다 안 고름) (builder/draft/DraftCards.tsx) | 비활성일 때 이유가 안 보임 | 0C.F13 |
| 에이전트 만들기(대화) | 저장·빈 칸 있어도 저장(이름 오류·저장 중) ×2 (builder/draft/SaveDialog.tsx) | 비활성일 때 이유가 안 보임 | 0C.F13 |

## C. master 병합 뒤 재점검 (0-1 설정 폼·0-2 프로젝트 사이드바 합쳐진 뒤)

같은 검사기로 새 화면 5개(project-sidebar, project-sidebar-menus, project-picker, empty-session-projects, settings-form)를 목록에 넣고 다시 돌림.

| 화면 | 버튼 (파일) | 지금 동작 | 조치 |
| --- | --- | --- | --- |
| 설정 폼 | 켜기/끄기·목록 더하기/빼기·폴더 고르기·열쇠 저장/지우기·기본값으로(항목·묶음·전부·확인·그만두기) — `data-action="settings.*"` 11종 (settings/form/*.tsx) | 눌리면 동작하지만 id가 레지스트리에 없음 → 개발 모드 빨간 배너 | 0C.F14 |
| 설정 폼 | 위 버튼 중 비활성 8개 (저장 중·바꿀 수 없음) | 비활성일 때 이유가 안 보임 | 0C.F14 |
| 프로젝트 사이드바 | 새 세션·▾·프로젝트별 +·…·폴더 열기·다시 연결·묶음 접기·완료됨·보관하기·대화 행·대화 메뉴·프로젝트 메뉴 항목·하단 메뉴 (shell/projects/ProjectSidebar.tsx) | data-action 없음, 하단 메뉴 플러그인·스킬·설정은 눌러도 아무 일 없음(0C.F2~F4와 같은 원인) | 0C.F15 |
| 프로젝트 고르기 카드 | 폴더 열기·최근 프로젝트·임시 작업 공간·프로젝트 고르기·닫기·맨 위 폴더로·고른 폴더 그대로 (WhereToWork.tsx) | data-action 없음, [최근 프로젝트] 비활성 이유 없음 | 0C.F15 |
| 빈 세션·확인 카드·프로젝트 설정 | 예시·최근 에이전트·확인/취소·다시 연결·저장·닫기 (EmptySession·ConfirmCard·ProjectSettings.tsx) | data-action 없음 | 0C.F15 |

고친 뒤: 화면 24개 276개 클릭 실패 0건, `eslint apps/web/src` 0건.
