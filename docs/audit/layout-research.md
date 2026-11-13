# HARNESS-X 화면 배치 연구 — "어떤 기능이 어디에 있어야 하나, 그리고 왜"

> 작성: 2026-11-13 · 범위: `apps/web/src` 전체 화면(메인·설정·설치 관리·에이전트 만들기) · 코드 수정 없음(조사·제안만)
> 함께 읽을 문서: `docs/audit/design-2026.md`(색·글꼴·모양), `docs/audit/feature-map.md`(기능 146개), `docs/audit/upgrade-research.md`(레고 빌더)
> 이 문서는 **모양(색·모서리)** 이 아니라 **자리(어느 기능이 어느 영역에 있나)** 를 다룬다. 모양은 design-2026.md가 맡는다.

---

## 0. 한눈에 보기

**한 줄 결론**: 지금 화면은 기능을 "만든 순서대로" 빈자리에 붙여 왔습니다. 그래서 **같은 일이 3~6군데에 흩어져 있고**, **자주 쓰는 것과 거의 안 쓰는 것이 같은 무게로 보입니다**. 해결 방법은 하나입니다. **"한 기능 = 한 집"** 으로 정하고, 집은 **얼마나 자주 쓰는지**에 따라 손에서 가까운 곳(입력창·채팅)부터 먼 곳(설정)까지 나눕니다.

| 숫자로 본 지금 상태 | 값 |
| --- | --- |
| 버튼·메뉴 id (registry.ts) | 180개 |
| 메인 화면에서 처음부터 보이는 조작(목록 줄 제외) | **28개** → 제안 후 **16개** (−43%) |
| 같은 일이 여러 곳에 있는 경우 | 9가지 (이어하기 6곳, 새 세션 5곳, 폴더 열기 4곳, 승인 6곳 등) |
| 탭 모양 종류 | 3가지(알약·테두리 상자·밑줄)가 7곳에 섞여 있음 |
| 화면 기호 | 유니코드·이모지 기호 40종 이상(✦ ⧉ ◇ ⬇ ⚙ ☰ ▤ ◎ ⏸ ✋ 📁 📌 📎 🕘 🔍 …) |
| 찾은 문제 | **32개** (치명 3 · 큼 13 · 보통 16) — 실제 화면 캡처 관찰 7건 포함(3.5) |

**가장 큰 문제 5개**
1. **설정·설치 관리 화면에 들어가면 대화로 돌아오는 길이 없다** (프로젝트 사이드바 모드). 세션을 눌러도 화면이 안 바뀐다 — `App.tsx:542-559` 화면 전환이 `view` 상태인데, 프로젝트 사이드바의 세션 선택(`useProjectShell.tsx:302-311`)은 `setView('chat')`을 부르지 않는다.
2. **승인이 6곳에 흩어지고, 그중 채팅 안 승인 버튼은 늘 눌리지 않는다** (`chat/BlockView.tsx:97-104` `disabled`). 초보자는 "눌러야 하는데 안 눌리는 버튼"을 먼저 보게 된다.
3. **사이드바 아래가 너무 무겁다**: 고르기 상자 5개(묶기·정렬·상태·AI·에이전트) + 메뉴 6개(그중 2개는 "준비 중" 비활성)가 늘 보인다 (`ProjectSidebar.tsx:321-400`, `shell/types.ts:77-85`).
4. **같은 설정 화면이 메뉴 두 개로 들어간다**: `[엔진]`과 `[설정]` 모두 `SettingsPage`를 연다(`App.tsx:422,546`). 테마는 상단바 버튼과 설정 > 일반(`ui.theme`) 두 곳.
5. **어려운 개발자 말이 가장 좋은 자리에 있다**: 입력창 바로 아래 "판정 대기 · 사다리"(`Composer.tsx:387-398`), 상단바의 실제 경로·`AGENTS.md`·`CLAUDE.md` 표시(`WorkspaceBar.tsx:13-31`), 패널 탭 "Diff"·"궤적"(`layout-store.ts:5-10`).

**가장 중요한 옮김 5개**
1. 설정·설치 관리를 **"따로 쓰는 페이지"** 로 바꾼다: 위에 `[← 대화로]`, 오른쪽 패널 숨김 (빌더와 같은 방식, Claude·Linear 설정과 같음).
2. 사람 확인은 **오른쪽 위 "확인이 필요해요" 한 곳**에만 답하는 버튼을 둔다. 다른 곳(채팅·사이드바·알림)은 "그 카드로 데려가기"만 한다.
3. 사이드바 필터 5개 → **`[필터]` 버튼 하나**(눌러야 펼침). 아래 메뉴 6개 → **3개**(에이전트 만들기 · 도구·AI 설치 · 설정).
4. 입력창 줄을 **`[+] [모드·권한 ▾] ……… [AI ▾] [↑/■]`** 로 정리(Claude Code 데스크톱·VS Code와 같은 배치). "판정" 줄은 오른쪽 패널 "진행" 탭으로.
5. 모든 기호를 **Lucide 선 아이콘 + 글자**로 바꾼다. 아이콘만 쓰는 곳은 8곳(보내기·정지·+·⋯·▾·닫기·되돌리기·다시)으로 제한하고 툴팁을 단다.

---

## 1. 조사 방법과 근거

- **코드**: `actions/registry.ts`(180개 id), `e2e/screens.ts`(검사 화면 34개), `shell/*`, `shell/projects/*`, `composer/*`, `chat/*`, `panels/*`, `settings/*`, `install/*`, `builder/*`, `App.tsx`, `Routes.tsx`를 읽고, `act('<id>')`가 붙은 자리를 전부 찾아 파일:줄로 지도를 만들었다.
- **설치된 디자인 스킬**: `.claude/skills/frontend-design/SKILL.md`("눈에 띄는 것은 한 곳만, 나머지는 조용히", "구조 장치는 정보를 담을 때만"), `.claude/skills/web-design-guidelines`(Vercel Web Interface Guidelines 규칙 파일)를 배치 문제에 적용했다(4장 P-20~P-24).
- **웹 조사**: 공식 문서·블로그 우선(2025~2026). 5장과 12장에 주소를 적었다. 일부 제품(Cursor 에이전트 창, Codex 앱 세부)은 공식 문서가 짧아 변경 기록·기사로 보충했고 그 경우 표에 "(기사)"로 적었다.
- **하지 않은 것**: 빌드·테스트 실행(40분 테스트가 돌고 있어 CPU 보호), 코드 수정.

---

## 2. 사용자의 주요 일과 얼마나 자주 하나

초보자(한국어, 개발자 아님)가 HARNESS-X에서 하는 일을 흐름 순서로 정리했다. "빈도"는 한 번 앉아서 쓰는 동안(약 1시간) 몇 번 하는지 추정이다.

| # | 주요 일 | 하는 동작 | 빈도 | 등급 |
| --- | --- | --- | --- | --- |
| J1 | **지시하기** | 글 쓰기·보내기, 파일 붙이기, `/에이전트` 부르기, 모드 고르기 | 10~30회 | ★★★ 매번 |
| J2 | **지켜보기** | 채팅 흐름 읽기, 진행 상태, 체크리스트, 바뀐 파일 보기 | 계속 | ★★★ 매번 |
| J3 | **확인·승인하기** | 위험한 일 허락/거절, 계획 승인, 도구 설치 허락 | 3~15회 | ★★★ 자주·급함 |
| J4 | **멈추기·이어하기** | 정지, 일시정지, 멈춘 작업 이어하기 | 0~3회 | ★★ 가끔·급함 |
| J5 | **대화·프로젝트 고르기** | 새 세션, 세션 바꾸기, 폴더 열기 | 2~10회 | ★★ 자주 |
| J6 | **도구·AI 준비** | AI 로그인, 엔진 찾기, 도구 설치 | 처음 + 주 1회 | ★ 가끔 |
| J7 | **에이전트 만들기** | 빌더에서 블록 조립·저장·시험 | 주 1~2회 | ★ 가끔(한 번 들어가면 오래) |
| J8 | **설정** | 테마, 한도, 키, 데이터 정리 | 월 1~2회 | ☆ 드묾 |

**배치 규칙(빈도 → 거리)**

| 등급 | 집 | 클릭 수 목표 |
| --- | --- | --- |
| ★★★ 매번 | 입력창·채팅·오른쪽 위 확인 영역 | 0~1번 |
| ★★ 자주 | 사이드바 위쪽, 상단바, 세션 줄 `⋯` 메뉴 | 1~2번 |
| ★ 가끔 | 사이드바 맨 아래 메뉴 → 따로 쓰는 페이지 | 2~3번 |
| ☆ 드묾 | 설정 안 탭, `고급 설정 보기` 뒤 | 3번 이상 괜찮음 |

근거: 자주 쓰는 것은 가깝고 크게(피츠의 법칙 — 목표가 멀고 작을수록 누르기 어렵다, NN/g), 드문 것은 다음 화면으로 미룬다(점진적 공개 — 고급·드문 기능은 두 번째 화면으로, NN/g). Apple HIG도 "툴바는 자주 쓰는 명령 자리"라고 한다.

---

## 3. 지금 배치 지도

### 3.1 메인 화면 영역 구성 (지금)

```
┌ 상단바 hx-topbar (TopBar.tsx:19-38) ─────────────────────────────────────────────┐
│ [☰좁을때] 프로젝트이름 C:\실제\경로 ⎇main AGENTS.md CLAUDE.md │●실행 중│ ▮▮쿼터 │[■전체 정지]│[◐]│[▤좁을때]│
└──────────────────────────────────────────────────────────────────────────────┘
┌ 사이드바 (ProjectSidebar.tsx) ┬ 가운데 (App.tsx:560-650) ──────┬ 오른쪽 패널 (RightPanel.tsx) ┐
│ [+ 새 세션][▾]                │ [자세히|보통|요약]  ChatStream:67 │ ✋ 확인이 필요해요 (카드들)  │
│ 🔍 세션·프로젝트 찾기          │ (빈 세션: 예시 3개·에이전트 3개) │  (없으면 안 보임)            │
│ 프로젝트        [폴더 열기]    │ 채팅 흐름                        │ [체크리스트|Diff|터미널|궤적] │
│ ▸ 프로젝트A  [+][⋯]           │  · 승인 요청 블록(버튼 비활성)   │  (끌어서 순서 바꾸기)         │
│   ● 세션1 [⋯]                 │  · 작은 확인 카드                │                               │
│ (30일 지난 세션 보관 안내)     │ 이어하기 카드·점검 카드          │                               │
│ 묶기[▾] 정렬[▾] 필터[▾]       │ ┌ 입력창 ─────────────────────┐  │                               │
│ [모든 AI▾] [모든 에이전트▾]    │ │ (글 쓰는 칸)                  │  │                               │
│ ✦에이전트 만들기 ⧉플러그인(×) │ │[+][◎권한▾][모드▾]   [AI▾][↑] │  │                               │
│ ◇스킬(×) ⬇설치 관리 ⚙엔진 ☰설정│ │ 판정 대기                     │  │                               │
└───────────────────────────────┴─┴──────────────────────────────┴─┴───────────────────────────────┘
(×) = "준비 중" 비활성
```

설정·설치 관리를 누르면 **가운데만** 바뀌고, 사이드바와 오른쪽 패널(체크리스트·Diff…)은 그대로 남는다(`AppShell.tsx:137`은 화면 종류와 상관없이 패널을 그린다).

### 3.2 기능별 현재 위치·클릭 수·빈도

"클릭 수" = 메인 화면 첫 상태에서 그 일이 끝날 때까지 누르는 횟수. 빈도 등급은 2장 표.

| 일 | 기능 | action id | 지금 위치 (파일:줄) | 클릭 | 빈도 | 판정 |
| --- | --- | --- | --- | --- | --- | --- |
| J1 | 보내기 | `composer.send` | 입력창 오른쪽 아래 `Composer.tsx:350` | 0(Enter) | ★★★ | 좋음 |
| J1 | 파일 붙이기 | `plus.attach`, `composer.attach-pick` | `+` 메뉴 3번째 `PlusMenu.tsx:136`, 모바일 `Composer.tsx:334` | 2 (끌어 놓기 0) | ★★ | 괜찮음 |
| J1 | 권한 고르기 | `composer.chip`·`chip-option` | 입력창 칩 `Composer.tsx:308-321` | 2 | ★ | 자주 안 바꾸는데 늘 보임 |
| J1 | 모드 고르기(계획·일반·오토) | 같음 | `Composer.tsx:322-329` | 2 | ★★ | 좋음 |
| J1 | AI(모델) 고르기 | `model.open`·`model.choose`·`model.scope` | 입력창 오른쪽 `engines/ModelButton.tsx:78-153` | 2~3 | ★★ | 좋음 |
| J1 | 에이전트 부르기 | (슬래시 팔레트) `composer.clear-agent` | 입력창에 `/` | 1 | ★★ | 좋음 |
| J1 | 예시 지시 채우기 | `empty.example`, `empty.agent` | 빈 세션 `EmptySession.tsx:52,62` | 1 | ★ 처음 | 좋음 |
| J2 | 보기 모드 | `chat.mode` | 채팅 맨 위 `ChatStream.tsx:67` | 1 | ☆ | 드문데 매번 보임 |
| J2 | 도구 카드 펼치기 | `chat.tool-toggle` | 채팅 `ToolCard.tsx:47` | 1 | ★★ | 좋음 |
| J2 | 바뀐 파일 보기 | `chat.open-diff`, `panel.tab` | 채팅 블록 `BlockView.tsx:146` → 오른쪽 "Diff" | 1 | ★★ | 탭 이름 어려움 |
| J2 | 체크리스트 | `checklist.toggle` | 오른쪽 탭 1번 `ChecklistTree.tsx:121` | 1 | ★★★ | 좋음 |
| J2 | 터미널 | `panel.tab`, `terminal.login` | 오른쪽 탭 3번 `TerminalPanel.tsx:115` | 1 | ★ | 좋음 |
| J2 | 궤적(기록) | `panel.tab` | 오른쪽 탭 4번 | 1 | ☆ | 이름 어려움 |
| J2 | 실행 상태 | (표시) | 상단바 `TopBar.tsx:22-29` | 0 | ★★★ | 어느 세션 상태인지 불분명 |
| J2 | 판정 결과 | (표시) | 입력창 아래 `Composer.tsx:387-398` | 0 | ☆ | 개발자 말, 자리 낭비 |
| J2 | 쿼터 | (표시) | 상단바 `TopBar.tsx:30-34` | 0 | ★ | 괜찮음 |
| J3 | 승인 카드 답하기 | `approvals.choose`·`more`·`undo` | 오른쪽 패널 맨 위 `ApprovalsArea.tsx:94-145`, 좁으면 아래 `AppShell.tsx:139` | 1 | ★★★ | **좋은 집** |
| J3 | 알림 → 카드로 | `approvals.toast` | 화면 구석 `Toasts.tsx:26` | 1 | ★★ | 좋음 |
| J3 | 작은 확인 카드 | `approvals.mini-open` | 채팅 `MiniApprovalCard.tsx:12` | 1(→패널) | ★★ | 좋음(데려가기) |
| J3 | 채팅 승인 버튼 | `chat.approval-option` | 채팅 `BlockView.tsx:97` **항상 비활성** | — | — | **문제** |
| J3 | 단계 확인 | `checklist.decide` | 체크리스트 탭 안 `Checklist/ApprovalCard.tsx:33` | 1~2 | ★★ | 승인이 두 집 |
| J3 | 계획 승인 | `checklist.approve-plan`, `run-mode.plan-choose` | 체크리스트 `PlanReview.tsx:48`, 채팅 `PlanDoneCard.tsx:54` | 1~2 | ★★ | 두 집 |
| J3 | 도구 설치 허락 | `install.*` 카드, `toolpicker.source-link` | 확인 영역(같은 곳) `App.tsx:452-497` | 1 | ★ | 좋음 |
| J4 | 정지 | `composer.stop`→`stop-pause`/`stop-now` | 보내기 자리 `StopButton.tsx:55-84` | 2 (Esc 2번) | ★★ | 좋음 |
| J4 | 전체 정지 | `shell.stop-all` | 상단바(실행 2개 이상일 때만) `StopAllButton.tsx:14` | 1 | ★ | 좋음 |
| J4 | 이어하기 | `recovery.resume`, `resume.*`, 세션 `⋯ > 이어하기`, 멈춘 줄 클릭, `/resume` | 6곳 (3.3 표) | 1~2 | ★★ | 흩어짐 |
| J5 | 새 세션 | `projects.new-session`, `projects.pick-new`, `projects.new-in-project` | 사이드바 맨 위 `ProjectSidebar.tsx:172-221`, 프로젝트 줄 `+` `:525`, 프로젝트 `⋯` `:624`, Ctrl+N | 1 | ★★ | 좋음(지름길 많음) |
| J5 | 세션 고르기 | `conversation.select` | 사이드바 `ProjectSidebar.tsx:689` | 1 | ★★ | 좋음 |
| J5 | 세션 이름·보관·삭제 | `conversation.menu`·`menu-item` | 줄 `⋯` `ProjectSidebar.tsx:720-741` | 2 | ★ | 좋음 |
| J5 | 프로젝트 메뉴 | `projects.menu`·`menu-item` | 프로젝트 줄 `⋯` `ProjectSidebar.tsx:536, 622-631` | 2 | ★ | 좋음 |
| J5 | 폴더 열기 | `projects.open-folder`, `plus.open-folder`, `where.open-folder` | 4곳 (3.3 표) | 1~2 | ★ | 흩어짐 |
| J5 | 찾기 | (input) | 사이드바 `ProjectSidebar.tsx:223-230` | 0 | ★ | 좋음 |
| J5 | 묶기·정렬·필터 5종 | (select 5개) | 사이드바 아래 `ProjectSidebar.tsx:321-383` | 1 | ☆ | **드문데 늘 보임** |
| J5 | 오래된 세션 보관 | `projects.archive-stale` | 사이드바 안내줄 `:312` | 1 | ☆ | 괜찮음(조건부) |
| J6 | 엔진 설정 | `nav.engines` → `engines.*` | 사이드바 메뉴 → 설정 AI 탭 `App.tsx:422,546` | 2~4 | ★ | 설정과 중복 |
| J6 | AI 로그인 | `model.login`, `terminal.login` | 모델 메뉴, 터미널 탭 | 2~3 | ★ 처음 | 좋음 |
| J6 | 엔진 찾기 말풍선 | `scan.open-install`, `scan.dismiss` | 채팅 가운데 `ScanBubble.tsx:56` | 1 | ★ 처음 | 좋음 |
| J6 | 설치 관리 | `nav.install` → `install.*` | 사이드바 메뉴 → 가운데 페이지 `InstallManager.tsx` | 1~3 | ★ | 괜찮음(이름 바꿈 제안) |
| J6 | 플러그인·스킬 | `nav.plugins`, `nav.skills` | 사이드바 메뉴(비활성) `types.ts:79-80` | — | — | **죽은 버튼이 명당에** |
| J7 | 에이전트 만들기 | `nav.agent-builder` → `builder.*` | 사이드바 메뉴 → `#/builder/new` | 1 | ★ | 좋음 |
| J8 | 설정 | `nav.settings` → `settings.*` | 사이드바 메뉴 → 가운데 13개 탭 | 1~3 | ☆ | 탭 많음 |
| J8 | 테마 | `topbar.theme` | 상단바 `ThemeToggle.tsx` + 설정 일반 `ui.theme` | 1 | ☆ | 중복, 명당 차지 |
| J8 | 프로젝트 설정 | `settings.project-*`, `project-settings.*` | 프로젝트 `⋯` + 설정 > 프로젝트 탭 `ProjectsSection.tsx:39-81` | 2~3 | ☆ | 중복(같은 동작이라 허용) |

### 3.3 같은 일이 여러 곳에 있는 경우

| 일 | 들어가는 곳 | 수 | 판단 |
| --- | --- | --- | --- |
| 이어하기 | ① 이어서 하기 카드 `ResumeCard.tsx:55` ② 프로젝트 열 때 카드 `ProjectResumeCard.tsx:56` ③ 빈 세션 "이어서 할 작업 N개" `resume-entry.tsx:38` ④ 세션 `⋯ > 이어하기` `ProjectSidebar.tsx:733` ⑤ 멈춘(⏸) 줄 클릭 `useProjectShell.tsx:308-310` ⑥ `/resume` `App.tsx:403` | 6 | 입구는 많아도 되지만 **도착지는 하나**(ResumeFlow)여야 함 — 지금도 하나라 OK. 다만 ①②③ 카드 모양이 서로 다름 → 한 카드로 통일 |
| 새 세션 | 맨 위 버튼, `▾` 메뉴, 프로젝트 줄 `+`, 프로젝트 `⋯ > 새 세션`, Ctrl+N, `/new` | 6 | 지름길이라 유지. 단 프로젝트 줄 `+`와 `⋯ > 새 세션`은 같은 일 — `⋯`에서 빼도 됨 |
| 폴더 열기 | 사이드바 `▾` 메뉴 `:213`, 사이드바 "프로젝트" 머리 `:233`, `+` 메뉴 `PlusMenu.tsx:110`, "어디서 작업할까요?" 카드 `WhereToWork.tsx:27` | 4 | `+` 메뉴의 "폴더 열기·최근 프로젝트"는 Codex·Claude처럼 **입력창 아래 "어디서" 자리**로 보내거나 유지, 사이드바 머리 버튼은 목록 아래로 |
| 승인 | 확인 영역, 알림, 사이드바 배지, 채팅 작은 카드, 채팅 승인 블록(비활성), 체크리스트 단계 확인, 계획 승인 2곳 | 7 | **답하는 곳은 하나(확인 영역)**, 나머지는 "데려가기" |
| 엔진·AI | 입력창 AI 버튼, 사이드바 `[엔진]`, 설정 > AI·엔진, 엔진 찾기 말풍선, 터미널 로그인, 상단바 쿼터 | 6 | `[엔진]` 메뉴 제거 → AI 버튼 메뉴 맨 아래 "AI 관리…"(같은 id `nav.engines`) |
| 설정 화면 | `[엔진]`(AI 탭으로), `[설정]`(일반 탭으로) | 2 | 하나로 |
| 테마 | 상단바 버튼, 설정 > 일반 `ui.theme` | 2 | 설정으로 |
| 도구 설치 | `[설치 관리]`, 설정 > 도구·설치 탭, 엔진 말풍선, 도구 고르기 카드, 빌더 빈칸 | 5 | 설치 페이지가 집, 설정 탭은 "설치 방식" 설정만 — 설정 탭 안에 "설치 관리 열기" 연결 |
| 저장(빌더) | 위쪽 저장줄 `BuilderPage.tsx:233`(초안 있을 때), 속성 창 SaveBar `SaveBar.tsx:110`(초안 없을 때) | 2 | 상황에 따라 저장 버튼 자리가 바뀜 → 위쪽 바 오른쪽 한 곳 |

### 3.4 처음 보이는 선택지 수 (지금)

목록 줄(프로젝트·세션)은 사람마다 달라 뺐다. "선택지" = 누르거나 고를 수 있는 것.

| 화면 | 영역 | 지금 | 비고 |
| --- | --- | --- | --- |
| 메인(넓은 화면) | 상단바 | 1 (테마) + 조건부 전체 정지 | 글자 표시 5개(이름·경로·브랜치·AGENTS.md·CLAUDE.md) |
| | 사이드바 | 15 (새 세션·▾·찾기·폴더 열기·select 5·메뉴 6) | 메뉴 2개는 비활성 |
| | 가운데 | 3 (보기 모드) + 입력창 5 (+·권한·모드·AI·보내기) | + 판정 글자 |
| | 오른쪽 | 4 탭 | |
| | **합계** | **28** | |
| 빈 세션 | 가운데 | 위 + 예시 3 + 에이전트 최대 3 | |
| 설정 | | 검색·고급 보기·탭 13 = **15** + 사이드바 15 + 패널 4 = **34** | 대화로 돌아가는 버튼 없음 |
| 설치 관리 | | 탭 4 + 탭 안 + 사이드바 15 + 패널 4 = **23+** | |
| 빌더 | 위쪽 | 대화로·되돌리기·다시·저장 = 4, 만들기 방식 탭 2, 서랍 탭 n, 속성 탭 3 | 저장 자리 바뀜 |

### 3.5 실제 화면 관찰 (headless Chromium 캡처, 처음 켠 빈 상태)

캡처 파일: `/tmp/claude-1000/-mnt-c-agentCli/43d75921-4a97-453e-b804-b4702c037887/scratchpad/shots/before-desk.png`(1440×900), `/tmp/claude-1000/-mnt-c-agentCli/43d75921-4a97-453e-b804-b4702c037887/scratchpad/shots/before-phone.png`(390×844). 이 문서를 쓰며 두 그림을 직접 열어 확인했다.

| # | 본 것 | 연결된 문제 |
| --- | --- | --- |
| S-1 | 사이드바: 세션 0개인데 묶기·정렬·필터(전체·모든 AI)·모든 에이전트 **select 5개가 늘 펼쳐짐**. 검색칸 앞 아이콘과 "플러그인" 앞 기호가 **□로 깨짐** | P-05, P-27 |
| S-2 | 하단 메뉴 6개가 **같은 무게**로 나열. 플러그인·스킬은 회색인데 **이유가 화면에 안 보임**(툴팁뿐). 설치 관리·엔진·설정은 모두 "설정 계열"이라 겹침 | P-06, P-07 |
| S-3 | 상단바 왼쪽 "프로젝트를 선택하세요" 흐린 글자뿐, 오른쪽엔 "● 대기"와 테마 버튼만 — 상단바가 정보도 행동도 거의 없음. 가장 진한 덩어리는 사이드바의 파란 `[+ 새 세션]`인데, 프로젝트가 없으면 이것보다 "폴더 열기"가 먼저여야 함 | P-08, P-10, P-29 |
| S-4 | 가운데 위 "자세히·보통·요약" + "블록 0개"가 빈 대화에서 먼저 보임. 빈 상태 문구는 작고 다음 행동이 없음. 가운데 약 600px 높이가 비어 있음 | P-16, P-28, P-30 |
| S-5 | 오른쪽 탭 "체크리스트·**Diff**·터미널·**궤적**" — 영어·전문 용어 섞임. 빈 상태 "아직 체크리스트가 없습니다"만 | P-12, P-24 |
| S-6 | 입력창 칩 "◎ 워크스페이스 쓰기", "일반", "claude-code · sonnet", 아래 "판정 대기" — 워크스페이스·판정은 초보자가 모르는 말. 크기 조절 손잡이 보임 | P-09, P-17, P-31 |
| S-7 | 휴대폰: 상단 ☰·◐·▤ 아이콘만. 입력창 칩 3개(워크스페이스 쓰기·일반·claude-code · sonnet)가 줄을 꽉 채움 | P-32 |

**처음 켠 화면에 대한 추가 제안 (P-28·S-3 해결)**: 프로젝트가 0개면 가운데에 "어디서 작업할까요?" 카드(`WhereToWork`, `where.*` id 그대로)를 바로 보여 주고, 그 아래 예시 지시 3개(`empty.example`)를 둔다. 사이드바 파란 강조는 `[폴더 열기]`로 옮기고 `[+ 새 세션]`은 보조 모양으로(프로젝트가 생기면 다시 주 버튼). Claude Code도 첫 메시지 전에 "프로젝트 폴더"를 입력창 아래에서 고르게 한다(5.1 ⑦). 상단바 "프로젝트를 선택하세요"는 `[📁 프로젝트 고르기 ▾]` 버튼으로 바꿔 같은 카드를 연다(새 id `topbar.project` 제안).

---

## 4. 문제 목록

심각도: **치명**(길을 잃거나 잘못 누름) · **큼**(헷갈림·시간 낭비) · **보통**(정리하면 좋음).

| # | 심각도 | 문제 | 근거(파일:줄) | 어긋난 원칙 |
| --- | --- | --- | --- | --- |
| P-01 | 치명 | 프로젝트 사이드바 모드에서 설정·설치 관리에 들어가면 **대화로 돌아올 길이 없음**. 세션 클릭·새 세션이 `view`를 바꾸지 않음(예전 사이드바만 `setView('chat')`) | `App.tsx:137,534,542-559`, `useProjectShell.tsx:302-311,479-501` | Nielsen #3 사용자 통제·자유(비상구) — **실제 화면에서 재현 확인 필요** |
| P-02 | 치명 | 채팅 안 승인 요청 버튼이 **항상 비활성**인데 승인처럼 생김 | `chat/BlockView.tsx:97-104` | Nielsen #1 상태 보이기, HITL "답하는 곳 하나" |
| P-03 | 치명 | 설정·설치 화면에서도 오른쪽 패널(체크리스트·Diff·터미널)과 세션 필터가 그대로 남아 **지금 어디 있는지** 헷갈림 | `AppShell.tsx:131-155` | Nielsen #6 기억보다 알아보기, 한 화면 한 목적 |
| P-04 | 큼 | 승인이 7곳(3.3) — 체크리스트 단계 확인·계획 승인이 확인 영역 밖에 있음 | `Checklist/ApprovalCard.tsx:33`, `PlanReview.tsx:48`, `PlanDoneCard.tsx:54` | HITL: 기다리는 결정은 한 줄로 |
| P-05 | 큼 | 사이드바 아래 select 5개가 늘 보임(드문 기능이 명당) | `ProjectSidebar.tsx:321-383` | 점진적 공개, 빈도 배치 |
| P-06 | 큼 | "준비 중" 비활성 메뉴 2개(플러그인·스킬)가 주 메뉴에 | `shell/types.ts:79-80`, `Sidebar.tsx:104` | registry.ts:272 "숨기거나 비활성" 중 숨김이 초보자에게 낫다 |
| P-07 | 큼 | `[엔진]`과 `[설정]`이 같은 화면 | `App.tsx:417-423, 546` | 일관성(Nielsen #4) |
| P-08 | 큼 | 테마 버튼이 상단바 명당 + 설정에도 있음 | `TopBar.tsx:36`, `settings registry ui.theme :322` | 빈도 배치 |
| P-09 | 큼 | 입력창 아래 "판정 대기 · 사다리 N번째 칸" — 초보자가 모르는 말, 매번 보임 | `Composer.tsx:387-398` | 쉬운 말, 점진적 공개 |
| P-10 | 큼 | 상단바에 실제 경로·`AGENTS.md`·`CLAUDE.md`·브랜치 — 개발자 정보가 1순위 자리 | `WorkspaceBar.tsx:13-31` | 초보자 기준 정보 우선순위 |
| P-11 | 큼 | 상단바 "실행 중"은 전체 상태인데 정지 버튼은 보고 있는 세션용 → 무엇이 실행 중인지 연결 안 됨 | `TopBar.tsx:22-29`, `App.tsx:662-674` | 상태와 조작은 붙어 있어야 |
| P-12 | 큼 | 패널 탭 이름 "Diff"·"궤적" | `layout-store.ts:5-10` | 쉬운 말 |
| P-13 | 큼 | 설정 탭 13개가 가로 한 줄 — 처음 보는 사람이 고를 수 없음 | `kernel settings/registry.ts:21-35`, `SettingsScreen.tsx:109-125` | 7±2·묶음 |
| P-14 | 큼 | 빌더 저장 버튼 자리가 상황마다 바뀜(위쪽 줄 ↔ 속성 창) | `BuilderPage.tsx:229-245`, `inspector/SaveBar.tsx:110` | 일관성, 위치 기억 |
| P-15 | 보통 | 탭 모양 3종이 7곳에 섞임(알약 `shell.css:366` · 테두리 상자 `settings-screen.css:53` · 밑줄 `install.css:23`, `builder.css:137,456`, `chat.css:16`) | 같음 | 일관성 |
| P-16 | 보통 | 보기 모드(자세히·보통·요약)가 채팅 맨 위에 늘 3칸 | `ChatStream.tsx:19-37,67` | 드문 기능 |
| P-17 | 보통 | 권한 칩과 모드 칩이 따로 — 서로 연결된 설정인데(모드 바꾸면 권한 확인 `Composer.tsx:363-386`) 두 번 골라야 | `Composer.tsx:306-331` | 관련된 것은 함께 |
| P-18 | 보통 | `+` 메뉴에 "프로젝트 폴더 열기·최근 프로젝트"(어디서 일할지)와 "파일 첨부"(무엇을 줄지)가 섞임 | `PlusMenu.tsx:109-147` | 묶음 기준 하나 |
| P-19 | 보통 | 이어하기 카드 3종 모양이 다름 | `ResumeCard`, `ProjectResumeCard`, `resume-entry` | 일관성 |
| P-20 | 보통 | 화면 상태가 주소에 없음 — 설정·설치는 `useState`, 빌더만 `#/builder` | `App.tsx:137`, `router.ts` | WIG "URL reflects state", "Links use `<a>`" |
| P-21 | 보통 | 사이드바 메뉴가 `role="menu"`·`menuitem` — 화면 이동인데 메뉴 역할 | `Sidebar.tsx:96-111`, `ProjectSidebar.tsx:385-400` | WIG "`<a>` for navigation", 화면 읽기 프로그램 |
| P-22 | 보통 | 기호·이모지 아이콘 40종 이상, 글꼴마다 크기·색이 다름 | 8.3 표 | design-2026 D6, WIG "Decorative icons aria-hidden" |
| P-23 | 보통 | 좁은 화면 사이드바 시트에 필터 5개까지 다 들어옴 | `AppShell.tsx:171` | 모바일 단순화 |
| P-24 | 보통 | 오른쪽 패널 빈 탭 문구 "OO 내용이 여기에 표시됩니다" — 무엇을 하면 채워지는지 안 알려 줌 | `RightPanel.tsx:97` | WIG "Handle empty states" |
| P-25 | 보통 | 빌더 속성 창 "YAML 보기"가 초보자 기본 탭 줄에 | `inspector/InspectorPanel.tsx:14-18` | 점진적 공개 |
| P-26 | 보통 | 프로젝트 `⋯` 메뉴 8개 항목 중 "새 세션"은 줄의 `+`와 같음, "탐색기에서 열기·폴더 다시 연결·다른 폴더로 옮기기"는 드묾 | `ProjectSidebar.tsx:622-631` | 메뉴 길이 |
| P-27 | 큼 | **글꼴에 없는 기호가 네모(□)로 깨짐**: 검색칸 앞 🔍, 메뉴 "플러그인" 앞 ⧉ (캡처 S-1) | `ProjectSidebar.tsx:232`, `shell/types.ts:79` | design-2026 D6, 상용 품질 |
| P-28 | 큼 | **처음 켰을 때(프로젝트 0개) 가운데가 텅 빔**: "아직 메시지가 없습니다…" 작은 회색 글자뿐, 폴더 고르기·예시 같은 다음 행동이 없음. 예시가 있는 빈 세션 화면(`EmptySession`)은 프로젝트가 있어야만 나옴 (캡처 S-4) | `ChatStream.tsx:82`, `EmptySession.tsx:41-71` | WIG "빈 상태 처리", NN/g 첫 사용 |
| P-29 | 보통 | 상단바 "프로젝트를 선택하세요"가 흐린 글자뿐 — 누를 수 있는지 모름(실제로 눌러도 아무 일 없음) (캡처 S-3) | `WorkspaceBar.tsx:33` | Nielsen #6 알아보기 |
| P-30 | 보통 | 채팅 머리 "블록 0개" — 개발자 숫자, 빈 대화에서 의미 없음 (캡처 S-4) | `ChatStream.tsx:69` | 쉬운 말 |
| P-31 | 보통 | 입력창 오른쪽 아래 **크기 조절 손잡이**가 보임(자동 높이인데 손잡이까지) (캡처 S-6) | `composer.css:28` `resize: vertical` | 상용 품질 |
| P-32 | 보통 | 휴대폰 상단에 ☰·◐·▤ **아이콘만** 3개 — 뜻 불명. 입력창 칩 3개가 한 줄을 꽉 채워 글자가 잘릴 위험 (캡처 S-7) | `AppShell.tsx:86-127`, `ThemeToggle.tsx`, `composer.css:81-93` | 아이콘만 규칙(8.1), Material 3 |

---

## 5. IDE·에이전트 앱 패널 컨셉 비교

### 5.1 제품별 정리

**① VS Code (+ Copilot 에이전트)**
- 영역: 맨 왼쪽 **Activity Bar**(보기 바꾸기 아이콘 줄) → **Primary Side Bar**(탐색기 등) → 가운데 **편집기** → 아래 **Panel**(출력·오류·터미널) → 오른쪽 **Secondary Side Bar**("기본으로 Chat 보기가 들어 있다") → 맨 아래 상태 줄.
- 세션 목록: 2026 **Agents 창**(미리 보기) 왼쪽 Primary Side Bar에 여러 프로젝트에 걸친 세션 목록, 맨 위 "New Session"(Ctrl+N). 목록에 "상태와 바뀐 양"이 보임.
- 승인: 대화 안 **도구 확인 창** — 도구 이름·입력값을 보여 주고 "Allow Once"(기본) / "이 세션 동안" / "Always Allow". 권한 단계(Manual·Assisted·Allow all)는 **입력창 도구줄의 권한 고르기**.
- diff·터미널·계획: Agents 창 오른쪽 Secondary Side Bar에 **Changes**(Branch·Uncommitted·Session·Last Turn 보기)·Files·Browser. 터미널은 아래 Panel.
- 초보자: 좋음 — 영역 이름이 분명하고 권한 고르기가 입력창에 있음. 나쁨 — 아이콘만 있는 Activity Bar, 영역 5개가 처음엔 많음.
- 출처: https://code.visualstudio.com/docs/getstarted/userinterface · https://code.visualstudio.com/docs/agents/run/agents-window · https://code.visualstudio.com/docs/agents/approvals · https://code.visualstudio.com/docs/agents/run/sessions/manage-sessions

**② Cursor 3 (Agents 창 / 에이전트 레이아웃)**
- 영역: 왼쪽 **작업 공간·에이전트 목록**, 가운데 에이전트 대화, 오른쪽 패널(파일 트리·리뷰). 3.1에서 **타일 배치**(에이전트 여러 개를 칸으로 나눠 보기, 배치 기억), 3.4에서 오른쪽 패널 **전체 화면**.
- 세션 목록: 왼쪽, 저장소를 가로질러 에이전트 나열.
- 승인: 대화 안(IDE 방식과 같음). 공식 문서에 Agents 창 승인 세부는 없음.
- diff: 오른쪽 리뷰 보기 — 사용자들은 "IDE의 덩어리별 리뷰만큼은 아직 아님"이라 함(포럼).
- 초보자: 좋음 — "에이전트 먼저" 화면이라 코드 편집기를 몰라도 됨. 나쁨 — 업데이트마다 배치가 바뀌어 포럼 불만이 많음(**배치를 자주 바꾸지 말 것**의 반면교사).
- 출처: https://cursor.com/changelog/3-0 · https://cursor.com/changelog/3-1 · https://www.cursor.com/changelog/3-4 · https://forum.cursor.com/t/agent-sidebar-moved-to-the-left-after-latest-update/169390 (포럼) · https://the-decoder.com/new-cursor-3-ditches-the-classic-ide-layout-for-an-agent-first-interface-built-around-parallel-ai-fleets/ (기사)

**③ Zed (Agent Panel · dock 구조)**
- 영역: 왼쪽·오른쪽·아래 **dock** 세 자리에 패널을 끼움. Agent Panel은 설정으로 left/right/bottom 중 고름.
- 세션 목록: **Threads 사이드바**(Ctrl+Alt+J) — 프로젝트별로 묶고, 전체 기록은 시간순, 보관한 것 되살리기.
- 승인: 도구 권한(`tool_permissions`: 기본·항상 허용·항상 거절)으로 "허용·거절·확인"을 정함.
- diff: 에이전트가 바꾼 뒤 **"파일 n개·줄 n개 바뀜" 접이식 요약이 입력창 바로 위**, "Review Changes"를 누르면 덩어리별 수락·거절 탭. 모델 고르기는 **입력창 위**.
- 초보자: 좋음 — 바뀐 양 요약이 입력창 옆에 있어 놓치지 않음. 나쁨 — 설정이 글(JSON) 위주.
- 출처: https://zed.dev/docs/ai/agent-panel

**④ JetBrains (새 UI · AI Assistant · Junie)**
- 영역: 새 UI는 왼쪽·오른쪽 **도구 창 막대**(아이콘), 가운데 편집기. AI Chat 도구 창은 **오른쪽 막대**에서 연다.
- 세션 목록: 채팅 창 안 **Chat History 버튼**(목록은 숨겨 둠), 옵션 버튼에 이름 바꾸기·삭제·설정.
- 승인: Junie는 터미널 명령·MCP 도구 등 "민감한 동작"마다 기본으로 묻는다. 실행 중에 그 동작 옆 **More actions → 허용 목록에 추가**. 다 묻지 않는 "Brave 모드"는 "권장하지 않음".
- 계획: **Plan 모드** — 계획을 만들고 승인을 기다린 뒤 실행. 모드 고르기는 **입력창(prompt window) 안**.
- 초보자: 좋음 — 승인한 동작 바로 옆에서 "다음부터 묻지 않기"를 고를 수 있음. 나쁨 — 도구 창 아이콘이 많음.
- 출처: https://www.jetbrains.com/help/ai-assistant/junie-agent.html · https://www.jetbrains.com/help/ai-assistant/2025.3/ai-chat.html · https://www.jetbrains.com.cn/en-us/help/junie/user-approval.html · https://blog.jetbrains.com/junie/2025/05/what-s-next-for-junie-building-a-smart-and-controllable-ai-coding-agent/

**⑤ Windsurf (Cascade 패널, 현재 Devin Desktop로 이름 바뀜)**
- 영역: 편집기 오른쪽 Cascade 패널.
- 모델·계획: **모델 고르기는 입력창 아래 메뉴**, Planning 모드 켜기도 **입력창 아래 버튼**. 할 일 목록(Todo)은 **대화 안**에 생김.
- 승인·설정: 터미널 명령 자동 실행 여부는 **설정 패널**에서. Memories 패널(규칙·워크플로·기억)이 따로.
- 초보자: 좋음 — 입력창 아래에 고를 것을 모음. 나쁨 — 할 일 목록이 대화에 섞여 스크롤하면 사라짐.
- 출처: https://docs.windsurf.com/windsurf/cascade/cascade · https://docs.devin.ai/windsurf/plugins/cascade/planning-mode · https://windsurf.com/changelog

**⑥ Warp (Agent Mode)**
- 영역: 터미널 블록 중심. **에이전트 관리 패널은 오른쪽 위 프로필 옆** — 로컬·클라우드 실행 중인 에이전트를 모두 모음.
- 승인: 기본은 **파일을 고칠 때마다 diff를 보여 주고 묻기**. 자동 승인은 대화마다 꺼진 채 시작, 관리자 금지 목록은 자동 승인이어도 항상 물음.
- diff: 덩어리별 diff 보기 + **Code Review 패널**(줄마다 의견을 달아 한꺼번에 에이전트에게 보냄).
- 초보자: 좋음 — "실행 중인 에이전트 전부"를 한 버튼에서 봄, 자동 승인이 기본 꺼짐. 나쁨 — 터미널 중심이라 낯섦.
- 출처: https://docs.warp.dev/agents/getting-started/agents-in-warp.md · https://docs.warp.dev/agents/local-agents/code-diffs/ · https://docs.warp.dev/agents/local-agents/interactive-code-review/ · https://docs.warp.dev/agents/autonomy/agent-permissions

**⑦ Claude Code 데스크톱/웹 (2026-04 새 디자인)**
- 영역: 왼쪽 **세션 사이드바**(+ New, Ctrl+N), 가운데 대화, 끌어서 배치하는 칸(터미널·미리보기·**Changes(diff)**·Files), 오른쪽 **세션 상세 레일**(Changes·Context·Environment 카드).
- 세션 목록: 상태·프로젝트·환경으로 **필터**, 프로젝트로 **묶기** — 필터·묶기는 **머리글에 마우스를 올리면 나오는 아이콘** 뒤에 숨김. 보관한 세션은 "View all > Archived". PR이 닫히면 자동 보관.
- 승인: Manual 모드에서 파일 수정·명령 전에 묻고 **diff를 보여 주며 하나씩 수락·거절**. 브라우저 동작은 "Allow once / Always allow / Deny" 카드. 보기 모드 3가지(Verbose·Normal·Summary).
- 시작 설정: **입력창 아래 한 줄**에 환경·프로젝트 폴더·**모드(권한) 고르기**·모델 고르기(오른쪽 끝). `+` 버튼에 첨부·스킬·커넥터·플러그인.
- 설정·플러그인: 사이드바 **Customize**에서 커넥터·스킬·플러그인 관리, 설정은 Settings > Claude Code.
- 정지: 정지 버튼 또는 Esc. 다른 세션이 끝나면 OS 알림. 사이드바 점 색으로 "입력 필요" 표시(사용자 이슈에 "점이 안 지워진다"는 불만 다수 — **확인 필요 표시는 답하면 꼭 사라지게**).
- 출처: https://code.claude.com/docs/en/desktop · https://claude.com/blog/claude-code-desktop-redesign · https://macrumors.com/2026/04/15/anthropic-rebuilds-claude-code-desktop-app (기사) · https://claudeissues.com/issue/61421-desktop-no-way-to-dismiss-needs-my-input-indicator-on-a-finished-session (이슈)

**⑧ OpenAI Codex 앱 (2026-07부터 ChatGPT 데스크톱에 합쳐짐)**
- 영역: 왼쪽 사이드바(New chat·고정·**Projects**·최근), 가운데 대화, 오른쪽 **diff(Review) 패널**(Cmd+Option+B), 대화 아래 **터미널 서랍**(Cmd+J, 오른쪽 위 터미널 아이콘).
- Review 패널: "Codex가 바꾼 것 / **마지막 턴에서 바뀐 것**" 전환, 스테이지·되돌리기, `/review` 의견이 줄 옆에 붙음.
- `+` 메뉴: 파일·폴더, 크롬 붙이기, **Goal**, **Plan mode 켜기**. 위쪽에 Chat ↔ Work 전환.
- 승인: 별도 "에이전트 승인·보안" 문서로 설정(화면 세부는 공개 문서에 적음이 적음).
- 출처: https://developers.openai.com/codex/app/commands · https://developers.openai.com/codex/app/review · https://learn.chatgpt.com/docs/features · https://learn.chatgpt.com/docs/app · https://codex.danielvaughan.com/2026/04/17/codex-app-workspace-pr-review-task-sidebar-artifact-viewer/ (블로그)

**참고: Linear (설정 배치)** — 설정을 "계정 / 워크스페이스" 같은 **묶음 머리글이 있는 왼쪽 목록**으로 다시 만들고 설정 첫 화면을 둠, 2026-03에 설정 화면의 **"Back to app" 버튼**을 고침. 출처: https://linear.app/changelog/2024-12-18-personalized-sidebar · https://linear.app/blog/settings-are-not-a-design-failure · https://linear.app/changelog/2026-03-12-ui-refresh

### 5.2 패턴 비교표 (기능 × 제품)

| 기능 | VS Code | Cursor 3 | Zed | JetBrains | Windsurf | Warp | Claude Code | Codex | **HARNESS-X 지금** |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 세션 목록 | 왼쪽(Agents 창) | 왼쪽 | 사이드바(단축키) | 버튼 뒤 숨김 | 패널 안 기록 | 오른쪽 위 관리 패널 | 왼쪽 | 왼쪽 | 왼쪽 ✔ |
| 새 세션 | 목록 맨 위 + Ctrl+N | 목록 위 | 패널 위 | 채팅 창 위 | 패널 위 | — | 목록 맨 위 + Ctrl+N | 목록 맨 위 | 목록 맨 위 + Ctrl+N ✔ |
| 필터·묶기 | 목록 위 작은 버튼 | — | — | — | — | — | **머리글 hover 아이콘** | 고정·프로젝트 묶음 | **select 5개 늘 보임** ✘ |
| 승인 | 대화 안 확인 창 | 대화 안 | 도구 권한 설정 + 대화 | 대화 안 + 옆 "허용 목록에 추가" | 대화 안 | diff 보여 주며 | 대화 안 diff + 카드 | (설정 문서) | 오른쪽 위 영역 + 채팅(죽은 버튼) △ |
| 권한·모드 고르기 | **입력창 도구줄** | 입력창 | 입력창 위 | **입력창** | **입력창 아래** | 대화마다 | **입력창 아래 줄** | `+` 메뉴(Plan) | 입력창 칩 2개 ✔(합칠 여지) |
| 모델 고르기 | 입력창 | 입력창 | 입력창 위 | 입력창 | 입력창 아래 | — | 입력창 줄 오른쪽 끝 | 입력창 | 입력창 오른쪽 ✔ |
| diff | 오른쪽 Changes | 오른쪽 리뷰 | 입력창 위 요약 → 탭 | 편집기 | 편집기 | diff 보기·리뷰 패널 | 끌어 놓는 칸 + 오른쪽 레일 | 오른쪽 Review | 오른쪽 탭 ✔(이름 ✘) |
| 터미널 | 아래 Panel | — | 아래 dock | 아래 | — | 본체 | 칸(Ctrl+`) | **대화 아래 서랍** | 오른쪽 탭 △ |
| 계획·체크리스트 | — | — | — | Plan 모드 승인 | 대화 안 Todo | — | Plan 모드 | Plan/Goal | 오른쪽 탭 1번 ✔ |
| 실행 상태 | 목록 줄 상태 | 목록 | — | — | — | 관리 패널 | **목록 줄 점** + OS 알림 | 목록 | 상단바 1개 + 목록 줄 △ |
| 정지 | 보내기 자리 | 보내기 자리 | 보내기 자리 | — | 보내기 자리 | Ctrl+C | **보내기 자리 + Esc** | 보내기 자리 | 보내기 자리 + Esc 2번 ✔ |
| 도구·플러그인 관리 | Customizations(왼쪽) | 설정 | 설정 | 플러그인 설정 | Memories 패널 | — | 사이드바 **Customize** + `+` 지름길 | 사이드바 Skills/Plugins | 사이드바 [설치 관리] + 죽은 [플러그인][스킬] △ |
| 설정 입구 | 왼쪽 아래 톱니 | 설정 | 메뉴 | 메뉴 | 설정 | 메뉴 | 앱 설정 | 왼쪽 아래 | 사이드바 [엔진][설정] 둘 ✘ |
| 설정 화면 | 검색 + 왼쪽 묶음 | — | — | 왼쪽 트리 | — | — | 왼쪽 목록 | 왼쪽 목록 | **가로 탭 13개** ✘ |

### 5.3 일반 원칙 (배치 판단에 쓴 것)

| 원칙 | 한 줄 요약 | 이 문서에서 쓴 곳 | 출처 |
| --- | --- | --- | --- |
| 점진적 공개 | 드문·고급 기능은 두 번째 화면으로 미뤄 배우기 쉽게. 단, **위험한 결과는 숨기지 말 것** | 필터·보기 모드·YAML·판정 내리기, 승인 카드는 숨기지 않기 | https://www.nngroup.com/articles/progressive-disclosure/ |
| 피츠의 법칙 | 자주 누르는 것은 크고 가깝게 | 보내기·정지·승인 버튼 자리 고정 | https://www.nngroup.com/articles/fitts-law/ |
| Nielsen 10 원칙 | 상태 보이기(#1), 비상구(#3), 일관성(#4), 알아보기(#6), 간결함(#8) | P-01·P-02·P-07·P-15 | https://www.nngroup.com/articles/ten-usability-heuristics/ |
| Apple HIG | 툴바 = 자주 쓰는 명령 자리, 사이드바 = 앞쪽 가장자리의 이동 목록, 직접 만든 넘침 메뉴 금지 | 상단바에 드문 것 빼기 | https://developer.apple.com/design/human-interface-guidelines/toolbars · https://developer.apple.com/design/human-interface-guidelines/sidebars |
| Material 3 | 좁은 화면은 아래 막대/모달 서랍, 넓은 화면은 고정 서랍·레일 | 768px 기준 시트 유지, 좁은 화면 아래 줄 | https://developer.android.com/develop/ui/compose/layouts/adaptive/build-adaptive-navigation |
| 사람 확인(HITL) | 승인 카드는 실제 내용(diff·명령·대상)을 보여 줄 것, 매 단계 말고 되돌릴 수 없는 일 앞에서만, "되돌리기"가 승인보다 나을 때가 있음, 대충 누르기("승인 연극") 경계 | 확인 영역 하나·되돌리기(`approvals.undo`) 유지 | https://www.kunalganglani.com/blog/tool-approval-patterns-ai-agents · https://agentinterface-co.pages.dev/blog/human-in-the-loop-ux-patterns-production-ai-agents.html |
| Vercel 웹 화면 규칙 | 상태는 주소에, 이동은 링크로, 빈 상태 처리, 아이콘만 버튼엔 aria-label, 장식 아이콘 aria-hidden, 끌기에는 키보드 대안 | P-20·P-21·P-24, 8장 아이콘 규칙 | `.claude/skills/web-design-guidelines` (규칙 파일) |
| frontend-design 스킬 | 대담함은 한 곳에만, 나머지는 조용하게, "거울 보고 장신구 하나 빼기" | 입력창만 주인공, 나머지 줄이기 | `.claude/skills/frontend-design/SKILL.md` |

### 5.4 HARNESS-X가 가져올 것 / 버릴 것

| 가져올 것 | 어디서 | HARNESS-X 적용 |
| --- | --- | --- |
| 입력창 아래 한 줄에 "모드·권한 / 모델" | Claude Code·VS Code·Windsurf·JetBrains | 입력창 줄 정리(M-07) |
| 필터·묶기는 작은 아이콘 뒤로 | Claude Code(머리글 hover), VS Code | 사이드바 `[필터]` 하나(M-04) |
| 목록 줄에 세션별 상태 점 + 확인 필요 표시, 답하면 사라짐 | Claude Code, VS Code Agents 창 | 상단바 전체 상태 대신 줄 상태 강조(M-09) |
| 바뀐 양 요약이 입력창 가까이 | Zed | 입력창 위 "파일 3개 바뀜 · 보기" 한 줄 → 오른쪽 "바뀐 파일" 탭(M-11) |
| "마지막 턴 바뀐 것" 보기 | Codex·VS Code | 바뀐 파일 탭 안 전환(다음 티켓) |
| 설정 = 왼쪽 묶음 목록 + "← 앱으로" | Linear·VS Code·Claude | 설정 페이지화(M-01, M-12) |
| 승인한 동작 옆 "다음부터 묻지 않기" | JetBrains Junie, VS Code "이 세션 동안" | 이미 있는 `remember` 체크 유지 |
| 자동 승인은 기본 꺼짐, 금지 목록은 항상 묻기 | Warp | 오토 모드 한도 카드 유지 |
| 도구·플러그인 관리는 사이드바 한 입구 + `+` 지름길 | Claude Code Customize | `[도구·AI 설치]` 한 입구(M-05) |
| 실행 중 에이전트 전체 보기 | Warp 관리 패널 | 상단바 "실행 중 2" 누르면 실행 세션 목록(다음 티켓) |

| 버릴 것 | 어디서 | 이유 |
| --- | --- | --- |
| 아이콘만 있는 Activity Bar | VS Code·JetBrains | 초보자는 아이콘 뜻을 모름 → 아이콘+글자 |
| 자유 배치(끌어서 칸 나누기) | Claude Code·Cursor 타일 | 초보자는 배치를 잃어버림. 탭 순서 끌기만 유지 |
| 업데이트마다 배치 바꾸기 | Cursor(포럼 불만) | 한 번 정하면 오래 유지 |
| 설정을 JSON 글로 | Zed | 초보자 불가 |
| 할 일 목록을 대화 안에만 | Windsurf | 스크롤하면 사라짐 → 오른쪽 "진행" 탭 고정 유지 |
| 터미널 중심 화면 | Warp | 초보자에게 낯섦 → 터미널은 오른쪽 탭 하나 |
| 영역 5개(Activity·Side·Editor·Panel·Secondary) | VS Code | 3열이면 충분 |

---

## 6. 추천 배치

### 6.1 네 가지 원칙

1. **왼쪽 = 고르기(어디서·어느 대화), 가운데 = 하기(무엇을), 오른쪽 = 확인하기(결과·승인).** 사람의 눈이 왼쪽 → 가운데 → 오른쪽으로 흐르는 일의 순서(J5 → J1 → J2·J3)와 같다. (VS Code·Claude Code·Codex 모두 이 3열)
2. **한 기능 = 한 집.** 지름길은 허용하지만, 지름길은 집으로 "데려가기"만 하고 집과 다른 화면을 만들지 않는다.
3. **빈도 → 거리** (2장 표). ★★★는 0~1번, ☆는 설정 안.
4. **페이지 모드와 작업 모드를 나눈다.** 대화 작업 중 화면(3열)과 따로 쓰는 페이지(설정·도구 설치·에이전트 만들기)는 겉모양부터 다르게. 페이지에는 항상 `[← 대화로]`.

### 6.2 넓은 화면 (≥ 1024px) — 대화 작업 모드

```
┌ 상단바 44px ───────────────────────────────────────────────────────────────────────┐
│ [≡] 📁 내프로젝트 ▾        ● 실행 중 2  [■ 모두 멈추기]          Claude ▮▮▯  Codex ▮▯▯ │
└────────────────────────────────────────────────────────────────────────────────────┘
┌ 사이드바 240 ───────────┬ 가운데 (최대 760 가운데 정렬) ──────────┬ 오른쪽 패널 360 ──────────┐
│ [✎ 새 세션  Ctrl N][▾]  │                              [보기 ▾]   │ ✋ 확인이 필요해요  2       │
│ [🔍 찾기……]   [⚙ 필터•] │                                          │ ┌ 카드: 이 명령을 실행할까요?│
│                          │  채팅 흐름                               │ │ npm install …  [허락][거절]│
│ ✋ 확인 필요 1            │   · 도구 카드(접힘)                      │ └────────────────────────── │
│   ● 로그인 고치기  ✋     │   · ✋ 확인을 기다려요 → [확인하러 가기] │ ─────────────────────────── │
│ 📁 내프로젝트     [+][⋯] │   · 이어하기 카드 (한 모양)              │ [☑ 진행][± 바뀐 파일][>_ 터미널][🕘 기록]│
│   ● 로그인 고치기         │                                          │  진행 탭: 체크리스트       │
│   ✓ 첫 화면 만들기        │  ┌ 파일 3개 바뀜 · 보기 ─────────────┐   │          + 판정 결과        │
│   ⏸ 표 정리   (이어하기)  │  ┌ 입력창 ──────────────────────────┐ │  바뀐 파일 탭: diff        │
│ 📁 다른프로젝트   [+][⋯] │  │ 무엇을 할까요?                    │ │                            │
│ [📂 폴더 열기]            │  │                                    │ │                            │
│                          │  │ [+] [🧭 일반 · 쓰기 ▾]   [🤖 Claude ▾] [↑]│                    │
│──────────────────────────│  └────────────────────────────────────┘ │                            │
│ ✨ 에이전트 만들기        │                                          │                            │
│ 📦 도구·AI 설치           │                                          │                            │
│ ⚙ 설정                   │                                          │                            │
└──────────────────────────┴──────────────────────────────────────────┴────────────────────────────┘
(기호는 그림 설명용. 실제는 8장의 Lucide 아이콘)
```

- 상단바: **지금 어디서(프로젝트) / 지금 무슨 일(실행 상태) / 남은 양(쿼터)** 세 가지만. 경로·브랜치·AGENTS.md는 프로젝트 이름 `▾` 안으로.
- 사이드바: 맨 위 "새 세션" → 찾기·필터 → **확인 필요 묶음(있을 때만, 맨 위)** → 프로젝트·세션 → 폴더 열기 → 맨 아래 페이지 3개.
- 가운데: 채팅은 읽기만, 답은 오른쪽에서. 입력창 위에 "바뀐 파일 요약" 한 줄(있을 때만).
- 오른쪽: 위 = 기다리는 결정(있을 때만), 아래 = 탭 4개(쉬운 이름).

### 6.3 좁은 화면 (< 768px)

```
┌ 상단바 ─────────────────────────────┐
│ [≡]  📁 내프로젝트 ▾   ● 실행 중  [▤]│   ≡ = 사이드바 시트(필터는 시트 안에서도 [필터] 하나)
└─────────────────────────────────────┘   ▤ = 오른쪽 패널 시트(탭 4개)
┌ 채팅 ───────────────────────────────┐
│  …                                   │
│  ✋ 확인을 기다려요 [확인하러 가기]   │
└─────────────────────────────────────┘
┌ 확인이 필요해요 (아래 고정, 있을 때만)┐   지금도 AppShell.tsx:139가 이렇게 그림 — 유지
│ 카드 1/2  [허락][거절]                │
└─────────────────────────────────────┘
┌ 입력창 ─────────────────────────────┐
│ [+] [🧭 ▾] [📎 파일]   [🤖 ▾] [↑]    │   칩은 아이콘+짧은 글자, 버튼 44px
└─────────────────────────────────────┘
```

- 쿼터·경로는 숨김(지금 규칙 유지). "모두 멈추기"는 실행 2개 이상일 때 `▤` 옆에 아이콘+글자 "멈추기".
- 시트 안 스크롤이 뒤 화면으로 새지 않게 `overscroll-behavior: contain`(WIG).

### 6.4 따로 쓰는 페이지 모드 (설정 · 도구·AI 설치)

```
┌ 상단바 ────────────────────────────────────────────────────────────┐
│ [← 대화로]   설정                                     [🔍 설정 찾기] │
└────────────────────────────────────────────────────────────────────┘
┌ 왼쪽 목록 220 ──────────┬ 본문 (최대 720) ─────────────────────────┐
│ 자주 바꾸는 것           │  일반                                     │
│  ⚙ 일반 (테마·글자 크기)  │  ┌ 테마 ────────────── [자동 ▾] ┐         │
│  🤖 AI·엔진              │  └ 글자 크기 ────────── [보통 ▾] ┘         │
│  🧭 모드·권한            │                                           │
│  ✋ 승인·알림            │                                           │
│ 일하는 방식              │                                           │
│  ☑ 체크리스트 · ⚖ 판정   │                                           │
│  📎 첨부 · 🎤 음성       │                                           │
│ 도구                     │                                           │
│  📦 도구·설치 · 🧩 플러그인│                                          │
│ 내 정보                  │                                           │
│  📁 프로젝트 · 🔒 데이터·보안 · ⓘ 정보 │                               │
│ [ ] 고급 설정 보기       │                                           │
└──────────────────────────┴───────────────────────────────────────────┘
```

- 사이드바·오른쪽 패널을 숨긴다(빌더와 같은 "페이지 모드"). `[← 대화로]`가 P-01을 고친다.
- 탭 13개는 그대로(테스트가 이름으로 찾음) 두고 **묶음 머리글 4개**만 더한다. 같은 `role="tab"` 버튼이므로 키보드·스냅샷 영향 작음(머리글은 `role="presentation"` 또는 탭 목록 밖 `<h3>`로 — 9장).
- 도구·AI 설치 페이지도 같은 틀: 왼쪽 목록 = 설치됨·찾기·주소로 설치·기록 + **"AI(엔진)"** 바로가기(설정 AI·엔진 탭으로).

### 6.5 에이전트 만들기 (빌더)

```
┌ 위쪽 바 ─────────────────────────────────────────────────────────────────────────┐
│ [← 대화로]  에이전트 만들기 · (시작: 빈 캔버스)   [↶][↷]   [🧪 시험해 보기] [💾 저장] │
└──────────────────────────────────────────────────────────────────────────────────┘
┌ 왼쪽 260 ──────────────┬ 캔버스 ─────────────────────────┬ 속성 300 ──────────────┐
│ [💬 대화로 만들기|🧱 블록]│   (블록·빈 칸·도구 고르기 카드)  │ [블록 설정|시험 결과]   │
│ 블록 서랍 탭…           │                                  │ … 고급: [</> 설정 글]   │
└──────────────────────────┴──────────────────────────────────┴─────────────────────────┘
```

- **저장은 위쪽 바 오른쪽 한 곳**(지금 두 곳 → P-14). 초안이 있으면 `builder.save-open`, 없으면 `inspector.save`를 같은 자리 버튼이 부르게 한다(id는 상황별로 그대로 — 9장).
- "시험 실행"은 저장 옆 주 버튼 짝으로 끌어올림(초보자 레고 빌더 연구 P4 "시험 모드"와 같은 방향, `upgrade-research.md` 3-1).
- "YAML 보기"는 속성 창 아래 "고급" 접기 안으로(점진적 공개).

### 6.6 기능별 집 (모든 action id)

"출처 패턴" = 5장 어느 제품의 결정에서 왔는지.

| action id | 새 집 | 이유 (빈도·흐름·근거) | 출처 패턴 | 바뀜 |
| --- | --- | --- | --- | --- |
| `shell.open-sidebar`, `shell.open-panel` | 좁은 화면 상단바 양끝 | 좁은 화면 표준(시트) | Material 3 모달 서랍 | 그대로(아이콘만 교체) |
| `projects.new-session`, `projects.pick-new`, `sidebar.new-session` | 사이드바 맨 위 | ★★ 하루 여러 번, 왼쪽 위가 시작점 | Claude·VS Code·Codex 모두 | 그대로 |
| `projects.new-in-project` | 프로젝트 줄 `+` + `▾` 메뉴 | 지름길 | Claude(프로젝트 묶음) | 프로젝트 `⋯`의 "새 세션"은 뺌 |
| `projects.open-folder` | 사이드바 목록 아래 `[폴더 열기]` + `▾` 메뉴 | ★ 가끔 — 목록 위 머리 버튼은 내림 | Codex Projects | 위치 이동 |
| `projects.select`, `projects.group-toggle`, `projects.done-toggle`, `projects.relink` | 사이드바 목록 | 그대로 | — | 그대로 |
| `projects.menu`, `projects.menu-item` | 프로젝트 줄 `⋯` | ★ 드묾 — 항목 8 → 6 (새 세션 뺌, "탐색기에서 열기"는 유지, "다른 폴더로 옮기기"는 임시 공간만) | Apple HIG 짧은 메뉴 | 항목 정리 |
| `projects.archive-stale` | 사이드바 안내줄(조건부) | 그대로 | Claude 자동 보관 | 그대로 |
| `conversation.select`, `conversation.menu`, `conversation.menu-item`, `sidebar.select-session` | 세션 줄 | ★★ | 모두 | **선택 시 대화 화면으로 돌아오게**(P-01) |
| (select 5개: 묶기·정렬·상태·AI·에이전트) | `[필터]` 팝오버 안 | ☆ — 쓰면 버튼에 점 표시 | Claude 머리글 hover 아이콘 | 이동(새 id 필요 시 `projects.filter-open` 추가 제안) |
| `nav.agent-builder` | 사이드바 맨 아래 1번 | ★ 가끔, 한 번 들어가면 오래 → 페이지 | Claude Customize | 그대로 |
| `nav.install` | 사이드바 맨 아래 2번, 이름 "도구·AI 설치" | ★ 처음·가끔 | Claude Customize, VS Code Customizations | 글자 변경 |
| `nav.settings` | 사이드바 맨 아래 3번 | ☆ | VS Code 왼쪽 아래 톱니, Codex | 그대로 |
| `nav.engines` | **AI 버튼 메뉴 맨 아래 "AI 관리…"** | 엔진은 "어떤 AI를 쓸까"를 고르다 생각나는 일 → 모델 고르기 옆이 맞음. 사이드바에서는 뺌 | VS Code "Manage models", Zed 모델 고르기 | 이동(id 그대로) |
| `nav.plugins`, `nav.skills` | **숨김**(준비되면 "도구·AI 설치" 페이지 안 탭) | 죽은 버튼이 명당 차지 | Claude Customize 안 플러그인·스킬 | 숨김(id 유지, 렌더 안 함) |
| `topbar.theme` | **설정 > 일반**(이미 `ui.theme` 있음) — 상단바에서 뺌. 버튼 자체는 설정 일반 탭 맨 위 "빠른 바꾸기"로 | ☆ 드묾, 중복 | ChatGPT·Claude 설정 안 테마 | 이동(id 그대로) |
| `shell.stop-all` | 상단바 실행 상태 옆(실행 2개 이상) | 급할 때 한 번 — 상태와 붙어 있어야 | Warp 관리 패널 | 그대로(글자 "모두 멈추기") |
| `composer.send`, `composer.stop`, `composer.stop-pause`, `composer.stop-now` | 입력창 오른쪽 끝 같은 자리 | ★★★ 피츠 — 늘 같은 자리 | 모든 제품 | 그대로 |
| `composer.plus`, `plus.attach`, `composer.attach-pick` | 입력창 왼쪽 `+` | ★★ | Claude·Codex `+` | 그대로 |
| `plus.open-folder`, `plus.recent`, `plus.pick-recent`, `plus.pin` | `+` 메뉴 아래 "어디서 일할까요" 묶음(구분선) | 지금 섞임(P-18) → 메뉴 안 묶음 제목으로 나눔 | Claude 입력창 아래 "프로젝트 폴더" | 메뉴 안 정리 |
| `composer.chip`, `composer.chip-option` (권한·모드) | 입력창 **칩 하나 "모드·권한"**: 팝오버 위 = 모드 3개, 아래 = 권한 3개 | 둘이 서로 연결(P-17), Claude는 하나의 "모드 고르기" | Claude Code 모드 고르기 | 칩 2개 → 1개(id 그대로) |
| `composer.mode-upgrade`, `composer.mode-keep` | 같은 팝오버 안 확인 | 그대로 | — | 자리 그대로 |
| `model.open`, `model.choose`, `model.login`, `model.scope` | 입력창 오른쪽(보내기 왼쪽) | ★★ | Claude(오른쪽 끝)·Zed·VS Code | 그대로 |
| `composer.clear-agent`, `composer.remove-attachment`, `composer.attachment-preview` | 입력창 안 칩 | 그대로 | — | 그대로 |
| `subagent.add`, `subagent.new-session`, `subagent.cancel` | 입력창 바로 위 확인 | 보낸 직후 질문 → 입력창 옆 | — | 그대로 |
| (판정 표시 `data-testid="verdict"`) | **오른쪽 "진행" 탭 맨 위** | ☆ 개발자 정보, 입력창 명당에서 내림 | frontend-design "대담함은 한 곳" | 이동 |
| `chat.mode` | 채팅 오른쪽 위 **"보기 ▾" 하나** | ☆ | Claude 보기 모드(설정·단축키) | 3칸 → 드롭다운(radiogroup 유지) |
| `chat.tool-toggle`, `chat.open-diff` | 채팅 | 그대로 | — | 그대로 |
| `chat.approval-option` | **채팅에서 "확인하러 가기" 링크로 바꿈**(누르면 확인 영역 카드로 포커스) | 죽은 버튼 제거, 답하는 곳 하나 | HITL "결정은 한 줄", Claude 알림→세션 | 동작 변경(비활성 → 데려가기) — 승인 API가 생기면 그때 다시 판단 |
| `approvals.choose`, `approvals.more`, `approvals.undo` | 오른쪽 위 확인 영역 | ★★★ 답하는 집 | Warp·Claude diff 보여 주며 묻기 | 그대로 |
| `approvals.toast`, `approvals.mini-open` | 알림·채팅 작은 카드 → 확인 영역으로 데려가기 | 데려가기 | Claude OS 알림 | 그대로 |
| `checklist.decide`, `checklist.approve-plan`, `run-mode.plan-choose` | **확인 영역에도 같은 카드가 뜨게**(체크리스트 탭 안 카드는 "확인하러 가기"로) | 승인 한 줄(P-04) | JetBrains Plan 모드 승인 | 확인 영역 `extra`에 추가(App.tsx:467) |
| `checklist.toggle` | 오른쪽 "진행" 탭 | ★★★ 계속 봄 | (HARNESS 고유 장점) | 탭 이름 "진행" |
| `panel.tab` | 오른쪽 탭 4개: **진행 · 바뀐 파일 · 터미널 · 기록** | 쉬운 말(P-12) | Codex "Review", VS Code "Changes" | 글자 변경 |
| `terminal.login` | 터미널 탭 | 그대로 | — | 그대로 |
| `recovery.resume`, `resume.start`, `resume.check-choice`, `resume.open-list`, `resume.session` | 입구 여럿 → **도착지 ResumeFlow 하나**, 카드 모양 하나 | 모양 통일(P-19) | — | CSS·문구 |
| `run-mode.auto-start`, `auto-edit-limits`, `auto-cancel`, `open-review`, `review-action` | 채팅 카드(시작) / 진행 탭(돌아오면 확인할 것) | 그대로 | Warp 자동 승인 기본 꺼짐 | 그대로 |
| `scan.open-install`, `scan.dismiss` | 빈 세션 가운데 말풍선(처음만) | 처음 한 번 | — | 그대로 |
| `empty.example`, `empty.agent` | 빈 세션 | 처음 | ChatGPT 예시 | 그대로 |
| `where.*` | 새 세션을 눌렀는데 프로젝트가 없을 때 가운데 카드 | 그대로 | Claude "프로젝트 폴더" 고르기 | 그대로 |
| `confirm.ok`, `confirm.cancel` | 확인 창 | 그대로 | WIG "되돌릴 수 없는 일은 확인" | 그대로 |
| `project-settings.*` | 프로젝트 `⋯ > 프로젝트 설정` → 가운데 페이지 | ☆ | — | 그대로 |
| `settings.*` (탭·필드·프로젝트·데이터·정보) | 설정 페이지 | ☆ | Linear·VS Code | 페이지 모드 + 묶음 머리글 |
| `engines.*` | 설정 > AI·엔진 | ★ 처음 | — | 그대로 |
| `install.*`, `toolpicker.source-link` | 도구·AI 설치 페이지 / 확인 영역 카드 | ★ | Claude Customize | 페이지 모드 |
| `forge.*` | 채팅 카드 | 그대로 | — | 그대로 |
| `builder.back`, `builder.undo`, `builder.redo` | 빌더 위쪽 바 왼쪽 | 그대로 | — | 그대로 |
| `builder.save-open`, `inspector.save`, `inspector.overwrite` | **빌더 위쪽 바 오른쪽 "저장" 한 자리** | P-14 | 모든 편집기(저장은 오른쪽 위) | 이동 |
| `inspector.dry-run`, `inspector.clear-overlay` | 위쪽 바 "시험해 보기" + 속성 "시험 결과" 탭 | 초보자 핵심 | upgrade-research P4 | 일부 이동 |
| `inspector.tab` | 속성 창 탭 2개 + "고급" 접기(YAML) | P-25 | 점진적 공개 | 탭 정리 |
| `inspector.yaml-apply`, `inspector.yaml-reset` | 고급 접기 안 | ☆ | — | 이동 |
| `builder.start-*`, `builder.drawer-tab`, `builder.sidebar-tab`, `builder.mic*`, `inspector.skill-*`, `lego.*` | 빌더 그대로 | — | — | 그대로 |
| `draft.*`, `save.*` | 빌더 대화 카드·저장 창 그대로 | — | — | 그대로 |
| `dev.dismiss-banner` | 개발 모드 띠 | 개발용 | — | 그대로 |

### 6.7 무엇이 어디로 (요약)

**옮김 (from → to)**
- M-01 설정·설치 관리: 가운데만 바뀌는 화면 → **페이지 모드**(사이드바·패널 숨김 + `[← 대화로]`) — P-01·P-03
- M-02 `nav.engines`: 사이드바 메뉴 → 입력창 AI 메뉴 맨 아래 "AI 관리…" — P-07
- M-03 `topbar.theme`: 상단바 → 설정 > 일반 — P-08
- M-06 판정 표시: 입력창 아래 → 오른쪽 "진행" 탭 맨 위 — P-09
- M-08 경로·브랜치·AGENTS.md·CLAUDE.md: 상단바 → 프로젝트 이름 `▾` 팝오버 — P-10
- M-10 `projects.open-folder`(머리 버튼): 목록 위 → 목록 아래 — 3.3
- M-11 빌더 저장: 위쪽 줄/속성 창 → 위쪽 바 오른쪽 — P-14
- M-13 체크리스트 단계 확인·계획 승인: 탭 안 → 확인 영역에도 — P-04

**합침**
- M-04 select 5개 → `[필터]` 하나 — P-05
- M-07 권한 칩 + 모드 칩 → "모드·권한" 칩 하나 — P-17
- M-12 탭 모양 3종 → 세그먼트 탭 1종(design-2026 5.4~5.7과 같음) — P-15
- 이어하기 카드 3종 → 한 모양 — P-19

**메뉴로 내림(점진적 공개)**
- `chat.mode` 3칸 → "보기 ▾" — P-16
- 빌더 "YAML 보기" → 고급 접기 — P-25
- 프로젝트 `⋯`에서 "새 세션" 빼기 — P-26
- 설정 탭 13개 → 묶음 4개 아래(탭은 그대로) — P-13

**숨김**
- `nav.plugins`, `nav.skills`(준비 중) — P-06

**그대로 (잘 된 것 — 건드리지 않기)**
- 새 세션 자리·Ctrl+N, 보내기↔정지 같은 자리 + Esc, 오른쪽 위 확인 영역(좁은 화면 아래 고정), 승인 되돌리기, 모델 고르기 자리, 빈 세션 예시, 세션 `⋯` 메뉴, 패널 탭 끌기 + Alt+←/→, 3열 너비 조절.

---

## 7. 간소화 제안

### 7.1 초보자 기본 화면에서 숨기거나 합치거나 내릴 것

| 기능 | 처리 | 이유(빈도 근거) |
| --- | --- | --- |
| 묶기·정렬·상태·AI·에이전트 select 5개 | 합침 → `[필터]` | ☆ 세션이 20개 넘기 전엔 거의 안 씀. Claude도 hover 아이콘 뒤 |
| 플러그인·스킬 메뉴 | 숨김 | 눌러도 아무 일 없음 |
| 엔진 메뉴 | 합침 → AI 메뉴 "AI 관리…" | 같은 화면 중복 |
| 테마 버튼 | 내림 → 설정 | ☆ 한 번 정하면 안 바꿈 |
| 판정 줄 | 내림 → 진행 탭 | ☆ 개발자 정보 |
| 경로·브랜치·AGENTS.md·CLAUDE.md | 내림 → 프로젝트 `▾` | ☆ 초보자에게 뜻 없음 |
| 보기 모드 3칸 | 내림 → "보기 ▾" | ☆ |
| 권한 칩 | 합침 → 모드·권한 칩 | 모드와 함께 고르는 값 |
| 채팅 승인 비활성 버튼 | 바꿈 → "확인하러 가기" | 죽은 버튼 |
| 프로젝트 머리 "폴더 열기" | 내림 → 목록 아래 | ★ 가끔(▾ 메뉴에도 있음) |
| 설정 탭 13개 | 묶음 4개 + `고급 설정 보기`가 꺼져 있으면 "일하는 방식·도구" 묶음은 접힘 | ☆ — 단 테스트 영향 큼, 9장 |
| 빌더 YAML 탭 | 고급 접기 | ☆ |
| 빈 패널 문구 | "에이전트가 일을 시작하면 여기에 단계가 나와요"처럼 할 일 안내로 | 빈 상태 처리 |

### 7.2 화면마다 처음 보이는 선택지 수 (전 → 후)

| 화면 | 지금 | 제안 후 | 줄어듦 |
| --- | --- | --- | --- |
| 메인 상단바 | 1 (+조건부 1) | 1 (프로젝트 ▾) (+조건부 1) | 같음, 글자 표시 5 → 3 |
| 메인 사이드바 | 15 | 7 (새 세션·▾·찾기·필터·폴더 열기·페이지 3 중 2개가 아래 고정 → 실제 8) | **−7** |
| 메인 가운데(보기+입력창) | 3 + 5 = 8 | 1 + 4 = 5 | −3 |
| 메인 오른쪽 | 4 | 4 | 같음 |
| **메인 합계** | **28** | **16~17** | **약 −40%** |
| 설정 | 34 (사이드바·패널 포함) | 18 (대화로·찾기·고급 보기·탭 13 + 묶음은 표시만) → 고급 꺼짐이면 탭 7개만 펼침 = **10** | −50~70% |
| 도구·AI 설치 | 23+ | 7 (대화로·탭 4·AI 바로가기·찾기) | −70% |
| 빌더 위쪽+속성 | 4 + 3 = 7 (저장 자리 바뀜) | 6 + 2 = 8 (저장·시험 고정) | +1이지만 자리 고정 |

---

## 8. 아이콘 체계

### 8.1 규칙

| 규칙 | 내용 |
| --- | --- |
| 라이브러리 | **lucide-react**(ISC 라이선스, 쓰는 것만 번들). `design/icons.tsx` 한 파일에 "이름 → 컴포넌트" 표를 두고 화면은 `<Icon name="send" />`만 씀. 새 의존성이므로 T-102 기간에는 `approved.json` 승인 후 |
| 크기 | **16px**: 목록 줄·버튼·칩·메뉴 항목·탭. **20px**: 상단바, 아이콘만 버튼, 빈 화면 안내, 페이지 제목 옆 |
| 굵기·색 | `strokeWidth` 1.75, 색 `currentColor`(글자색 따라감) |
| 접근성 | 아이콘은 늘 `aria-hidden="true"`. 뜻은 글자 또는 `aria-label`로(지금 구조 그대로) |
| **아이콘 + 글자 (기본)** | 초보자 원칙. 사이드바 메뉴·새 세션·폴더 열기·패널 탭·설정 목록·`⋯` 메뉴 항목·승인 버튼·확인 카드 버튼·필터·빌더 저장·시험 |
| **아이콘만 (예외 8종)** | 누구나 아는 것만 + `title` 툴팁 + `aria-label` 필수: ① 보내기(ArrowUp) ② 정지(Square) ③ 추가(Plus) ④ 더 보기(Ellipsis) ⑤ 펼치기(ChevronDown) ⑥ 닫기(X) ⑦ 되돌리기(Undo2) ⑧ 다시 하기(Redo2). 좁은 화면 시트 열기(PanelLeft·PanelRight)는 툴팁 있는 아이콘만 허용 |
| 상태 아이콘 | 색만으로 상태를 말하지 않음 — 점 대신 모양이 다른 아이콘(CircleDot·Hand·CirclePause·CircleCheck·Circle·CircleAlert) + 글자 라벨(이미 `aria-label` 있음) |
| 사용자 데이터 | 에이전트가 고른 아이콘(`agent.icon` 이모지)은 그대로 둠 |

### 8.2 기능별 아이콘 지정표 (Lucide 이름)

| action id / 표시 | Lucide | 크기 | 방식 |
| --- | --- | --- | --- |
| `shell.open-sidebar` | `PanelLeft` | 20 | 아이콘만+툴팁 |
| `shell.open-panel` | `PanelRight` | 20 | 아이콘만+툴팁 |
| `sidebar.new-session`, `projects.new-session` | `SquarePen` | 16 | 아이콘+글자 |
| `projects.pick-new` | `ChevronDown` | 16 | 아이콘만 |
| `projects.new-in-project` | `Plus` | 16 | 아이콘만(줄 안) / 메뉴에선 `Folder`+이름 |
| `projects.open-folder`, `plus.open-folder`, `where.open-folder` | `FolderOpen` | 16 | 아이콘+글자 |
| `plus.recent`, `where.recent` | `History` | 16 | 아이콘+글자 |
| `plus.pin`, `settings.project-pin` | `Pin` / `PinOff` | 16 | 아이콘+글자(메뉴) |
| `where.scratch` | `NotebookPen` | 16 | 아이콘+글자 |
| 세션 찾기 (input) | `Search` | 16 | 칸 안 장식 |
| 필터(새) | `ListFilter` | 16 | 아이콘+글자 "필터" |
| `projects.group-toggle`, `projects.done-toggle`, `checklist.toggle`, `chat.tool-toggle`, `approvals.more` | `ChevronRight`(접힘)·회전 | 16 | 아이콘만 |
| `projects.menu`, `conversation.menu` | `Ellipsis` | 16 | 아이콘만+툴팁 |
| `projects.relink`, `settings.project-relink`, `project-settings.relink` | `FolderSync` | 16 | 아이콘+글자 |
| 메뉴: 이름 바꾸기 / 보관 / 삭제 / 탐색기에서 열기 / 프로젝트 설정 / 목록에서 빼기 | `Pencil` / `Archive` / `Trash2` / `ExternalLink` / `Settings2` / `ListX` | 16 | 아이콘+글자 |
| `projects.archive-stale` | `Archive` | 16 | 아이콘+글자 |
| `nav.agent-builder` | `Sparkles` | 16 | 아이콘+글자 |
| `nav.install` | `PackagePlus` | 16 | 아이콘+글자 |
| `nav.engines`(AI 관리…) | `Cpu` | 16 | 아이콘+글자 |
| `nav.settings` | `Settings` | 16 | 아이콘+글자 |
| `nav.plugins` / `nav.skills`(준비되면) | `Puzzle` / `WandSparkles` | 16 | 아이콘+글자 |
| `topbar.theme` (설정 안) | `SunMoon` / `Sun` / `Moon` | 16 | 아이콘+글자 |
| `shell.stop-all` | `CircleStop` | 16 | 아이콘+글자 "모두 멈추기" |
| 실행 상태(상단바) | `Loader`(회전, 움직임 줄이기 설정 시 정지)·`CircleAlert`·`Ban` | 16 | 아이콘+글자 |
| 프로젝트 이름 ▾ / 브랜치 | `Folder` / `GitBranch` | 16 | 아이콘+글자 |
| `composer.plus` | `Plus` | 20 | 아이콘만+툴팁 "추가" |
| `plus.attach`, `composer.attach-pick` | `Paperclip` | 16 | 아이콘+글자 |
| `composer.chip`(모드·권한) | 계획 `ListTodo` · 일반 `MessageSquare` · 오토 `Zap` / 권한 `ShieldCheck` | 16 | 아이콘+글자 |
| 잠김(칩) | `Lock` | 16 | 아이콘+글자 |
| `composer.chip-option` 선택 표시 | `Check` | 16 | 아이콘만 |
| `model.open` | `Bot` | 16 | 아이콘+글자(모델 이름) |
| `model.login` | `LogIn` | 16 | 아이콘+글자 |
| `model.scope` | `Target` | 16 | 아이콘+글자 |
| 입력 종류 표시(그림 가능 등) | `Image` / `FileText` | 16 | 아이콘+글자 |
| `composer.send` | `ArrowUp` | 20 | 아이콘만+툴팁 |
| `composer.stop` | `Square` | 20 | 아이콘만+툴팁 |
| `composer.stop-pause` / `composer.stop-now` | `Pause` / `OctagonX` | 16 | 아이콘+글자 |
| `composer.remove-attachment` | `X` | 16 | 아이콘만 |
| `composer.attachment-preview` | `Eye` | 16 | 아이콘만+툴팁 |
| 첨부 종류(그림·PDF·글·표·발표·소리·영상·압축) | `Image`·`FileText`·`File`·`Sheet`·`Presentation`·`Music`·`Film`·`FileArchive` | 16 | 칩 안 장식 |
| `composer.clear-agent` | `X` | 16 | 아이콘만 |
| `composer.mode-upgrade` / `composer.mode-keep` | `ShieldCheck` / 없음 | 16 | 아이콘+글자 / 글자 |
| 음성 입력 `builder.mic` | `Mic` / `MicOff` | 16 | 아이콘+글자 |
| `chat.mode` | `Rows3`(보기 ▾) | 16 | 아이콘+글자 |
| `chat.open-diff` | `FileDiff` | 16 | 아이콘+글자 |
| `chat.approval-option`(데려가기) | `Hand` | 16 | 아이콘+글자 "확인하러 가기" |
| 확인 영역 머리 "확인이 필요해요" | `Hand` | 20 | 아이콘+글자 |
| `approvals.choose`(허락/거절) | `Check` / `X` | 16 | 아이콘+글자 |
| `approvals.undo` | `Undo2` | 16 | 아이콘+글자 |
| `approvals.toast` | `Bell` | 16 | 아이콘+글자 |
| `approvals.mini-open` | `Hand` | 16 | 아이콘+글자 |
| `checklist.decide`, `checklist.approve-plan`, `run-mode.plan-choose` | `ClipboardCheck` | 16 | 아이콘+글자 |
| 패널 탭 진행 / 바뀐 파일 / 터미널 / 기록 | `ListChecks` / `FileDiff` / `SquareTerminal` / `History` | 16 | 아이콘+글자 |
| `terminal.login` | `LogIn` | 16 | 아이콘+글자 |
| `recovery.resume`, `resume.start`, `resume.session` | `Play` | 16 | 아이콘+글자 "이어서 하기" |
| `resume.open-list` | `CirclePause` | 16 | 아이콘+글자 |
| `resume.check-choice` | (라디오) | — | 글자 |
| `run-mode.auto-start` / `auto-edit-limits` / `auto-cancel` | `Zap` / `SlidersHorizontal` / 없음 | 16 | 아이콘+글자 |
| `run-mode.open-review` / `review-action` | `Inbox` / `Check` | 16 | 아이콘+글자 |
| `subagent.add` / `subagent.new-session` | `UserPlus` / `SquarePen` | 16 | 아이콘+글자 |
| `scan.open-install` | `PackageSearch` | 16 | 아이콘+글자 |
| `scan.dismiss`, `save.close`, `where.cancel`, `confirm.cancel`, `draft.peek-close` | `X` | 16 | 아이콘만 또는 글자 |
| `empty.example` | `Lightbulb` | 16 | 아이콘+글자 |
| `empty.agent` | (에이전트 아이콘 그대로) | 16 | 아이콘+글자 |
| `toolpicker.source-link`, `engines.install-guide` | `ExternalLink` | 16 | 아이콘+글자 |
| 추천 표시(⭐) | `Star` | 16 | 아이콘+글자 "추천" |
| `engines.rescan` | `RefreshCw` | 16 | 아이콘+글자 |
| `engines.save-key`, `settings.secret-save` | `KeyRound` | 16 | 아이콘+글자 |
| `settings.secret-delete` | `Trash2` | 16 | 아이콘+글자 |
| `engines.save-settings`, `project-settings.save` | `Save` | 16 | 아이콘+글자 |
| `engines.ping` | `Activity` | 16 | 아이콘+글자 |
| `install.tab` 설치됨 / 찾기 / 주소로 설치 / 기록 | `PackageCheck` / `Search` / `Link` / `History` | 16 | 아이콘+글자 |
| `install.update` / `install.remove` / `install.search` / `install.add-plan` / `install.url-check` / `install.pick-method` | `RefreshCw` / `Trash2` / `Search` / `PackagePlus` / `Link` / `ListChecks` | 16 | 아이콘+글자 |
| 첫 실행 확인·도구 카드(🔧) | `Wrench` | 16 | 아이콘+글자 |
| `settings.tab` 13개 | 일반 `Settings`·AI·엔진 `Cpu`·모드·권한 `ShieldCheck`·체크리스트 `ListChecks`·판정 `Scale`·승인·알림 `Bell`·도구·설치 `PackagePlus`·첨부 `Paperclip`·음성 `Mic`·프로젝트 `Folder`·데이터·보안 `Lock`·플러그인 `Puzzle`·정보 `Info` | 16 | 아이콘+글자 |
| `settings.show-advanced` | `SlidersHorizontal` | 16 | 아이콘+글자 |
| `settings.toggle` | (스위치) | — | 글자 |
| `settings.list-add` / `list-remove` | `Plus` / `X` | 16 | 아이콘+글자 / 아이콘만 |
| `settings.pick-folder` | `FolderOpen` | 16 | 아이콘+글자 |
| `settings.reset-field` / `reset-group` / `reset-all` | `RotateCcw` | 16 | 아이콘+글자 |
| `settings.data-cleanup` | `Eraser` | 16 | 아이콘+글자 |
| `settings.export` / `settings.import` | `Download` / `Upload` | 16 | 아이콘+글자 |
| `settings.update-check` | `RefreshCw` | 16 | 아이콘+글자 |
| `settings.diagnostics` | `FileDown` | 16 | 아이콘+글자 |
| `settings.project-settings` | `Settings2` | 16 | 아이콘+글자 |
| `settings.project-remove*` | `ListX` | 16 | 아이콘+글자 |
| `builder.back`, `settings`·`install` 페이지 "대화로" | `ArrowLeft` | 16 | 아이콘+글자 |
| `builder.undo` / `builder.redo` | `Undo2` / `Redo2` | 20 | 아이콘만+툴팁(단축키) |
| `builder.save-open`, `inspector.save`, `save.save` | `Save` | 16 | 아이콘+글자 |
| `save.save-incomplete` / `save.fill-gaps` / `save.use-suggestion` | `Save` / `PencilRuler` / `Wand` | 16 | 아이콘+글자 |
| `inspector.overwrite` | `Replace` | 16 | 아이콘+글자 |
| `inspector.dry-run` / `inspector.clear-overlay` | `FlaskConical` / `Eraser` | 16 | 아이콘+글자 |
| `inspector.tab` 블록 설정 / 시험 결과 / 설정 글(YAML) | `SlidersHorizontal` / `FlaskConical` / `FileCode` | 16 | 아이콘+글자 |
| `inspector.yaml-apply` / `yaml-reset` | `Check` / `RotateCcw` | 16 | 아이콘+글자 |
| `inspector.skill-up` / `skill-down` | `ArrowUp` / `ArrowDown` | 16 | 아이콘만+툴팁 |
| `builder.start-empty` / `start-plugin-list` / `start-clone-list` / `start-chat` | `Square` / `Puzzle` / `Copy` / `MessageSquare` | 20 | 아이콘+글자(카드) |
| `builder.sidebar-tab` 대화로 만들기 / 블록 | `MessageSquare` / `Blocks` | 16 | 아이콘+글자 |
| `builder.drawer-tab` | 종류별(엔진 `Cpu`, 스킬 `WandSparkles`, 플러그인 `Puzzle`, 도구 `Wrench`) | 16 | 아이콘+글자 |
| `lego.detach-plugin` / `lego.remove-skill` | `Unlink` / `X` | 16 | 아이콘+글자 / 아이콘만 |
| `draft.versions-toggle` / `version-peek` / `version-revert` | `History` / `Eye` / `RotateCcw` | 16 | 아이콘+글자 |
| `draft.gap-find-tool` / `gap-forge` / `gap-remove` | `Search` / `Hammer` / `X` | 16 | 아이콘+글자 |
| `draft.patch-apply` / `patch-cancel` | `Check` / `X` | 16 | 아이콘+글자 |
| `draft.resume` / `start-new` / `list-resume` / `list-delete` | `Play` / `FilePlus` / `Play` / `Trash2` | 16 | 아이콘+글자 |
| `draft.questions-submit` / `questions-skip`, `forge.submit` | `Send` / `SkipForward` | 16 | 아이콘+글자 |
| `confirm.ok` | (위험이면 `Trash2`, 아니면 없음) | 16 | 아이콘+글자 |
| 세션 상태: 진행 중 / 확인 필요 / 멈춤 / 완료 / 대기 / 문제 | `CircleDot` / `Hand` / `CirclePause` / `CircleCheck` / `Circle` / `CircleAlert` | 16 | 아이콘 + 줄 안 글자(이미 `aria-label`) |
| 체크리스트 상태 ●◐◑○✕⊘ | `CircleCheck`·`CircleDashed`·`CircleDot`·`Circle`·`CircleX`·`Ban` | 16 | 아이콘+글자 |
| 단계 번호 ①~⑳ | 숫자 글자 + 원 배경(CSS) | — | 번호는 실제 순서라 유지(frontend-design "번호는 진짜 순서일 때만") |
| 경고 ⚠ | `TriangleAlert` | 16 | 아이콘+글자 |
| 종료 차단 ⛔ | `OctagonAlert` | 16 | 아이콘+글자 |

### 8.3 지금 화면에 쓰이는 기호·이모지 위치 (바꿀 대상)

| 기호 | 쓰이는 곳 (파일:줄) |
| --- | --- |
| ✦ | 메뉴 "에이전트 만들기" `shell/types.ts:78`, 세션 줄 에이전트 `Sidebar.tsx:68`, 빈 세션 `EmptySession.tsx:63`, 슬래시 팔레트 `SlashPalette.tsx:159,244`, `ProjectResumeCard.tsx:36`, 빌더 `SaveBar.tsx:79` |
| ⧉ ◇ ⬇ ⚙ ☰ | 하단 메뉴 `shell/types.ts:79-84`; ⧉ 빌더 묶음 `lego/GroupFrame.tsx:20`; ◇·⚙ 슬래시 `SlashPalette.tsx:49,95` |
| ☰ ▤ | 좁은 화면 시트 버튼 `AppShell.tsx:93,107` |
| ◐ ☀ ☾ | 테마 `design/ThemeToggle.tsx:5` |
| ◎ | 권한 칩 `Composer.tsx:311` |
| ↑ ■ ⏸ ⏹ | 보내기 `Composer.tsx:359`, 정지 `StopButton.tsx:6-84`, 전체 정지 `StopAllButton.tsx:18` |
| ▾ ▸ | 칩·메뉴·접기 `ChipMenu.tsx:73`, `ModelButton.tsx:31,89`, `ProjectSidebar.tsx:190,485,581`, `ToolCard.tsx:56`, `ActionCard.tsx:136`, `WhereToWork.tsx:42` |
| ● ○ ✋ ⏸ ✓ ! | 세션 상태 `shell/projects/model.ts:9-16`, `ProjectSidebar.tsx:519`, `ScanBubble.tsx:37,91-93` |
| ●◐◑○✕⊘◌ | 체크리스트 `panels/Checklist/model.ts:72-77`, `stages.ts:107-114` |
| ①~⑳ | 단계 번호 `panels/Checklist/stages.ts:101`, `ActionCard.tsx:18` |
| ✋ | 확인 영역 `ApprovalsArea.tsx:96`, `ActionCard.tsx:64`, `MiniApprovalCard.tsx:19` |
| 📁 📌 | `PlusMenu.tsx:117`, `ProjectSidebar.tsx:207,505,508`, `WhereToWork.tsx:53`, `ProjectsSection.tsx:30` |
| 📎 🕘 🔍 | `Composer.tsx:341`, `PlusMenu.tsx:131,144`, `ProjectSidebar.tsx:232` |
| 🖼📄📕📊📝📽🎵🎬🗜 | 첨부 종류 `composer/attachments.ts:53-63`, `ModelButton.tsx:127` |
| ★ ☆ ⭐ | 최근 프로젝트 고정 `PlusMenu.tsx:75,89`, 추천 `InstallManager.tsx:465`, `ToolPickerCard.tsx:65,108` |
| 🔧 📦 | `FirstRunCard.tsx:75`, `ToolPickerCard.tsx:127`, `install/model.ts:281`, `Approvals/model.ts:69` |
| ⎇ | 브랜치 `WorkspaceBar.tsx:18` |
| ↶ ↷ ← | 빌더 `BuilderPage.tsx:193,208,219` |
| ↑ ↓ | 스킬 순서 `NodeFields.tsx:118,129` |
| 💬 🎤 | 빌더 `BuilderSidebar.tsx:9`, `MicButton.tsx:16,80`, `Composer.tsx:73` |
| ⚖ 🔐 🖐 📝 ⏱ | 돌아오면 확인할 것 `ReviewListSection.tsx:22-26` |
| ⚠ | `AttachmentChips.tsx:58`, `ModelButton.tsx:72`, `ResumeCheckCard.tsx:27`, `ProjectsSection.tsx:34`, `ProjectSettings.tsx:82`, `ProjectSidebar.tsx:550`, `CompatEdge.tsx:25` |
| ⛔ ✎ ↩ ⚒ ☑ 🔒 🎨 | `StopBlockCard.tsx:12`, `BlockView.tsx:37,115,135`, `ToolCard.tsx:108`, `ChipMenu.tsx:73`, `builder/catalog.ts:193`, `SlashPalette.tsx:57` |

---

## 9. 바꿔야 할 DOM/TSX와 스냅샷 영향

**지킬 것**: 모든 `data-action` id(180개), `role`·`aria-*`, 버튼 글자(테스트가 이름으로 찾음), 키보드 단축키. 아래에서 "글자 변경"은 테스트 문구도 같이 바꿔야 한다.

| 바꿈 | TSX | 영향받는 스냅샷(`apps/web/test/__snapshots__/`) | 영향받는 테스트 |
| --- | --- | --- | --- |
| 아이콘 공통 컴포넌트 + 기호 교체 | `design/icons.tsx`(새), 8.3 표의 파일 | 거의 전부(54개 중 약 45개) — 단계별로 나눠 갱신 | 기호 글자로 찾는 테스트(`getByText('⏸ …')` 등) 확인 필요 |
| 페이지 모드(설정·설치) + `[← 대화로]` | `App.tsx:542-559`, `shell/AppShell.tsx`(사이드바·패널 숨김 prop) | `app.workspace`, `settings.screen.*`(13), `install.manager` | `click-all` 화면 `settings-*`, `install-*` — 새 버튼 id 필요: **`page.back` 추가 제안**(registry + screens.ts) |
| P-01 세션 선택 시 대화로 | `App.tsx`(view 초기화 콜백을 `proj.renderSidebar`에 전달) | 없음(동작) | 새 동작 테스트 1개 |
| 필터 팝오버 | `ProjectSidebar.tsx:321-383` | `projects.sidebar`, `projects.flows` | `shell.filter.test.tsx`, `projects.sidebar.test.tsx` — 팝오버를 연 뒤 찾게. 새 id **`projects.filter-open` 제안** |
| 하단 메뉴 3개(엔진·플러그인·스킬 렌더 안 함) | `shell/types.ts:77-85`, `Sidebar.tsx`, `ProjectSidebar.tsx:385-400` | `shell.sidebar`, `projects.sidebar` | `shell.sidebar.test.tsx:50`(플러그인 비활성 검사) 수정. `nav.engines`는 `ModelButton.tsx` 메뉴 아래로 → `engines.model-button` 스냅샷 |
| 테마 버튼 이동 | `TopBar.tsx:36`, `settings/sections`(일반 탭 덧붙임) | `shell.topbar`, `settings.screen.general` | `theme.test.tsx` |
| 경로·문서 표시를 프로젝트 ▾로 | `WorkspaceBar.tsx` | `shell.topbar`, `app.workspace` | `shell.topbar.test.tsx` |
| 모드·권한 칩 하나 | `Composer.tsx:306-331`, `ChipMenu.tsx`(묶음 2개 지원) | `composer.chips`, `composer.toolbar`, `composer.mode` | `composer.*` 테스트(칩 이름 "권한"으로 찾는 곳) |
| 판정 줄 이동 | `Composer.tsx:387-398` → `panels/Checklist` | `composer.toolbar`, `panels.checklist.*` | `composer.toolbar.test.tsx`(verdict) |
| 보기 모드 드롭다운 | `chat/ChatStream.tsx:19-37` | `chat.render` | 보기 모드 테스트(`role="radio"` 유지하면 영향 작음 — radiogroup을 팝오버 안에) |
| 채팅 승인 → 데려가기 | `chat/BlockView.tsx:85-110` | `chat.render` | `click-all` `chat-blocks` 화면(이제 눌리면 포커스 이동) |
| 체크리스트 확인 카드를 확인 영역에도 | `App.tsx:467`(extra) | `approvals.panel`, `panels.checklist.stages` | `approvals.*` |
| 패널 탭 이름 | `shell/layout-store.ts:5-10` | `app.workspace` 등 탭 포함 스냅샷 | 탭 이름으로 찾는 테스트(Diff·궤적) |
| 설정 묶음 머리글 | `settings/SettingsScreen.tsx:109-125`(+ 묶음 정의는 kernel `SETTING_GROUPS`에 `section` 필드) | `settings.screen.*` 13개 | `settings-coverage`(kernel) 영향 없게 필드만 추가 |
| 빌더 저장·시험 위쪽 바 | `builder/BuilderPage.tsx:184-260`, `inspector/SaveBar.tsx`, `inspector/InspectorPanel.tsx:14-18` | `builder.layout`, `builder.dryrun.stages`, `engines.builder` | `builder.*` 테스트 |
| 탭 모양 통일 | CSS만(`shell.css`, `settings-screen.css`, `install.css`, `builder.css`, `chat.css`) | 없음(스냅샷은 HTML만) | 없음 |

---

## 10. 구현 단계 (작은 커밋, 요청한 순서)

> **전제**: 지금은 T-102 점검 기간(CLAUDE.md 규칙 3·5·11: 제품 코드는 `approved.json` 항목만, 새 기능 금지). 아래는 **배치 바꾸기**이고 새 기능이 아니지만, `lucide-react` 의존성과 TSX 변경이 있으므로 **점검이 끝난 뒤 새 티켓(T-104 "배치 정리" 제안)** 또는 `approved.json` 승인 후 진행한다. 각 커밋은 "검증 묶음"(`pnpm -r build` → `pnpm test` → `pnpm test:features`) + 해당 단계의 `pnpm check:dead-buttons`. CPU 보호를 위해 테스트는 하나씩, `maxWorkers=4`, `nice -n 15`.

| 단계 | 커밋 | 바뀌는 TSX | 갱신할 스냅샷 | 위험 | 확인 방법 |
| --- | --- | --- | --- | --- | --- |
| **0. 먼저 고칠 버그** | 0-1 세션 선택·새 세션 시 대화 화면으로(P-01) | `App.tsx` | 없음 | 낮음 | 새 테스트: 설정 화면 → 세션 클릭 → 입력창 보임. `test:features` |
| **1. 아이콘 공통 컴포넌트** | 1-1 `lucide-react` 추가 + `design/icons.tsx`(이름표·크기 16/20·`aria-hidden`) + 단위 테스트 | `design/icons.tsx`(새), `apps/web/package.json` | 없음 | 낮음(번들 크기 — 개별 import) | `pnpm -r build`, 새 테스트 `design.icons.test.tsx` |
| | 1-2 아이콘만 버튼 8종 규칙 검사 테스트(아이콘만이면 `aria-label`+`title` 필수) | `test/` | 없음 | 낮음 | 새 테스트 |
| **2. 셸 배치** | 2-1 하단 메뉴 3개 + 아이콘(플러그인·스킬 숨김, 엔진 → 모델 메뉴로) | `shell/types.ts`, `Sidebar.tsx`, `ProjectSidebar.tsx`, `engines/ModelButton.tsx` | `shell.sidebar`, `projects.sidebar`, `engines.model-button` | 중(테스트 문구) | `check:dead-buttons`(`nav.engines`가 `model-menu` 화면에서 눌리는지), `shell.sidebar.test` 수정 |
| | 2-2 필터 팝오버(+`projects.filter-open` id) | `ProjectSidebar.tsx`, `actions/registry.ts`, `e2e/screens.ts`(`project-sidebar-menus`에 포함) | `projects.sidebar`, `projects.flows` | 중 | `shell.filter.test`, `check:dead-buttons` |
| | 2-3 "확인 필요" 묶음을 사이드바 맨 위에 + 세션 상태 아이콘 | `ProjectSidebar.tsx`, `shell/projects/model.ts` | `projects.sidebar`, `stages.session-row`, `shell.agent-sessions` | 낮음 | 스냅샷 diff 사람 확인 |
| | 2-4 상단바 정리(테마 → 설정, 경로·문서 → 프로젝트 ▾, 실행 상태 아이콘) | `TopBar.tsx`, `WorkspaceBar.tsx`, `ThemeToggle.tsx`, `settings/sections/*` | `shell.topbar`, `shell.quota`, `app.workspace`, `settings.screen.general` | 중 | `theme.test`, `shell.topbar.test` |
| | 2-4b 처음 켠 화면: 프로젝트 0개면 가운데 "어디서 작업할까요?" + 예시, 상단바 `[프로젝트 고르기 ▾]`(`topbar.project`), 깨진 기호(🔍·⧉) 우선 교체, 입력창 크기 손잡이 끄기(CSS) (P-27~P-31) | `App.tsx`, `shell/projects/useProjectShell.tsx`, `WorkspaceBar.tsx`, `ChatStream.tsx:69,82`, `composer.css:28` | `app.workspace`, `shell.topbar`, `projects.flows`, `chat.render` | 중 | `check:dead-buttons`(`empty-session`·`project-picker`), 캡처 전후 비교 🖐 |
| | 2-5 페이지 모드(설정·설치) + `[← 대화로]`(`page.back` id) | `AppShell.tsx`, `App.tsx`, `registry.ts`, `e2e/screens.ts` | `settings.screen.*`, `install.manager`, `app.workspace` | **높음**(레이아웃 전체) | `check:dead-buttons`, E2E 좁은·넓은 화면 스크린샷 🖐 |
| **3. 입력창** | 3-1 기호 → 아이콘(+·↑·■·📎·▾) | `Composer.tsx`, `StopButton.tsx`, `ChipMenu.tsx`, `PlusMenu.tsx`, `AttachmentChips.tsx`, `attachments.ts`, `SlashPalette.tsx` | `composer.toolbar`, `composer.chips`, `composer.plus-menu`, `composer.slash`, `composer.mobile-picker`, `chat.stopblock` | 낮음 | 스냅샷 diff가 아이콘 태그뿐인지 확인 |
| | 3-2 모드·권한 칩 하나로 | `Composer.tsx`, `ChipMenu.tsx`, `composer/run-mode.ts` | `composer.chips`, `composer.mode`, `composer.toolbar`, `run-mode.badges` | 중(모드 확인 흐름) | `composer.mode.test`, `test:features` F-032 |
| | 3-3 `+` 메뉴 묶음 제목("어디서 일할까요" / "붙이기") | `PlusMenu.tsx` | `composer.plus-menu` | 낮음 | 스냅샷 |
| | 3-4 판정 줄 → 진행 탭, "파일 n개 바뀜" 한 줄 | `Composer.tsx`, `App.tsx`, `panels/Checklist/*` | `composer.toolbar`, `panels.checklist.*` | 중 | `composer.toolbar.test` 수정 |
| | 3-5 보기 모드 드롭다운, 채팅 승인 → "확인하러 가기" | `chat/ChatStream.tsx`, `chat/BlockView.tsx` | `chat.render` | 중 | `check:dead-buttons`(`chat-blocks`) |
| **4. 오른쪽 패널** | 4-1 탭 이름(진행·바뀐 파일·터미널·기록) + 아이콘 + 세그먼트 탭 CSS | `layout-store.ts`, `RightPanel.tsx`, `shell.css` | 탭 포함 스냅샷(`app.workspace` 등) | 중(저장된 탭 순서는 id라 안전) | `layout-store` 테스트 |
| | 4-2 빈 탭 안내 문구 | `RightPanel.tsx:97`, `usePanels.tsx` | 해당 스냅샷 | 낮음 | 스냅샷 |
| | 4-3 체크리스트 단계 확인·계획 승인을 확인 영역에도 | `App.tsx:467`, `panels/Checklist/*` | `approvals.panel`, `panels.checklist.stages` | 중(같은 카드 두 번 답하지 않게) | `approvals.*`, `test:features` F-035 |
| | 4-4 승인 카드 아이콘(✋·①②③) | `ApprovalsArea.tsx`, `ActionCard.tsx`, `MiniApprovalCard.tsx`, `Toasts.tsx` | `approvals.panel`, `approvals.viewport` | 낮음 | 스냅샷 |
| **5. 설정·설치** | 5-1 설정 왼쪽 묶음 목록(머리글 4개, 탭 13 유지) + 탭 아이콘 | `SettingsScreen.tsx`, kernel `SETTING_GROUPS`(필드 추가) | `settings.screen.*` 13개, `settings.engines.*` | 중 | `settings-coverage`, `settings.screen.*` |
| | 5-2 설치 관리 → "도구·AI 설치" 페이지(탭 아이콘, AI 바로가기) | `install/InstallManager.tsx`, `FirstRunCard.tsx`, `InstallPlanCard.tsx` | `install.manager`, `install.card`, `install.resolve-fail` | 낮음 | `install.manager.test` |
| | 5-3 프로젝트 탭·데이터·정보 아이콘 | `settings/sections/*` | `settings.screen.project`, `about` | 낮음 | 스냅샷 |
| **6. 빌더** | 6-1 저장·시험해 보기를 위쪽 바 오른쪽으로 | `builder/BuilderPage.tsx`, `inspector/SaveBar.tsx` | `builder.layout` | 중(초안 있음/없음 두 경우) | `builder.*` 테스트, `check:dead-buttons` `builder-blocks`·`builder-chat` |
| | 6-2 속성 탭 2개 + YAML 고급 접기 | `inspector/InspectorPanel.tsx`, `YamlTab.tsx` | `builder.layout`, `builder.dryrun.stages` | 중 | `builder.*` |
| | 6-3 빌더 기호 → 아이콘(↶↷←💬🎤⧉ 등) + React Flow 어두운 모드 | `BuilderPage.tsx`, `chat/BuilderSidebar.tsx`, `chat/MicButton.tsx`, `lego/*`, `StartChoice.tsx`, `Drawer.tsx`, `draft/*` | `builder.layout`, `forge.cards`, `engines.builder` | 낮음 | 스냅샷 |
| **마감** | 넓은(1280)·좁은(390) 화면 스크린샷 비교 🖐, 쉬운 말 검사기, 전부 눌러 보기 | — | — | — | `pnpm check:dead-buttons`, E2E, `test:features` |

---

## 11. 점수표

| 항목 | 찾음 | 제안으로 해결 | 부분 해결 | 남김 |
| --- | --- | --- | --- | --- |
| 치명 문제 (P-01~P-03) | 3 | 3 | 0 | 0 |
| 큼 문제 (P-04~P-14, P-27, P-28) | 13 | 13 | 0 | 0 |
| 보통 문제 (P-15~P-26, P-29~P-32) | 16 | 14 | 2 (P-20 주소 상태: 설정·설치만 해시 주소 제안, P-21 메뉴 역할: 페이지 모드 때 `<a>`로 — 다음 티켓) | 0 |
| **문제 합계** | **32** | **30 (94%)** | **2 (6%)** | **0** |
| 중복 묶음(3.3) | 9 | 9 정리 방향 제시 | — | — |
| action id 집 배정(6.6) | 180 | 180 (100%) — 새 id 제안 3개(`page.back`, `projects.filter-open`, `topbar.project`) | — | — |
| 아이콘 지정(8.2) | 기호 40종+ | 전부 Lucide 이름 지정 | — | — |
| 제품 비교(5장) | 8개 제품 + Linear | 8 | — | — |
| 메인 화면 첫 선택지 | 28 | 16~17 (약 −40%) | — | — |

| 이 문서 작업 | 완료/전체 | % |
| --- | --- | --- |
| 1. 지금 배치 지도·중복·문제(+ 실제 화면 캡처 관찰 7건) | 1/1 | 100% |
| 2. 주요 일·빈도 | 1/1 | 100% |
| 3. 웹 조사(제품 8 + 원칙 8) | 16/16 | 100% |
| 4. 추천 배치도(넓은·좁은·페이지·빌더) | 4/4 | 100% |
| 5. 간소화·선택지 전후 | 1/1 | 100% |
| 6. 아이콘 체계 | 1/1 | 100% |
| 7. 구현 단계 | 1/1 | 100% |
| 실제 화면에서 P-01 재현 확인 | 0/1 | 0% (빌드·실행 금지 조건 — 다음에 확인) |

---

## 12. 출처

**제품 공식 문서·블로그**
- Claude Code 데스크톱 문서: https://code.claude.com/docs/en/desktop
- Claude Code 데스크톱 새 디자인(2026-04): https://claude.com/blog/claude-code-desktop-redesign
- VS Code 화면 구성: https://code.visualstudio.com/docs/getstarted/userinterface
- VS Code Agents 창: https://code.visualstudio.com/docs/agents/run/agents-window
- VS Code 세션 관리: https://code.visualstudio.com/docs/agents/run/sessions/manage-sessions
- VS Code 승인·권한: https://code.visualstudio.com/docs/agents/approvals
- Cursor 3.0 / 3.1 / 3.4 변경 기록: https://cursor.com/changelog/3-0 · https://cursor.com/changelog/3-1 · https://www.cursor.com/changelog/3-4
- Zed Agent Panel: https://zed.dev/docs/ai/agent-panel
- JetBrains Junie·AI Chat: https://www.jetbrains.com/help/ai-assistant/junie-agent.html · https://www.jetbrains.com/help/ai-assistant/2025.3/ai-chat.html · https://www.jetbrains.com.cn/en-us/help/junie/user-approval.html · https://blog.jetbrains.com/junie/2025/05/what-s-next-for-junie-building-a-smart-and-controllable-ai-coding-agent/
- Windsurf Cascade: https://docs.windsurf.com/windsurf/cascade/cascade · https://docs.devin.ai/windsurf/plugins/cascade/planning-mode · https://windsurf.com/changelog
- Warp 에이전트: https://docs.warp.dev/agents/getting-started/agents-in-warp.md · https://docs.warp.dev/agents/local-agents/code-diffs/ · https://docs.warp.dev/agents/local-agents/interactive-code-review/ · https://docs.warp.dev/agents/autonomy/agent-permissions
- Codex 앱: https://developers.openai.com/codex/app/commands · https://developers.openai.com/codex/app/review · https://learn.chatgpt.com/docs/features · https://learn.chatgpt.com/docs/app
- Linear: https://linear.app/changelog/2024-12-18-personalized-sidebar · https://linear.app/blog/settings-are-not-a-design-failure · https://linear.app/changelog/2026-03-12-ui-refresh

**기사·포럼·이슈 (보조)**
- https://macrumors.com/2026/04/15/anthropic-rebuilds-claude-code-desktop-app
- https://the-decoder.com/new-cursor-3-ditches-the-classic-ide-layout-for-an-agent-first-interface-built-around-parallel-ai-fleets/
- https://forum.cursor.com/t/agent-sidebar-moved-to-the-left-after-latest-update/169390
- https://codex.danielvaughan.com/2026/04/17/codex-app-workspace-pr-review-task-sidebar-artifact-viewer/
- https://claudeissues.com/issue/61421-desktop-no-way-to-dismiss-needs-my-input-indicator-on-a-finished-session

**원칙**
- NN/g 점진적 공개: https://www.nngroup.com/articles/progressive-disclosure/
- NN/g 피츠의 법칙: https://www.nngroup.com/articles/fitts-law/
- NN/g 사용성 10원칙: https://www.nngroup.com/articles/ten-usability-heuristics/
- Apple HIG 툴바·사이드바: https://developer.apple.com/design/human-interface-guidelines/toolbars · https://developer.apple.com/design/human-interface-guidelines/sidebars
- Android/Material 3 적응형 내비게이션: https://developer.android.com/develop/ui/compose/layouts/adaptive/build-adaptive-navigation
- 사람 확인(HITL) 패턴: https://www.kunalganglani.com/blog/tool-approval-patterns-ai-agents · https://agentinterface-co.pages.dev/blog/human-in-the-loop-ux-patterns-production-ai-agents.html
- Lucide: https://lucide.dev/guide/react
- 설치된 스킬: `.claude/skills/frontend-design/SKILL.md`, `.claude/skills/web-design-guidelines/SKILL.md`(Vercel Web Interface Guidelines)

---

## 13. 사용자가 고른 참고: Kiro · open-design

> 조사일 2026-11-13. 공식 문서·README를 읽고, 두 제품 첫 화면을 headless Chromium으로 찍어 직접 봄(`scratchpad/shots/ref-kiro.png`, `ref-od.png`). 코드는 건드리지 않았고 1~12장도 그대로다. 이 장은 6장 배치안에 **더하거나 고칠 것**만 적는다.

### 13.1 Kiro (AWS의 에이전트 IDE)

**(a) 무엇인가** — VS Code를 바탕으로 만든 AWS의 에이전트 코딩 도구. 핵심 생각은 "바로 코드부터 짜지 말고, **요구사항 → 설계 → 할 일 목록**(spec)을 먼저 만들고 사람이 확인한 뒤 짠다". 지금은 IDE 말고도 CLI·웹·휴대폰·"Crew"(여러 봇 관리 앱)까지 있다.

**(b) 화면 구성**

```
┌ 활동 막대 ┬ 왼쪽: Kiro 보기 ─────────┬ 가운데: 편집기(파일 탭) ─────────┬ 오른쪽: 채팅 ─────────────┐
│ 📄 탐색기 │ ▾ Specs        [+]       │  requirements.md                   │ [세션 탭][+][기록][할 일] │
│ 🔍 찾기   │    로그인 기능            │   … 문서 본문 …                    │  Let's build              │
│ ⑂ 소스    │ ▾ Agent Hooks  [+]       │              [Review] (떠 있는 버튼)│  · 도구 카드              │
│ 👻 Kiro   │    저장 시 린트           │  tasks.md                          │  · 변경 묶음 [수락][거절] │
│           │ ▾ Agent Steering [+]     │   ☐ 1. 화면 만들기  (진행 중)      │ ┌ 입력창 ───────────────┐ │
│           │    product · tech · …    │   ☑ 2. 저장 연결   (완료)          │ │ # 맥락  [에이전트▾][모델▾]│
│           │ ▾ MCP Servers  [+]       │                                    │ │ [권한 모드 ▾]       [↑] │
│           │ ▾ Workflows              │                                    │ └───────────────────────┘ │
└───────────┴──────────────────────────┴────────────────────────────────────┴───────────────────────────┘
└ 상태 막대: 브랜치 · 오류 수 · 에이전트 상태 · 이번 질문에 쓴 크레딧 ─────────────────────────────────────────┘
```

- 채팅은 기본이 **보조 사이드바(오른쪽)**. Ctrl+L로 열고 닫는다. 위치는 옮길 수 있다.
- 왼쪽 "Kiro 보기" 한 곳에 **"에이전트가 일하는 방식을 정하는 것"**(Specs·Hooks·Steering·MCP·Workflows)을 모았다. 각 묶음 머리에 `+` 하나.

**(c) 기능별 처리**

| 항목 | Kiro의 방식 |
| --- | --- |
| 세션·채팅 목록 | 채팅 패널 위 **세션 탭** + `+`(새 세션) + **기록(History)** 버튼(찾기·되살리기·지우기). 대화를 오른쪽 클릭 → Markdown으로 내보내기. Crew 앱은 왼쪽 사이드바에 Sessions(안 읽은 수 배지)·Bots·Schedule·Artifacts, 위에 `Local / Remote` 전환, 가운데 위 "⌘K 무엇이든 찾기" |
| 계획·스펙·할 일 | spec 하나 = 파일 3개(`requirements.md` 요구사항, `design.md` 설계, `tasks.md` 할 일). 단계마다 **사람이 확인해야 다음 단계로**(빠른 spec은 이 확인을 건너뜀). `tasks.md`는 할 일마다 진행 중/완료가 실시간 표시. "모두 실행"은 서로 기대지 않는 일끼리 **물결(wave)**로 묶어 동시에 돌린다. 버그용 spec은 "지금 동작 / 바라는 동작 / **바뀌면 안 되는 동작**"을 적는다 |
| 승인·자율 수준 | 입력창 안 **권한 모드 메뉴** 한 곳. ① **Supervised(지켜보기)**: 파일을 고친 차례마다 멈추고 수락/거절을 받음 ② **Accept file changes(파일은 알아서)**: 파일은 묻지 않고 고치되 **명령 실행은 물어봄**(예전 이름 Autopilot) ③ **Approve for me(대신 판단)**: 모델이 안전한 건 허락, 위험한 건 막고, 애매하면 사람에게 물음 → 도구 카드에 "대신 허락함" 표시. 새 채팅의 기본값은 설정 > Agent Autonomy |
| 명령 허락 | `허락 / 거절`(이번만) 또는 `항상 허락 / 항상 거절`(규칙 만들기). 항상을 고르면 **패턴(예: `git add *`)과 범위(모든 작업 폴더 / 이 폴더 / 이 세션)**를 고른다. 이어 붙인 명령은 **하나씩** 따로 묻는다. `git status`·`pwd` 같은 읽기 전용 명령은 묻지 않음 |
| diff 검토 | 바뀐 곳을 **덩어리(hunk)** 단위로 수락·거절·"여기에 대해 묻기"(줄 안 채팅). 파일 단위·전체 수락도 됨. **"모두 수락"은 거절한 파일만 빼고 적용 후 멈춰서 의견을 받음.** "모두 거절"은 되돌리고 다른 방법을 말하게 함. 채팅의 "변경 모두 보기"로 편집기에 diff. **되감기(checkpoint)**로 코드+대화를 예전 시점으로 |
| 설정·지시(steering) | 프로젝트 지시 파일 3개 `product.md`(무엇을 왜)·`tech.md`(쓰는 기술)·`structure.md`(폴더 규칙)를 **[지시 문서 만들어 줘] 버튼 하나**로 자동 생성. 파일마다 "늘 / 이런 파일 만질 때만 / 내가 부를 때만 / 관련 있을 때" 적용 선택. 전체(모든 프로젝트) vs 이 프로젝트 — 충돌하면 프로젝트가 이김 |
| 자동 규칙(hooks) | "파일 저장하면 린트", "할 일 끝나면 테스트" 같은 규칙. **Kiro에게 말로 부탁하면 규칙 파일을 만들어 줌**(`+` → "Kiro에게 만들어 달라기") |
| 처음·빈 화면 | 채팅 빈 화면 "Let's build". 처음 설치 때 VS Code 설정·테마·확장 가져오기. 첫 화면에서 **Vibe(바로 대화) vs Spec(계획부터)** 고르기 |
| 아이콘·보이는 모양 | 유령 마스코트 + 보라색 하나만 강조색, 검은 바탕, 고정폭 글꼴 제목. 메뉴는 **선 아이콘 + 글자**(Sessions·Bots·Schedule·Artifacts). 주 버튼은 보라 채움 하나, 나머지는 테두리 |

**(d) HARNESS-X가 가져올 것 / 피할 것**

| # | 가져올 것 | 붙일 곳(6.6 id) |
| --- | --- | --- |
| K-1 | **"모드·권한" 칩 안 단계를 Kiro처럼 3칸 사다리로 이름 붙이기**: "하나하나 물어봐요(지켜보기) / 파일은 알아서, 명령은 물어봐요 / 안전한 건 알아서". 각 칸 밑에 한 줄 설명. 기본값은 설정 > 모드·권한 | `composer.chip`, `composer.chip-option`, `run-mode.auto-start`, `settings.*`(모드·권한 탭) |
| K-2 | **"항상 허락"에 범위 고르기**(이 세션만 / 이 프로젝트 / 모든 프로젝트) + 이어 붙인 명령은 하나씩 묻기 | `approvals.choose`, `approvals.more` |
| K-3 | **"바뀐 파일" 탭에 파일별 수락·거절 + "모두 수락(거절한 것 빼고)"**. 거절이 하나라도 있으면 에이전트를 멈추고 입력창에 "왜 거절했는지 알려 주세요" 안내 | `panel.tab`(바뀐 파일), `chat.open-diff`, `run-mode.review-action` |
| K-4 | **진행 탭 체크리스트 = Kiro의 `tasks.md`**: 할 일마다 상태 아이콘(대기·진행 중·완료·막힘)과 "이 단계만 실행" 버튼. 계획 승인 카드(`checklist.approve-plan`)는 "계획 보기 → 확인 → 실행" 순서를 한 카드로 | `checklist.toggle`, `checklist.approve-plan`, `run-mode.plan-choose` |
| K-5 | **프로젝트 지시 문서(AGENTS.md·CLAUDE.md)를 "[지시 문서 만들어 줘]" 버튼으로**: 프로젝트 `▾` 팝오버(M-08) 안, 문서가 없을 때만 보임. 쉬운 말 이름 "이 프로젝트 안내문" | M-08 프로젝트 `▾`, `project-settings.*` |
| K-6 | **빈 세션 예시 위에 "바로 시키기 / 계획부터 세우기" 두 갈래** — 초보자는 "계획부터"가 안전 | `empty.example`, `run-mode.plan-choose` |

**피할 것**
- Kiro는 VS Code 위에 올린 개발자 도구라 **활동 막대·편집기 탭·상태 막대**가 다 있다. HARNESS-X 초보자 화면에 편집기 중심 배치를 가져오지 않는다(6.1 원칙 그대로 "가운데 = 대화").
- Specs·Hooks·Steering·MCP를 **왼쪽에 늘 펼쳐 두는 것** — 초보자에겐 뜻 모를 묶음 5개. HARNESS-X는 사이드바에 넣지 않고 설정 "일하는 방식" 묶음·프로젝트 `▾`로 숨긴다(7.1 점진적 공개).
- 권한 모드 이름이 버전마다 바뀜(Autopilot → Accept file changes). **id는 고정하고 글자만 바꾸는** 지금 방식을 지킨다.

**(e) 출처** — https://kiro.dev/ · https://kiro.dev/ide/ · https://kiro.dev/docs/ · https://kiro.dev/docs/ide/editor/interface/ · https://kiro.dev/docs/ide/chat/ · https://kiro.dev/docs/ide/chat/autopilot/ · https://kiro.dev/docs/permissions/ · https://kiro.dev/docs/specs/ · https://kiro.dev/docs/hooks/ · https://kiro.dev/docs/steering/ · https://kiro.dev/changelog/ide/0-10/ · https://kiro.dev/changelog/ide/0-8/

### 13.2 open-design (nexu-io)

**(a) 무엇인가** — 웹 시안·대시보드·발표 자료·이미지·짧은 영상을 **이미 깔려 있는 코딩 에이전트(Claude Code·Codex 등 약 26종)에게 시켜서** 만드는 내 컴퓨터용 오픈소스 작업 공간(Apache 2.0). 자기 AI를 따로 갖고 있지 않고, PATH에 있는 에이전트를 찾아 "엔진"으로 쓴다. 브랜드 규칙은 `DESIGN.md` 하나에 적고, 모든 결과물이 이 파일을 따른다. — **"내 컴퓨터의 에이전트를 찾아서 쓰는 초보자용 작업 공간"이라는 점이 HARNESS-X와 가장 닮았다.**

**(b) 화면 구성** (첫 화면 캡처 + README 화면 설명 기준)

```
[홈]  가운데 큰 입력창 "무엇을 만들까요?" + 예시 카드 + 종류 고르기(랜딩·발표·대시보드·SNS 글)
[모든 프로젝트]  최근 디자인 시스템 · 미디어 · 시안 카드 목록
[스튜디오 = 한 프로젝트 작업 화면]
┌ 왼쪽: 대화·작업 기록 (좁게) ─┬ 오른쪽: 결과 미리보기 (넓게) ─────────────────────────┐
│ 프로젝트 이름                  │ [미리보기 | 코드]  [데스크톱 ▾]     👤👤+5 [🕘][내보내기][공유]│
│ 계획 요약 글                   │                                                          │
│ ✓ 완료 1분 50초                │        (실제로 돌아가는 시안 화면)                       │
│ 🔍 파일 5개 찾음               │        사람별 색 커서·이름표                             │
│ ✓ 성공 56초 · 만든 것 요약     │                                                          │
│ [결과 썸네일 카드]  ● 완료     │                                                          │
│ ┌ 입력창  [+]   [codex ▾] [↑]┐│                                                          │
└──────────────────────────────┴──────────────────────────────────────────────────────────┘
[디자인 시스템]  브랜드(로고·글꼴·색) 페이지 — 에이전트로 다듬기
[플러그인]  기술 목록 + 줄마다 [써 보기]
[설정 > MCP 서버]  "이 에이전트에 붙이려면 이 한 줄" 복사 칸
```

**(c) 기능별 처리**

| 항목 | open-design의 방식 |
| --- | --- |
| 세션·대화 목록 | 대화는 **프로젝트 안**에 묶임(프로젝트·대화·메시지를 SQLite에 저장). 홈 → 모든 프로젝트 카드 → 스튜디오 순서 |
| 계획·할 일 | 흐름이 "요청 → 플러그인 고르기 → **방향 정하기**(브랜드가 없으면 준비된 5가지 방향 중 고르기) → 디자인 시스템 → 결과 → 넘기기 → 기억". 대화 안에 **질문 양식(`<question-form>`)**을 띄워 만들기 전에 필요한 것을 묻는다. 할 일 진행 표시는 로드맵 단계 |
| 승인·자율 | 따로 승인 화면이 없음. 대신 **결과를 내기 전 스스로 5가지 기준으로 채점**(5차원 자기 비평)하는 관문과 "AI 티 나는 결과 막기" 점검표를 둔다. 팀 피드백 → 같은 프로젝트에서 다시 다듬기 |
| 바뀐 것 보기 | 코드 diff 대신 **결과 미리보기**가 주인공. `미리보기 | 코드` 전환, 기기 크기 전환, 기록(🕘) 버튼. 미리보기 전환 때 화면을 다시 불러오지 않아 깜빡이지 않게 함. 일부만 고치는 "댓글 모드" 진행 중 |
| 설정·지시 | 브랜드 규칙 = `DESIGN.md` 한 파일("폴더를 넣으면 고르기 목록이 알아서 찾음"). 에이전트·모델은 **한 번 눌러 바꾸기**. 설정 > MCP 서버는 에이전트별 설치 한 줄을 복사해 주는 식 |
| 처음·빈 화면 | 데스크톱 앱 "Node·pnpm·내려받기 필요 없음". **설치하면 PATH의 에이전트를 자동으로 찾음.** 홈은 "요청을 쓰거나 예시로 시작" + 만들 종류 4개 칩 |
| 아이콘·보이는 모양 | 흰 바탕·검은 주 버튼·형광 연두 강조 하나. 작업 기록 줄마다 **작은 상태 아이콘 + 걸린 시간**(✓ 완료 1분 50초). 사람마다 다른 색 이름표. 상단 오른쪽에 작은 선 아이콘 + 글자 버튼(내보내기·공유) |

**(d) HARNESS-X가 가져올 것 / 피할 것**

| # | 가져올 것 | 붙일 곳(6.6 id) |
| --- | --- | --- |
| O-1 | **작업 기록 줄 = 상태 아이콘 + 한 줄 요약 + 걸린 시간**("✓ 파일 3개 고침 · 42초"). 도구 카드가 접혀 있을 때 이 한 줄만 보이게 — 초보자가 "지금 뭐 하는지" 한눈에 | `chat.tool-toggle`, `chat.mode`("보통" 보기의 기본 모양) |
| O-2 | **에이전트 자동 찾기 결과를 첫 화면에**: "이 컴퓨터에서 Claude·Codex를 찾았어요 → 바로 쓰기" 카드. 없으면 "도구·AI 설치"로 데려가기 | `scan.open-install`, `nav.install`, `model.open` |
| O-3 | **만들기 전 질문 양식** — 요청이 애매하면 채팅 글 대신 **고르기 칸이 있는 작은 양식**(예: "어느 폴더?", "테스트도 만들까요?")을 확인 영역에 카드로 | 확인 영역(`approvals.choose`) + `subagent.*`처럼 입력창 위 확인 |
| O-4 | **빌더 "시험해 보기" 옆에 자기 점검표**(5칸 점수: 목표가 분명한가·도구가 맞나·위험한 권한이 없나 …)를 "시험 결과" 탭에 | `inspector.dry-run`, `inspector.tab` |
| O-5 | **홈 빈 화면의 "종류 고르기" 칩**(고치기 · 새로 만들기 · 설명 듣기 · 정리하기) — 예시 문장보다 먼저 고를 거리 4개 | `empty.example`, `empty.agent`, `where.*` |
| O-6 | 설정 > 도구에서 **"다른 에이전트에 붙이기: 이 한 줄 복사"** 모양(복사 버튼 + 성공 표시) | `install.*`, `settings.*`(도구 탭) |

**피할 것**
- 스튜디오의 "왼쪽 대화 좁게 · 오른쪽 결과 넓게"는 **결과가 그림인 디자인 도구**라 맞는 배치다. HARNESS-X는 결과가 코드·체크리스트라 6.2의 "가운데 대화 · 오른쪽 확인" 3열을 유지한다.
- 승인 화면이 없는 점(자기 채점만 믿음)은 따라 하지 않는다 — HARNESS-X는 파일·명령을 직접 건드리므로 확인 영역이 핵심.
- 홈 화면의 큰 그림·그라데이션·광고 띠("친구 초대")처럼 **꾸밈이 많은 첫 화면** — 초보자 작업 도구에는 소음.
- 플러그인 277개·디자인 시스템 151개를 **한 목록에 다 보여 주는 것** — HARNESS-X 도구 설치 페이지는 "추천 몇 개 + 찾기"로.

**(e) 출처** — https://github.com/nexu-io/open-design · https://raw.githubusercontent.com/nexu-io/open-design/main/README.md · https://github.com/nexu-io/open-design/blob/main/docs/architecture.md · https://github.com/nexu-io/open-design/blob/main/QUICKSTART.md · https://open-design.ai/

### 13.3 두 제품이 같이 말해 주는 것

1. **"계획 먼저, 확인 후 실행"이 초보자에게 안전한 기본값**이다(Kiro spec 단계 확인 · open-design 질문 양식·방향 고르기). HARNESS-X의 체크리스트·계획 승인이 이미 이 길 — 더 앞(빈 화면)에서 고르게 하면 된다.
2. **자율 수준은 입력창 안 메뉴 하나**(Kiro). 6.6의 "모드·권한 칩 하나"(M-07) 방향이 맞다는 확인.
3. **진행 표시는 "상태 아이콘 + 짧은 글 + 시간"**(두 제품 모두). 8장의 상태 아이콘 규칙(CircleDot·CircleCheck …)에 "걸린 시간"만 더하면 된다.
4. **강조색은 하나**(Kiro 보라, open-design 연두). 8.1 "대담함은 한 곳" 규칙과 같음.

### 13.4 기존 제안에서 바뀌거나 더해지는 것

| 바뀜·더함 | 이유 | 10장 어느 단계 |
| --- | --- | --- |
| "모드·권한" 칩 팝오버를 **3칸 사다리**(하나하나 물어봐요 / 파일은 알아서·명령은 물어봐요 / 안전한 건 알아서) + 한 줄 설명으로 | Kiro 권한 모드가 초보자에게 "얼마나 맡길지"를 한 줄로 설명 (K-1) | 3-2 |
| "항상 허락"에 **범위 고르기**(이 세션 / 이 프로젝트 / 모든 프로젝트) + 이어 붙인 명령 하나씩 묻기 | 실수로 너무 넓게 허락하는 것 막기 (K-2) | 4-4 (카드 모양) — 동작은 새 티켓 |
| "바뀐 파일" 탭에 **파일별 수락·거절 + "거절한 것 빼고 모두 수락"**, 거절 시 멈추고 이유 묻기 | Kiro 검토 흐름 — diff를 보기만 하는 탭에서 "답하는 곳"으로 (K-3) | 4-1 다음에 4-1b로 추가(새 기능이라 승인 필요) |
| 진행 탭 할 일 줄에 **상태 아이콘 + 걸린 시간**, "이 단계만 실행" | Kiro tasks.md · open-design 작업 기록 (K-4, O-1) | 4-2 |
| 채팅 도구 카드 접힘 모양 = "✓ 한 줄 요약 · 시간" | 지금 뭐 하는지 한눈에 (O-1) | 3-5 |
| 빈 세션에 **"바로 시키기 / 계획부터" 두 갈래 + 종류 칩 4개** | 초보자는 계획부터가 안전, 고를 거리를 먼저 (K-6, O-5) | 2-4b |
| 빈 화면에 **"찾은 AI" 카드**(자동 찾기 결과 → 바로 쓰기 / 설치로) | open-design 자동 찾기 (O-2) | 2-4b |
| 프로젝트 `▾` 팝오버에 **"[이 프로젝트 안내문 만들어 줘]"**(AGENTS.md 없을 때만) | Kiro steering 자동 생성 (K-5) | 2-4 |
| 애매한 요청 때 **질문 양식 카드**를 확인 영역에 | open-design question-form (O-3) | 4-3 다음(새 기능 — 승인 필요) |
| 빌더 "시험 결과" 탭에 **5칸 자기 점검표** | open-design 5차원 자기 비평 (O-4) | 6-2 |
| 도구 설치 페이지 **"다른 에이전트에 붙이기: 한 줄 복사"** | open-design MCP 설치 한 줄 (O-6) | 5-2 |

> 표의 "새 기능 — 승인 필요" 항목(K-2 동작, K-3, O-3)은 배치 바꾸기가 아니라 기능 추가다. T-102 점검 기간 규칙대로 `approved.json` 승인 또는 다음 티켓에서만 진행한다.

| 13장 작업 | 완료/전체 | % |
| --- | --- | --- |
| Kiro 조사(문서 12쪽 + 첫 화면 캡처) | 1/1 | 100% |
| open-design 조사(README·구조 문서 + 첫 화면 캡처) | 1/1 | 100% |
| 가져올 것 (Kiro 6 · open-design 6) — 6.6 id 연결 | 12/12 | 100% |
| 바뀜·더함 표 → 10장 단계 연결 | 11/11 | 100% |
| Kiro IDE 실제 화면 직접 확인(설치해서 보기) | 0/1 | 0% (설치·실행 안 함 — 문서·캡처로만) |
