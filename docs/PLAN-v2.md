
# HARNESS-X 최종 계획서 v2 — 작업 티켓

·

## 요약

이 문서는 Claude Code CLI에 그대로 넘겨 구현시키는 최종 작업 지시서다. 티켓 55개(EPIC 0~6), 원자 체크리스트 281개로 구성했다. 각 항목에는 검증 명령이 붙어 있다. 설계 근거는 v1 계획서에 있고, 여기서는 결론과 실행 단위만 다룬다.

### v2에서 바뀐 것

#

요청

반영 내용

위치

1

체크리스트 판정이 하네스/모바일 vs ai/mobile에서 실패

근본원인 연구 + 5단 판정 사다리 추가: 정규화 → 별칭 사전 → 내용 증거 → 의미 판단 AI(사용자 설정 AI → 로컬 LLM → 구독 엔진) → 사람. 쓰기 시점 조기 감지 훅 추가

연구 섹션, EPIC 2

2

입력창 왼쪽 아래 + 버튼 → Windows 탐색창 → 프로젝트 폴더 선택

디자인 컨셉 A·B + 네이티브 폴더 대화상자 티켓(브라우저 모드·데스크톱 모드 둘 다)

컨셉 A·B, EPIC 3

3

"에이전트 만들기 / 레고 / 플러그인 단독 에이전트 / 슬래시 호출" 누락 지적

v1의 "요구6" 섹션에 글로는 있었지만 그림이 없어 눈에 띄지 않았다. v2에서는 디자인 컨셉 C·D를 따로 그리고, 전용 EPIC 4(티켓 9개)로 분리했다

컨셉 C·D, EPIC 4

4

티켓과 함께 디자인 컨셉도 그림으로

화면 4종 와이어프레임 + 아키텍처·판정 사다리·폴더 선택 흐름 그림

컨셉 A–D

### 변하지 않은 핵심 결론

- 루프·상태·체크리스트는 하네스가 소유하고, Claude Code·Codex·Antigravity·로컬 LLM은 갈아끼우는 엔진 플러그인으로 둔다.
- 구독(월정액)은 공식 바이너리를 수정 없이 자식 프로세스로 실행하는 방식으로만 쓴다. 토큰은 읽지도 저장하지도 않는다. API 키는 OS 키체인에 둔다.
- 체크리스트는 디스크 원장에 둔다. 계획이 없으면 쓰기가 잠기고, 증거가 없으면 완료 처리되지 않으며, 미완료 항목이 있으면 종료가 차단된다.
- 스택은 TypeScript(Node 22) pnpm 모노레포 + React 웹 UI + Tauri 2 데스크톱 포장이다.

## Claude Code CLI에 맡기는 방법

HARNESS-X가 아직 없으므로, 만드는 동안에는 Claude Code 자체 훅으로 같은 원칙을 미리 적용한다(dogfooding). 티켓 하나가 끝날 때까지 Claude Code가 멈추지 못하게 하는 방식이다.

### 1회 준비 (사람이 직접)

- 이 문서를 Markdown으로 내보내 저장소의 docs/PLAN-v2.md에 넣는다(문서 메뉴에서 다운로드).
- 아래 CLAUDE.md를 저장소 루트에 둔다.
- 아래 Stop 훅과 scripts/ticket-gate.mjs를 넣는다. 첫 티켓 T-000이 이 파일들을 자동으로 만들기 때문에, 사람은 T-000만 직접 지시하면 된다.
- 이후 지시는 한 줄이면 된다: docs/PLAN-v2.md의 다음 미완료 티켓을 진행해.

### CLAUDE.md 템플릿

```markdown
# HARNESS-X 작업 규칙
- 계획서: docs/PLAN-v2.md. 티켓은 T-번호 순서대로, 의존(deps)이 끝난 것만 시작.
- 시작 시: docs/tickets/T-xxx.md를 만들고 티켓의 체크리스트를 그대로 복사, 맨 위에 `status: doing`.
- 항목 하나 = 커밋 하나. 커밋 메시지: `T-xxx/항목번호: 요약`.
- 항목 완료 조건: 항목 끝의 검증 명령을 실제 실행하고 결과(종료코드·요약)를 항목 아래에 붙인 뒤 [x].
- 검증 명령이 실패하면 [x] 금지. 3회 실패 시 `blocked: 사유` 기록 후 사람에게 질문.
- 체크리스트에 없는 일은 하지 않는다. 필요하면 티켓 파일 맨 아래 `제안:`에 적고 멈춘다.
- 경로·이름은 티켓에 적힌 그대로 사용(한글 경로 금지, 모두 영문 kebab-case).
- 수동 확인 항목(🖐)은 스크린샷 경로를 남기고 `awaiting-human`으로 둔다.
- 티켓의 모든 항목이 [x]면 `status: done`, 다음 티켓으로.
```

### 티켓 게이트 훅 (.claude/settings.json)

```json
{
  "hooks": {
    "Stop": [{ "hooks": [{ "type": "command", "command": "node scripts/ticket-gate.mjs" }] }]
  }
}
```

ticket-gate.mjs는 status: doing인 티켓 파일에 - [ ]가 남아 있으면 남은 항목 목록을 stderr에 쓰고 종료코드 2로 끝난다. Claude Code는 Stop 훅의 종료코드 2를 "멈추지 말고 계속하라"로 처리한다. 무한 반복을 막기 위해 입력의 stop_hook_active가 true이고 마지막 실행과 남은 항목 수가 같으면 0으로 통과시킨다. 그러면 사람에게 넘어간다.

### 티켓 읽는 법

- 머리줄: T-번호 제목 · deps(먼저 끝나야 할 티켓) · 산출물 경로.
- 체크리스트 각 줄: [번호] 할 일 — 검증: 명령 또는 기준.
- 🖐 = 사람 눈으로 확인할 항목(UI 등). 나머지는 모두 명령으로 검증한다.
- 모든 경로는 저장소 루트 harness-x/ 기준이다.

## 연구: 체크리스트 판정이 "하네스/모바일 vs ai/mobile"에서 실패하는 이유

결론: 문제의 원인은 판정이 너무 엄격해서가 아니다. 판정이 "문자열 하나"만 보고, 그마저 끝에 가서야 보기 때문이다. 그렇다고 판정을 느슨하게 하면 진짜 잘못(엉뚱한 폴더에 쓴 경우)까지 통과한다. 해법은 세 가지다. 판정을 사다리로 나누고, 어긋남을 쓰는 순간 잡고, 한 번 인정한 동치는 사전에 저장해 다시 묻지 않는다. 의미를 판단하는 AI는 이 사다리의 4번째 칸으로 넣으면 맞다. 사다리 그림은 아래에 있다.

### 근본원인 4가지

#

원인

예

결과

1

체크리스트가 산출물을 경로 문자열로 식별한다

항목은 하네스/모바일, 에이전트는 ai/mobile에 만듦

내용이 맞아도 실패

2

정규화가 없다

한글 NFC/NFD(맥·깃 차이), \ vs /, C:\ vs /mnt/c/(WSL), 대소문자, 끝 슬래시

같은 파일인데 다른 문자열

3

이름 정책이 없다

계획 단계에서 한글 이름을 쓰고, 구현 엔진은 영문 관례로 번역함

엔진마다 다른 이름이 나옴

4

검증이 끝에서만 일어난다

30개 파일을 다 쓴 뒤 경로가 다르다는 걸 발견함

되돌리는 비용이 큼, 실패 판정만 남음

### 해법 1 — 산출물 ID와 경로 원장(Path Manifest)

체크리스트 항목은 경로가 아니라 산출물 ID(예: art.mobile-app)를 참조한다. 계획이 잠기는(Lock) 시점에 manifest.json이 ID → 정식 경로를 한 번에 확정한다. 이름 정책도 함께 정한다. 기본은 "파일·폴더는 영문 kebab-case, 표시 이름은 한글"이다. 그래서 하네스/모바일은 표시 이름이 되고, 실제 경로는 harness/mobile이 된다. 엔진은 표시 이름이 아니라 정식 경로만 받는다.

### 해법 2 — 5단 판정 사다리

위에서부터 순서대로 내려가고, 확정되는 칸에서 멈춘다. 대부분은 1~3칸에서 끝나므로 모델 호출 비용이 거의 들지 않는다.

- 정규화 (코드, 0원) — Unicode NFC, 구분자 통일, WSL↔Windows 변환(wslpath), 대소문자(Windows), realpath. 같아지면 통과.
- 별칭 사전 (코드, 0원) — 프로젝트 glossary.json에 등록된 동치(예: 하네스 ⇄ harness, 모바일 ⇄ mobile)로 치환 후 비교. 같아지면 통과.
- 내용 증거 (코드, 0원) — 경로가 달라도, 항목의 acceptance(테스트·스키마·심볼 존재)를 후보 경로에서 실행해 본다. 후보는 이번 세션 이벤트 로그의 file_change 중 이름·내용이 비슷한 것에서 고른다. 통과하면 "위치만 다름"으로 분류해 4칸으로 넘긴다.
- 의미 판단 AI (T-100: 사용자가 설정한 AI → 로컬 LLM(Ollama, 무료) → 로그인된 구독 엔진, 유료 API 기본 호출 없음) — 타입이 정해진 질문 2개를 보낸다. 하나는 "같은 산출물인가"(확률 0~1), 다른 하나는 "어긋남 종류"(동치 / 허용 가능한 이동 / 잘못된 대상 / 누락 중 택1)다. 확률 0.9 이상이면 자동으로 인정하고 별칭 사전에 추가한다. 0.6~0.9이면 5칸으로, 0.6 미만이면 실패로 처리한다.
- 상위 검증 (다른 엔진 LLM 또는 사람) — 승인 카드에 "예상 경로 / 실제 경로 / 판정 근거"를 보여주고 [동치 인정] [이동 승인] [실패] 중 하나를 고른다. 사람이 고른 답도 사전에 기록한다.

예시 “하네스/모바일 vs ai/mobile”은 이렇게 처리된다. ai는 glossary에 없으므로 L2를 지나 L3에서 내용을 확인하고, L4에서 동치인지 이동인지 판정한다. 사람이 한 번 고르면 사전에 기록되므로, 다음부터는 L2에서 끝난다.

### 해법 3 — 쓰는 순간 잡기 (조기 감지 훅)

tool.before에서 쓰기 대상이 manifest에 없는 경로라면, 1~2칸(정규화·별칭)만 즉시 돌린다. 매칭되면 정식 경로로 바꿔서 쓰게 한다. 매칭이 안 되면 그 자리에서 엔진에게 "manifest의 art.mobile-app 경로는 harness/mobile이다"라고 되돌려 준다. 끝에서 실패하는 대신 첫 파일에서 바로잡는 것이 진짜 근본 해법이다.

### 판정 AI 선택 (T-100에서 변경)

- 처음에는 외부 유료 판정 서비스를 4칸에 두었으나, T-100(2026-11-11)에서 완전히 삭제했다. 코드·설정·키·테스트·문서·네트워크 호출이 남지 않는다.
- 대신 모든 검증은 비교기(정규화 → 사전)를 먼저 거치고, 의미 판단이 필요할 때만 ① 사용자가 설정한 AI(`judge.engine`) → ② 로컬 LLM(Ollama) → ③ 로그인된 구독 엔진 → ④ 사용자 승인 카드 순서로 넘긴다.
- 판정 AI는 산술·개수 세기·날짜 비교에 약하므로 결정적 변환(정규화·별칭·내용 검증)은 앱 코드에서 먼저 처리한다.
- 데이터: 판정 AI에는 경로·파일명·심볼 목록·항목 제목 같은 메타데이터만 보내고 소스 코드는 보내지 않는다.
- 교체 가능성: 판정기는 verifier 슬롯 플러그인이다. 오프라인이거나 민감한 프로젝트라면 로컬 LLM(Ollama의 JSON 스키마 출력)으로 같은 질문 형식을 대체한다. 엔진 중립 원칙을 판정기에도 그대로 적용한다.

## 아키텍처 요약

v1과 구조는 같다. 다른 점은 두 가지다. 코어에 판정 사다리 verifier-ladder가 체크리스트 원장과 함께 강조돼 있고, 각 층에 담당 EPIC을 표시했다.

아래에서 위로 만든다. EPIC 0(커널)과 EPIC 1(엔진)이 바닥이고, EPIC 2(체크리스트·판정)가 그 위에 올라간다. UI와 에이전트 빌더는 마지막에 얹는다.

## 디자인 컨셉 A — 메인 화면과 + 버튼

v1 화면에 두 가지를 더했다. 하나는 입력창 왼쪽 아래의 + 버튼(강조색 원형)이고, 다른 하나는 채팅에 뜨는 경로 교정 카드(초록)다. 상단 바에는 현재 프로젝트 이름과 실제 경로·브랜치가 항상 보인다. 담당 티켓은 T-031, T-033, T-034, T-036이다.

입력창 아래 줄 순서는 고정이다: + → 엔진 칩 → 인증 칩(구독/API) → 권한 칩 → (오른쪽 끝) 전송. 오른쪽 아래의 판정 줄에서는 항목이 사다리 몇 번째 칸에서 통과했는지 확인할 수 있다.

## 디자인 컨셉 B — 프로젝트 폴더 선택 흐름

사용자가 보는 화면은 세 단계다: + 메뉴 → Windows 탐색창 → 상단 바 갱신. 뒤에서는 하네스 서버가 대화상자를 띄우고, 경로를 변환·검증한 뒤 등록한다. 담당 티켓은 T-034, T-035, T-063이다.

선택한 폴더는 세 가지로 쓰인다. 새 세션의 작업 폴더(cwd), permission-gate의 쓰기 허용 경계, 그리고 manifest 정식 경로의 기준 루트다. 폴더를 바꾸면 이 세 가지가 함께 바뀐다.

## 디자인 컨셉 C — 메뉴 "에이전트 만들기"

요청 문장을 화면으로 옮기면 다음과 같다. 플러그인(점선 틀) = 파이프라인이고, 그 안의 역할 노드 = 세부 담당이며, 노드 안의 칩 = 끼워 넣은 스킬이다. 왼쪽 서랍에서 블록을 끌어다 놓으면 끼워지고, 칩의 ×를 누르거나 밖으로 끌어내면 빠진다. 점선 틀을 잡으면 플러그인이 통째로 움직이고, 떼어내면 다른 에이전트에 붙일 수 있다. 담당 티켓은 T-044, T-045, T-046이다.

색으로 종류를 구분한다. 파란 돌기(스터드)는 스킬 블록, 주황 돌기는 엔진 블록이다. 노드마다 엔진이 다를 수 있다(예: 계획은 Claude, 구현은 Codex, 검증은 Antigravity). 플러그인 하나만 캔버스에 놓고 저장해도 그 자체로 에이전트가 된다(T-043).

## 디자인 컨셉 D — 입력창 / 에이전트 호출

입력창 맨 앞에 /를 치면 입력창 바로 위에 팔레트가 뜬다. 팔레트는 에이전트, 플러그인 단독 에이전트, 내장 명령 세 묶음으로 나뉘고, 한글 초성으로도 검색된다. 고르면 에이전트가 칩으로 고정되고, 이어 지시를 입력해 전송하면 사이드바에 현재 노드와 진행률이 표시된다. 담당 티켓은 T-047, T-048이다.

에이전트 만들기(컨셉 C)에서 저장하면 3초 안에 이 목록에 나타난다. 메뉴로 만들고 /로 부르는 흐름이 하나로 이어진다.

## 티켓 EPIC 0 — 기반 커널

목표: 빈 플러그인 1개가 로드되고, 핫리로드되고, 로컬 API로 조회되는 상태. 이후 모든 것이 이 위에 올라간다.

### T-000 작업 게이트 부트스트랩

deps: 없음 · 산출물: CLAUDE.md, .claude/settings.json, scripts/ticket-gate.mjs, docs/tickets/

- 0.1 git init 후 .gitignore(node_modules, dist, .harness-x-dev) 작성 — 검증: git status 정상 출력
- 0.2 "Claude Code에 맡기는 방법" 섹션의 CLAUDE.md 내용을 루트에 그대로 생성 — 검증: test -f CLAUDE.md
- 0.3 scripts/ticket-gate.mjs 작성: docs/tickets/*.md 중 status: doing 파일의 - [ ] 개수를 세어 0이 아니면 목록을 stderr에 쓰고 exit 2 — 검증: 미완료 샘플 티켓으로 실행 시 종료코드 2
- 0.4 같은 스크립트에 stdin JSON의 stop_hook_active가 true이고 남은 수가 직전 실행(.harness-x-dev/gate-last.json)과 같으면 exit 0 처리 — 검증: 두 번 연속 실행 시 두 번째 종료코드 0
- 0.5 .claude/settings.json에 Stop 훅 등록 — 검증: node -e 로 JSON 파싱 성공
- 0.6 docs/tickets/T-000.md를 만들어 이 티켓을 기록하고 status: done — 검증: 게이트 스크립트 실행 시 exit 0

### T-001 모노레포 골격

deps: T-000 · 산출물: package.json, pnpm-workspace.yaml, tsconfig.base.json, vitest.config.ts

- 1.1 pnpm init + pnpm-workspace.yaml(packages/*, packages/*/*, apps/*) — 검증: pnpm -v ≥ 9, 파일 존재
- 1.2 Node 버전 고정 .nvmrc=22, engines.node=">=22.19" — 검증: node -v 22.x
- 1.3 tsconfig.base.json(strict, NodeNext, ES2023) — 검증: pnpm tsc -p tsconfig.base.json --noEmit exit 0
- 1.4 Vitest 루트 설정 + pnpm test 스크립트 — 검증: 빈 테스트 1개 통과
- 1.5 ESLint flat config + Prettier — 검증: pnpm lint exit 0
- 1.6 빈 패키지 생성: packages/protocol, packages/kernel, packages/sdk — 검증: pnpm -r build exit 0

### T-002 protocol: HarnessEvent 타입

deps: T-001 · 산출물: packages/protocol/src/events.ts

- 2.1 공통 필드 타입 EventBase{id, ts, sessionId, engineId?, itemId?} — 검증: 타입 테스트 통과
- 2.2 유니온 정의: assistant_text | tool_call | tool_result | file_change | usage | error | turn_end | approval_request | checklist_change — 검증: expectTypeOf 테스트 9종
- 2.3 각 이벤트의 Zod 스키마 작성 — 검증: 정상 샘플 9개 parse 성공, 잘못된 샘플 9개 실패
- 2.4 Zod → JSON Schema 생성 스크립트(schemas/events.schema.json) — 검증: 파일 생성·유효한 JSON

### T-003 protocol: 플러그인 매니페스트 스키마

deps: T-002 · 산출물: packages/protocol/src/manifest.ts

- 3.1 슬롯 열거형 engine|tool|skill|hook|verifier|pipeline|panel|memory|command — 검증: 타입 테스트
- 3.2 harness-plugin.json Zod 스키마(id, version, apiVersion, provides, requires, permissions, configSchema) — 검증: 샘플 3종 통과
- 3.3 권한 스키마(fs: workspace:read/write, net: 도메인 배열, shell: bool) — 검증: 잘못된 권한 문자열 거부 테스트
- 3.4 examples/plugins/hello/harness-plugin.json 작성 — 검증: 스키마 검증 통과

### T-004 kernel: 이벤트 로그

deps: T-002 · 산출물: packages/kernel/src/event-log.ts

- 4.1 세션별 events.jsonl append 함수(원자적 쓰기, 한 줄 한 이벤트) — 검증: 1,000개 쓰기 후 줄 수 일치
- 4.2 재생(replay) 이터레이터 — 검증: 기록한 것과 재생한 것이 깊은 비교로 일치
- 4.3 SQLite 인덱스(sessionId, type, itemId, ts) — 검증: itemId 조회 테스트
- 4.4 비밀 마스킹 필터(API 키 패턴 sk-, AIza 등) 쓰기 전 적용 — 검증: 키가 포함된 이벤트 기록 후 파일 grep 0건
- 4.5 1만 이벤트 쓰기·재생 성능 테스트 — 검증: 3초 이내

### T-005 kernel: 훅 버스

deps: T-004 · 산출물: packages/kernel/src/hooks.ts

- 5.1 훅 이름 열거: session.start, prompt.submit, tool.before, tool.after, turn.end, stop.before, context.compact, item.verify — 검증: 타입 테스트
- 5.2 차단형 훅 실행(결과 allow|deny|block + reason, 첫 deny/block에서 중단) — 검증: deny 반환 시 호출자가 deny 수신
- 5.3 알림형 훅 비동기 실행(실패해도 본 흐름 계속) — 검증: 예외 던지는 훅이 있어도 본 흐름 완료
- 5.4 훅 타임아웃(기본 10초) — 검증: 20초 걸리는 훅이 10초에 타임아웃 기록
- 5.5 모든 훅 결과를 이벤트 로그에 기록 — 검증: 로그에 hook 결과 존재

### T-006 kernel: 플러그인 로더

deps: T-003, T-005 · 산출물: packages/kernel/src/loader.ts

- 6.1 탐색: ~/.harness-x/plugins, <workspace>/.harness-x/plugins, packages/plugins-core — 검증: hello 플러그인 발견
- 6.2 매니페스트 검증 실패 시 거부 사유 기록 — 검증: 깨진 매니페스트 거부 로그
- 6.3 의존성 위상정렬·순환 거부 — 검증: 순환 샘플 거부
- 6.4 activate/deactivate 생명주기 호출 — 검증: hello가 activate 로그 출력
- 6.5 슬롯 최소 1개 규칙(코어 비우기 금지) — 검증: 마지막 engine 비활성 시도 거부
- 6.6 plugins.lock(id, version, sha256) 생성·대조 — 검증: 파일 변조 시 로드 거부

### T-007 kernel: 핫리로드

deps: T-006 · 산출물: packages/kernel/src/hot-reload.ts

- 7.1 플러그인 폴더 파일 감시(chokidar, 300ms 디바운스) — 검증: 파일 저장 이벤트 수신
- 7.2 변경 시 deactivate → 재검증 → activate — 검증: hello 버전 문자열 변경이 3초 안에 반영
- 7.3 재활성화 실패 시 이전 버전 유지 — 검증: 깨진 수정 후에도 이전 버전 동작

### T-008 kernel: 로컬 API 서버

deps: T-006 · 산출물: packages/kernel/src/api/

- 8.1 Fastify 서버 127.0.0.1:3790 바인딩(외부 바인딩 금지) — 검증: 0.0.0.0 설정 시 기동 거부
- 8.2 실행마다 랜덤 세션 토큰 생성, ~/.harness-x/run/token 저장(권한 600) — 검증: 토큰 없는 요청 401
- 8.3 GET /api/plugins — 검증: hello 포함 목록 반환
- 8.4 WebSocket /ws/events로 이벤트 스트리밍 — 검증: 이벤트 1개 발행 시 클라이언트 수신
- 8.5 harness-x CLI 진입점(harness-x serve) — 검증: 실행 후 API 응답

## 티켓 EPIC 1 — 엔진 자동 인식과 구독/API

목표: 같은 프롬프트를 Claude Code·Codex·Antigravity·로컬 LLM에서 실행해 동일한 HarnessEvent 형식으로 수집한다. 구독 모드에서는 토큰 파일을 절대 읽지 않는다.

### T-010 engine-scanner: PATH 탐지

deps: T-006 · 산출물: packages/plugins-core/engine-scanner/

- 10.1 대상 목록 상수: claude, codex, agy, gemini, opencode, cursor-agent, qwen, dsh, claude-agent-acp, codex-acp — 검증: 단위 테스트
- 10.2 Windows where / Unix which로 경로 탐지 — 검증: 설치된 CLI 경로 반환(모킹 테스트 + 실제 1회)
- 10.3 --version 실행·파싱(5초 타임아웃) — 검증: 버전 문자열 추출 테스트
- 10.4 엔진별 최소 지원 버전 표와 비교 — 검증: 낮은 버전에 outdated 표시
- 10.5 결과를 ~/.harness-x/engines.json에 캐시 — 검증: 파일 생성·스키마 통과

### T-011 engine-scanner: WSL 탐지

deps: T-010 · 산출물: engine-scanner/src/wsl.ts

- 11.1 wsl -l -q 출력(UTF-16LE) 디코딩해 배포판 목록 — 검증: 샘플 바이트 디코딩 테스트
- 11.2 배포판별 wsl -d <배포판> -e sh -lc "command -v claude codex agy" — 검증: WSL 안 CLI에 location: wsl:<배포판>
- 11.3 Windows/WSL 둘 다 있으면 두 항목으로 표시 — 검증: 결과에 2개 항목

### T-012 engine-scanner: 로컬 LLM 프로브

deps: T-010 · 산출물: engine-scanner/src/probes/

- 12.1 Ollama GET :11434/api/tags — 검증: 모킹 서버로 모델 목록 파싱
- 12.2 LM Studio GET :1234/v1/models — 검증: 모킹 테스트
- 12.3 llama.cpp :8080/v1/models, vLLM :8000/v1/models, Jan :1337/v1/models — 검증: 모킹 테스트 3종
- 12.4 프로브 타임아웃 800ms·병렬 실행 — 검증: 전 포트 닫힘 상태에서 1초 이내 완료
- 12.5 시작 시 1회 + 30분 주기 + API POST /api/engines/rescan — 검증: 재스캔 호출 시 캐시 갱신

### T-013 인증 모드와 키체인

deps: T-010 · 산출물: packages/kernel/src/secrets.ts, engines-settings.yaml

- 13.1 OS 키체인 저장/조회/삭제(@napi-rs/keyring) — 검증: 저장 후 조회 일치, 삭제 후 없음
- 13.2 엔진별 설정 스키마 {mode: subscription|apiKey, model, fallback} — 검증: 스키마 테스트
- 13.3 apiKey 모드: 실행 시 환경변수로만 주입(ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY) — 검증: 자식 프로세스 env에 존재, 디스크 파일 grep 0건
- 13.4 subscription 모드: 위 환경변수를 제거한 env로 실행(키가 우선 적용되는 사고 방지) — 검증: env에 키 없음
- 13.5 로그인 상태 조회: codex login status, codex app-server account/read; 상태 명령이 없으면 unknown — 검증: 모킹 출력 파싱 테스트
- 13.6 토큰 파일 접근 금지 가드: ~/.claude/.credentials*, ~/.codex/auth.json 등 경로 읽기 시 예외 — 검증: 읽기 시도 테스트가 예외

### T-014 claude-code 어댑터

deps: T-013 · 산출물: packages/engines/claude-code/

- 14.1 실행 인자 빌더: -p --output-format stream-json --verbose --permission-mode <모드> --model <모델> — 검증: 인자 스냅샷 테스트
- 14.2 stream-json 줄 파서 → HarnessEvent 매핑 — 검증: 녹화된 샘플 3개 리플레이 일치
- 14.3 세션 ID 수집·--resume <id> 재개 — 검증: 2턴 연속 실행에서 같은 세션 이어짐(실제 1회)
- 14.4 하네스 MCP 서버 연결 인자 --mcp-config 주입 — 검증: 도구 목록에 checklist.* 표시
- 14.5 한도 초과·인증 오류 메시지 분류(quota_exceeded, auth_required) — 검증: 샘플 오류 분류 테스트
- 14.6 interrupt(프로세스 그룹 종료) — 검증: 실행 중 중단 시 2초 내 종료

### T-015 codex 어댑터

deps: T-013 · 산출물: packages/engines/codex/

- 15.1 codex app-server stdio JSON-RPC 클라이언트(initialize/initialized 핸드셰이크) — 검증: 핸드셰이크 테스트
- 15.2 턴 실행 알림 → HarnessEvent 매핑 — 검증: 녹화 리플레이 일치
- 15.3 account/rateLimits/read로 쿼터 조회(모델 호출 없음) — 검증: usage 이벤트 생성
- 15.4 폴백 경로: codex exec --json NDJSON 파서 — 검증: 샘플 리플레이
- 15.5 sandbox 매핑(read-only / workspace-write / danger-full-access) — 검증: 권한 모드별 인자 테스트

### T-016 antigravity 어댑터

deps: T-013 · 산출물: packages/engines/antigravity/

- 16.1 agy -p <프롬프트> --model --mode 실행 — 검증: 인자 스냅샷
- 16.2 출력 파서 + AGY_ERROR: {...} 구조화 에러 파싱 — 검증: 에러 샘플 분류
- 16.3 네이티브 훅 없음 표시 capabilities.nativeStopHook=false — 검증: 체크리스트 엔진이 하네스 측 재주입 경로 선택
- 16.4 헤드리스 미로그인 시 "터미널에서 로그인" 안내 이벤트 — 검증: auth_required 샘플 처리

### T-017 openai-compat 어댑터 + 하네스 자체 도구 루프

deps: T-012 · 산출물: packages/engines/openai-compat/, packages/kernel/src/agent-loop.ts

- 17.1 /v1/chat/completions 스트리밍 클라이언트 — 검증: 모킹 SSE 파싱
- 17.2 도구 정의 주입·tool_calls 실행·결과 반환 루프(최대 반복 30) — 검증: 파일 읽기 도구 1회 호출 성공(Ollama 실제 1회)
- 17.3 도구 호출 미지원 모델용 JSON 모드 폴백 — 검증: 폴백 경로 테스트
- 17.4 같은 루프로 Anthropic·Gemini·DeepSeek API 어댑터 3종 — 검증: 모킹 테스트 3종

### T-018 acp-generic 어댑터

deps: T-013 · 산출물: packages/engines/acp-generic/

- 18.1 @agentclientprotocol/sdk 클라이언트로 initialize·session/new·prompt — 검증: 모킹 에이전트 테스트
- 18.2 ACP 권한 요청 → permission-gate 연결 — 검증: 권한 요청이 승인 이벤트로 변환
- 18.3 session/load 재개 — 검증: claude-agent-acp로 재개 실제 1회
- 18.4 엔진 선택 우선순위(ACP → 헤드리스 → API) 리졸버 — 검증: 설치 조합 4가지 테스트
- 18.5 4개 엔진 동시 같은 프롬프트 실행 통합 테스트(EPIC 1 게이트) — 검증: 4개 세션 이벤트 타입 집합 동일

## 티켓 EPIC 2 — 체크리스트 원장·판정 사다리·훅

목표: 미완료 상태에서 엔진이 종료하려 하면 3개 엔진 모두 차단된다. 하네스/모바일 vs ai/mobile 회귀 시나리오는 실패가 아니라 "쓰는 순간 정식 경로로 교정" 또는 "사다리 판정 후 인정"으로 끝나야 한다. 이 EPIC이 전체의 심장이다.

### T-020 체크리스트 원장과 상태 기계

deps: T-005 · 산출물: packages/plugins-core/checklist-ledger/

- 20.1 항목 스키마(id, parent, title, owner, deps, artifactId, acceptance[], status, attempts, evidence[], verdict?) — 검증: Zod 테스트
- 20.2 상태 전이표 todo→doing→verifying→done, verifying→failed→doing, →blocked 외 전이 거부 — 검증: 전 조합 테스트
- 20.3 checklist.json 저장(쓰기 후 fsync, 버전 번호 증가) — 검증: 동시 쓰기 2개 중 하나 거부
- 20.4 변경마다 checklist_change 이벤트 발행 — 검증: 이벤트 로그 확인
- 20.5 체크리스트 개정(v1→v2) 시 이전 버전 보관 — 검증: checklist.v1.json 존재

### T-021 원자성 린터

deps: T-020 · 산출물: checklist-ledger/src/lint.ts

- 21.1 규칙 R1 단일 동사(한/영 동사 사전 + "하고/및/and" 감지) — 검증: "만들고 테스트" 거부
- 21.2 규칙 R2 산출물 1개(artifactId 정확히 1개) — 검증: 2개 지정 거부
- 21.3 규칙 R3 기계 검증 가능(acceptance에 llm 타입만 있으면 거부) — 검증: 테스트
- 21.4 규칙 R4 크기 상한(예상 변경 파일 1개 또는 diff 150줄) — 검증: 테스트
- 21.5 규칙 R5 deps 순환 금지 — 검증: 순환 거부
- 21.6 위반 시 재분해 요청 메시지 생성(위반 규칙·항목 id 포함) — 검증: 스냅샷
- 21.7 비원자 샘플 10개 픽스처 전부 거부 — 검증: pnpm test lint

### T-022 경로 원장(manifest)과 이름 정책

deps: T-020 · 산출물: checklist-ledger/src/manifest.ts, glossary.json

- 22.1 manifest.json 스키마 {artifactId: {displayName, path, kind}} — 검증: 스키마 테스트
- 22.2 이름 정책 함수: 표시 이름(한글 허용) → 경로(영문 kebab-case) 변환, glossary 우선 적용 — 검증: 하네스/모바일 → harness/mobile
- 22.3 glossary 미등록 한글 단어는 Lock 단계에서 사용자에게 영문 이름 확인 요청 — 검증: 미등록 단어 시 approval_request 이벤트
- 22.4 Lock 시 manifest 고정, 이후 변경은 개정 이벤트로만 — 검증: 직접 수정 거부
- 22.5 프로젝트 glossary.json 기본값(하네스⇄harness, 모바일⇄mobile, 에이전트⇄agent 등 20개) — 검증: 파일 존재·스키마 통과

### T-023 하네스 MCP 서버

deps: T-020, T-008 · 산출물: packages/plugins-core/mcp-host/

- 23.1 MCP 서버(stdio + streamable HTTP) 기동 — 검증: MCP inspector 연결 성공
- 23.2 도구 checklist.propose(tree) — 검증: 린터 통과 시 저장, 실패 시 사유 반환
- 23.3 도구 checklist.start(id), checklist.submit(id, evidence) — 검증: 상태 전이 확인
- 23.4 도구 checklist.current()(현재 항목 + 정식 경로 + 다음 3개) — 검증: 반환 스키마 테스트
- 23.5 도구 manifest.resolve(artifactId) — 검증: 정식 경로 반환
- 23.6 엔진 어댑터들이 세션 시작 시 이 서버를 자동 연결 — 검증: claude·codex 도구 목록에 표시

### T-024 계획 게이트와 조기 경로 감지

deps: T-022, T-023 · 산출물: packages/plugins-core/permission-gate/src/plan-gate.ts

- 24.1 tool.before: 체크리스트 미확정이면 쓰기 도구(Edit/Write/쓰기형 Bash) deny — 검증: 계획 전 Write 시도 차단
- 24.2 쓰기형 Bash 판별기(리다이렉션, mv/cp/rm/mkdir 등) — 검증: 명령 30개 분류 테스트
- 24.3 쓰기 대상 경로를 정규화 + glossary로 manifest에 매칭 — 검증: 하네스/모바일/a.kt → harness/mobile/a.kt 매칭
- 24.4 매칭 성공·경로 다름 → 정식 경로로 고쳐 쓰라는 deny + reason(엔진이 재시도) — 검증: 엔진이 두 번째 시도에서 정식 경로 사용(리플레이)
- 24.5 매칭 실패(manifest 밖) → 엄격 모드면 deny, 기본 모드면 ask — 검증: 모드별 테스트
- 24.6 교정 내역을 evidence에 기록 — 검증: 항목 evidence에 path_corrected

### T-025 판정 사다리 L1~L3 (코드 판정)

deps: T-022 · 산출물: packages/plugins-core/verifiers/ladder/

- 25.1 L1 정규화: NFC, 구분자, C:\ ⇄ /mnt/c/, Windows 대소문자 무시, realpath, 끝 슬래시 — 검증: 정규화 표 24케이스
- 25.2 L2 별칭: glossary 단어 단위 치환 후 비교 — 검증: 하네스/모바일 ≡ harness/mobile
- 25.3 L3 후보 수집: 세션 file_change 중 basename 유사도(편집거리)·확장자 일치 상위 5개 — 검증: 후보 정렬 테스트
- 25.4 L3 내용 증거: 후보 경로로 acceptance 재실행 — 검증: 위치만 다른 픽스처가 relocated 판정
- 25.5 판정 결과 타입 {level, verdict: equal|relocated|wrong|missing, confidence, reason} 기록 — 검증: evidence 스냅샷
- 25.6 회귀 픽스처 fixtures/path-equivalence/(하네스/모바일 vs ai/mobile 포함 12종) — 검증: pnpm test ladder 통과

### T-026 판정 사다리 L4 — 판정기 플러그인 (외부 판정기는 T-100에서 삭제)

deps: T-025 · 산출물: packages/plugins/verifier-local/ (외부 판정기 패키지는 T-100 P1-J.1에서 삭제)

- 26.1 verifier 인터페이스 judge(question, state) → {noul|choice|score, confidence} — 검증: 타입 테스트
- 26.2 외부 판정기 클라이언트 — T-100에서 삭제
- 26.3 질문 템플릿 2종: same_artifact(noul), deviation_kind(choice: equivalent/relocated-ok/wrong-target/missing) — 검증: 요청 스냅샷
- 26.4 전송 데이터 최소화: 경로·파일명·심볼 목록·항목 제목만, 소스 본문 금지 — 검증: 요청 본문에 코드 블록 없음 테스트
- 26.5 임계값: ≥0.9 인정, 0.6~0.9 L5, <0.6 실패(설정 가능) — 검증: 경계값 테스트
- 26.6 로컬 대체 판정기(Ollama JSON 스키마 출력, 같은 질문 형식) — 검증: 모킹 테스트
- 26.7 판정기 선택 — T-100에서 `verifier.l4` 폐기, `judge.*` 설정으로 통합(`judge.semantic = off`면 L5로 직행)

### T-027 판정 사다리 L5 — 승인 카드와 사전 학습

deps: T-026 · 산출물: checklist-ledger/src/escalate.ts

- 27.1 L5 상위 검증: 작성 엔진과 다른 엔진에 같은 질문(JSON 응답 강제) — 검증: 다른 engineId로 호출됨
- 27.2 그래도 불확실하면 approval_request(예상 경로/실제 경로/근거/버튼 3개) — 검증: 이벤트 스키마 테스트
- 27.3 API POST /api/approvals/:id {equivalent|move|fail} — 검증: 응답 후 항목 상태 변경
- 27.4 "동치 인정" 시 glossary·manifest 별칭 자동 추가 — 검증: 같은 케이스 재판정이 L2에서 종료
- 27.5 "이동 승인" 시 manifest 경로 갱신 + 참조 항목 일괄 갱신 — 검증: 의존 항목의 경로 갱신

### T-028 종료 차단

deps: T-023, T-014, T-015, T-016 · 산출물: checklist-ledger/src/stop-guard.ts, scripts/hooks/stop-bridge.mjs

- 28.1 API GET /api/checklist/:session/status(남은 항목·다음 항목 지시문) — 검증: 응답 스키마
- 28.2 Claude Code용 Stop 훅 브리지: 세션 시작 시 .claude/settings.local.json에 임시 주입, 종료 시 원복 — 검증: 세션 후 파일 원상태
- 28.3 Codex용 Stop 훅 브리지(.codex/hooks.json 프로젝트 로컬) — 검증: 같은 방식 테스트
- 28.4 브리지 스크립트: 미완료면 {"decision":"block","reason":"다음 항목 …"}, stop_hook_active이고 무진척이면 통과 — 검증: 입력 3종 테스트
- 28.5 무훅 엔진(agy·로컬): turn_end 수신 시 같은 판단 후 다음 턴 자동 전송 — 검증: 리플레이로 2턴 자동 진행
- 28.6 통합 테스트: 3개 엔진 미완료 종료 차단(EPIC 2 게이트) — 검증: 3개 모두 block 로그

### T-029 컨텍스트 슬라이스·정체 감지·내보내기

deps: T-028 · 산출물: checklist-ledger/src/slice.ts, stall.ts, export.ts

- 29.1 슬라이스 생성(현재 항목·부모·다음 3개·최근 실패 사유·정식 경로) 2KB 이내 — 검증: 크기 테스트
- 29.2 context.compact와 매 턴 시작 시 슬라이스 재주입 — 검증: 압축 후 프롬프트에 현재 항목 id
- 29.3 정체 감지: evidence 해시 무변화 2턴 → 접근 변경 지시, 3턴 → blocked — 검증: 시뮬레이션
- 29.4 세션 상한(반복 수·토큰·시간) 초과 시 일시정지 — 검증: 상한 테스트
- 29.5 CHECKLIST.md 렌더러(상태 아이콘·판정 사유 포함) — 검증: 스냅샷
- 29.6 HARNESS v2 호환 CHECKPOINT.json·MISSION.md 내보내기 — 검증: 스키마 대조

## 티켓 EPIC 3 — UI 셸과 + 버튼 폴더 선택

목표: 브라우저만으로 "+ 버튼으로 폴더 선택 → 지시 → 체크리스트 완료"까지 할 수 있다. 화면 기준은 디자인 컨셉 A·B다.

폴더 선택의 기술적 핵심: 브라우저는 보안상 폴더의 실제 경로를 웹페이지에 알려주지 않는다. 그래서 + 버튼은 브라우저 API가 아니라 로컬 하네스 서버에게 "Windows 폴더 대화상자를 띄워 달라"고 요청한다. 서버가 네이티브 Explorer형 대화상자를 띄우고 선택된 경로를 돌려준다. 데스크톱(Tauri) 모드에서는 @tauri-apps/plugin-dialog의 open({ directory: true })로 같은 결과를 얻는다 (Tauri 문서). 이 플러그인은 Android·iOS에서 폴더 선택을 지원하지 않으므로, 모바일에서는 + 버튼이 "최근 프로젝트 목록"을 연다.

### T-030 웹 앱 골격과 디자인 토큰

deps: T-008 · 산출물: apps/web/, apps/web/src/design/tokens.json

- 30.1 Vite + React + TypeScript 앱 생성 — 검증: pnpm --filter web build exit 0
- 30.2 tokens.json: 색(중성 회색 9단계, 강조 1색, 상태 6색), 간격 4/8/12/16/24/32, 반경 8, 글자 12/13/14/16/20 — 검증: 스키마 테스트
- 30.3 토큰 → CSS 변수 생성, 라이트/다크 prefers-color-scheme + 수동 토글 — 검증: 빌드 산출 CSS에 변수 존재
- 30.4 폰트: Pretendard(본문), JetBrains Mono(코드) 로컬 번들 — 검증: 네트워크 차단 상태 렌더 🖐
- 30.5 하드코딩 색 금지 린트(stylelint color-no-hex 예외 tokens만) — 검증: pnpm lint:css exit 0
- 30.6 API 클라이언트(토큰 헤더, WebSocket 재연결) — 검증: 서버 재기동 후 자동 재연결 테스트

### T-031 앱 셸 레이아웃

deps: T-030 · 산출물: apps/web/src/shell/

- 31.1 상단 바(워크스페이스 이름, 실행 상태, 엔진별 쿼터 미터 자리) — 검증: 스냅샷
- 31.2 좌측 사이드바(새 세션, 세션 목록, 하단 메뉴: 에이전트 만들기·플러그인·스킬·엔진·설정) — 검증: 스냅샷
- 31.3 3열 레이아웃(사이드바 240px / 채팅 가변 / 우측 패널 360px), 경계 드래그 리사이즈 — 검증: 리사이즈 후 너비 저장 🖐
- 31.4 우측 패널 탭 드래그 재배치(체크리스트·Diff·터미널·궤적) — 검증: 순서 저장·복원 테스트
- 31.5 세션 목록 필터(상태·프로젝트·엔진)·프로젝트별 그룹 — 검증: 필터 단위 테스트
- 31.6 768px 미만: 사이드바·우측 패널이 시트로 접힘 — 검증: 뷰포트 테스트

### T-032 채팅 스트림

deps: T-031 · 산출물: apps/web/src/chat/

- 32.1 HarnessEvent → 메시지 블록 렌더러(텍스트·도구 호출·도구 결과·파일 변경·오류) — 검증: 이벤트 9종 스냅샷
- 32.2 도구 카드 접기/펼치기, 카드 우측에 체크리스트 항목 id 태그 — 검증: 스냅샷
- 32.3 보기 모드 3단(Verbose·Normal·Summary) — 검증: 모드별 표시 블록 수 테스트
- 32.4 "종료 차단" 카드(노란색, 남은 항목 수·다음 항목) — 검증: stop block 이벤트로 렌더
- 32.5 가상 스크롤(이벤트 5,000개에서 60fps) — 검증: 성능 측정 🖐

### T-033 지시 입력창과 칩

deps: T-032 · 산출물: apps/web/src/composer/

- 33.1 멀티라인 입력, Enter 전송 / Shift+Enter 줄바꿈, 한글 IME 조합 중 Enter 무시 — 검증: IME 조합 이벤트 테스트
- 33.2 하단 도구줄 배치: 왼쪽 끝 + 버튼, 이어서 엔진 칩·인증 칩(구독/API)·권한 칩, 오른쪽 끝 전송 버튼 — 검증: 스냅샷(컨셉 A와 일치) 🖐
- 33.3 엔진 칩 클릭 → 감지된 엔진 목록 팝오버 — 검증: 선택 시 다음 턴 엔진 변경
- 33.4 권한 칩(읽기 전용/워크스페이스 쓰기/전체) — 검증: 세션 설정 반영
- 33.5 파일 첨부(드래그앤드롭·붙여넣기 이미지) — 검증: 첨부 이벤트 생성

### T-034 + 버튼 → Windows 폴더 대화상자

deps: T-033 · 산출물: packages/kernel/src/native/folder-picker.ts, apps/web/src/composer/PlusMenu.tsx

- 34.1 + 버튼 클릭 → 메뉴 3개: "프로젝트 폴더 열기…", "최근 프로젝트", "파일 첨부" — 검증: 스냅샷 🖐
- 34.2 API POST /api/native/pick-folder {initialPath?} — 검증: 라우트 테스트(피커 모킹)
- 34.3 Windows 구현: pwsh(PowerShell 7, .NET의 Vista형 FolderBrowserDialog)를 STA로 실행, 선택 경로를 stdout JSON으로 반환 — 검증: Explorer형 대화상자 표시 🖐 + 출력 파싱 테스트
- 34.4 폴백: pwsh가 없으면 Windows PowerShell 5.1에서 IFileOpenDialog(FOS_PICKFOLDERS)를 C# Add-Type으로 호출 — 검증: 5.1 환경에서 Explorer형 대화상자 🖐
- 34.5 대화상자를 브라우저 창 앞으로 가져오기(최상위 소유 창 지정) — 검증: 대화상자가 뒤에 숨지 않음 🖐
- 34.6 취소 시 {cancelled:true} 반환, UI는 아무 변화 없음 — 검증: 테스트
- 34.7 서버가 WSL 안에서 실행 중이면 powershell.exe를 호출하고, 결과를 wslpath -u로 변환 — 검증: C:\work\app → /mnt/c/work/app
- 34.8 동시 요청 1개 제한(대화상자 중복 방지) — 검증: 두 번째 요청 409

### T-035 워크스페이스 등록과 최근 프로젝트

deps: T-034 · 산출물: packages/kernel/src/workspaces.ts, apps/web/src/shell/WorkspaceBar.tsx

- 35.1 선택 경로 검증(존재·폴더·읽기 권한·시스템 폴더 거부: C:\Windows, 홈 루트) — 검증: 거부 케이스 5종
- 35.2 워크스페이스 등록(이름=폴더명, 경로, 최근 사용 시각) ~/.harness-x/workspaces.json — 검증: 파일 갱신
- 35.3 Git 저장소 감지(브랜치 표시), AGENTS.md/CLAUDE.md 존재 표시 — 검증: 테스트 저장소에서 표시
- 35.4 상단 바 워크스페이스 이름 갱신 + 새 세션의 cwd로 사용 — 검증: 다음 세션 cwd 일치
- 35.5 최근 프로젝트 목록(최대 10, 고정 핀) — 검증: 정렬 테스트
- 35.6 모바일·Tauri 모바일에서는 + → 최근 프로젝트 목록만 표시 — 검증: 모바일 뷰포트 스냅샷
- 35.7 권한 경계 연동: 선택한 폴더가 permission-gate의 워크스페이스 루트가 됨 — 검증: 루트 밖 쓰기 ask

### T-036 체크리스트 패널

deps: T-029, T-031 · 산출물: apps/web/src/panels/Checklist/

- 36.1 트리 렌더(상태 아이콘·진행률 바·현재 항목 강조) — 검증: 스냅샷
- 36.2 실시간 갱신(checklist_change 수신 1초 내 반영) — 검증: 테스트
- 36.3 항목 펼침: acceptance·evidence·판정 사다리 결과(L1~L5, 확률, 사유) 표시 — 검증: 스냅샷
- 36.4 승인 카드(예상/실제 경로 + [동치 인정] [이동 승인] [실패]) — 검증: 클릭 시 API 호출
- 36.5 Lock 전 계획 검토 화면(린터 위반 표시, [승인] 버튼) — 검증: 승인 시 Lock

### T-037 Diff·터미널·궤적 패널

deps: T-031 · 산출물: apps/web/src/panels/

- 37.1 Diff 패널(Monaco diff, 파일 변경 카드 클릭 시 열림) — 검증: 열림 테스트
- 37.2 터미널 패널(xterm.js + node-pty, 워크스페이스 cwd) — 검증: pwd 출력이 워크스페이스
- 37.3 "터미널에서 로그인" 버튼이 공식 로그인 명령을 이 터미널에 실행 — 검증: codex login 실행 🖐
- 37.4 궤적 패널(이벤트 타임라인, 단계별 토큰·비용) — 검증: 리플레이 일치

### T-038 설정 > 엔진 화면

deps: T-018, T-031 · 산출물: apps/web/src/settings/Engines/

- 38.1 엔진 카드 그리드(이름·버전·위치 Windows/WSL·로그인 배지) — 검증: 스냅샷
- 38.2 구독 | API 토글 + API 키 입력(키체인 저장, 마스킹 표시) — 검증: 저장 후 마스킹 표시
- 38.3 기본 모델·폴백 엔진 선택 — 검증: 설정 파일 반영
- 38.4 "테스트 실행"(1턴 핑, 결과·지연시간) — 검증: 결과 표시 🖐
- 38.5 "다시 스캔", 미설치 지원 엔진은 회색 카드 + 설치 안내 링크 — 검증: 스냅샷

## 티켓 EPIC 4 — 에이전트 만들기(레고)와 슬래시 호출

요구사항 원문 그대로 수용 기준으로 삼는다: "메뉴에 에이전트 만들기 / 플러그인으로 파이프라인 / 플러그인 안 세부 담당에게 스킬 끼워넣기 / 레고처럼 뗐다 붙였다 / 플러그인 단독으로도 에이전트 / 입력창에 / 넣으면 에이전트 목록 → 지정 후 일 시키기". 화면 기준은 디자인 컨셉 C·D다.

요구 문장

담당 티켓

메뉴에 에이전트 만들기

T-044

플러그인으로 파이프라인

T-040, T-041

세부 담당(역할)에게 스킬 끼워넣기

T-045

레고처럼 뗐다 붙였다

T-045, T-046

플러그인 단독 에이전트

T-043

/ → 에이전트 목록 → 지정 → 일 시키기

T-047, T-048

### T-040 파이프라인·에이전트 스키마

deps: T-003 · 산출물: packages/protocol/src/pipeline.ts, agent.ts

- 40.1 노드 타입 6종 스키마: role, gate, fanout, join, loop, router (+ subagent) — 검증: 타입 테스트
- 40.2 role 노드 필드: engine(auto|id), mode(subscription|apiKey), skills[], tools[], permission, checklistTemplate, inputSchema, outputSchema — 검증: 스키마 테스트
- 40.3 엣지·조건(onFail, when) 스키마, DAG 검사(loop 노드만 순환 허용) — 검증: 잘못된 순환 거부
- 40.4 agent.yaml 스키마(name, displayName, icon, command /이름, defaultEngine, pipeline 참조) — 검증: 샘플 통과
- 40.5 예제 examples/agents/design-qa/(plan → build → critic) — 검증: 스키마 통과

### T-041 파이프라인 실행기

deps: T-040, T-028 · 산출물: packages/plugins-core/agent-builder/src/runner/

- 41.1 노드별 엔진 세션 생성(노드마다 다른 엔진 가능) — 검증: plan=claude, build=codex 리플레이
- 41.2 role 노드 완료 조건 = 그 노드 체크리스트 전 항목 done — 검증: 미완료 시 다음 노드 진행 안 함
- 41.3 gate 노드: 실패 항목만 onFail 노드로 되돌림 — 검증: 부분 재실행 테스트
- 41.4 fanout/join 병렬 실행(최대 동시 3) — 검증: 동시성 테스트
- 41.5 loop 노드 최대 반복·정체 감지 — 검증: 상한 테스트
- 41.6 노드 진행 이벤트(node_start/node_end) 발행 — 검증: 이벤트 로그

### T-042 노드 간 데이터 계약

deps: T-041 · 산출물: agent-builder/src/contract.ts

- 42.1 노드 출력에서 outputSchema 필드 결정적 추출(MCP 도구 node.output(json) 우선, 없으면 마지막 JSON 블록) — 검증: 두 경로 테스트
- 42.2 스키마 검증 실패 시 같은 노드에 누락 필드 목록과 함께 재요청(최대 2회) — 검증: 재요청 리플레이
- 42.3 다음 노드에는 파일 링크가 아니라 값으로 주입 — 검증: 다음 노드 프롬프트에 필드 값 존재
- 42.4 노드 연결 시 스키마 호환성 정적 검사 — 검증: 비호환 연결 오류

### T-043 플러그인 단독 에이전트

deps: T-040, T-006 · 산출물: agent-builder/src/registry.ts

- 43.1 매니페스트 provides.command만 있는 플러그인 → 단일 role 노드 에이전트 자동 생성 — 검증: hello 플러그인이 에이전트로 등록
- 43.2 provides.pipeline이 있는 플러그인 → 그 파이프라인으로 에이전트 생성 — 검증: design-qa 등록
- 43.3 사용자 에이전트(~/.harness-x/agents/*/agent.yaml) 등록 — 검증: 목록 포함
- 43.4 이름 충돌 규칙(사용자 > 프로젝트 > 플러그인, 충돌 시 플러그인id:이름) — 검증: 충돌 테스트
- 43.5 API GET /api/agents(이름·설명·아이콘·출처·노드 수) — 검증: 응답 스키마

### T-044 메뉴 "에이전트 만들기"와 빌더 캔버스

deps: T-031, T-040 · 산출물: apps/web/src/builder/

- 44.1 좌측 하단 메뉴 "에이전트 만들기" → 빌더 화면 라우트 /builder/new — 검증: 클릭 시 이동
- 44.2 시작 선택: 빈 캔버스 / 플러그인에서 시작 / 기존 에이전트 복제 — 검증: 3경로 테스트
- 44.3 3열 레이아웃: 블록 서랍(좌) / 캔버스(중, React Flow, 스냅 그리드 16px) / 인스펙터(우) — 검증: 스냅샷(컨셉 C와 일치) 🖐
- 44.4 블록 서랍 탭: 노드·플러그인·스킬·엔진·도구, 검색창 — 검증: 검색 필터 테스트
- 44.5 노드 블록을 캔버스로 드래그해 추가, Delete로 제거 — 검증: 노드 수 변화 테스트

### T-045 레고 장착·분리

deps: T-044 · 산출물: apps/web/src/builder/lego/

- 45.1 스킬 블록을 역할 노드 위로 드래그 → 노드 안 "스킬 칩"으로 장착(하이라이트 표시) — 검증: 노드 skills 배열 갱신
- 45.2 스킬 칩의 × 또는 바깥으로 끌어내기 → 분리 — 검증: 배열에서 제거
- 45.3 엔진 블록을 노드에 드롭 → 노드 엔진 지정(칩 색으로 구분) — 검증: engine 필드 갱신
- 45.4 플러그인 블록 드롭 → 그 플러그인의 파이프라인 노드들이 그룹으로 펼쳐짐, 그룹째 이동·분리 — 검증: 그룹 노드 생성 테스트
- 45.5 노드 포트 연결/해제, 비호환 스키마 연결 시 빨간 선 + 사유 툴팁 — 검증: T-042 정적 검사 연동
- 45.6 실행 취소/다시 실행(Ctrl+Z/Y, 50단계) — 검증: 테스트

### T-046 인스펙터·YAML 동기화·시험 실행

deps: T-045, T-041 · 산출물: apps/web/src/builder/inspector/

- 46.1 선택 노드 인스펙터: 이름·엔진·인증 모드·권한·스킬 순서·체크리스트 템플릿·입출력 스키마 — 검증: 편집이 그래프에 반영
- 46.2 "YAML 보기" 탭: 그래프 → YAML, YAML 편집 → 그래프(양방향) — 검증: 왕복 변환 동일
- 46.3 저장: ~/.harness-x/agents/<이름>/agent.yaml + pipeline.yaml, 이름에 슬래시 명령 자동 제안 — 검증: 파일 생성
- 46.4 "시험 실행": 샘플 입력으로 드라이런, 노드별 진행·비용을 캔버스에 오버레이 — 검증: 리플레이 오버레이 🖐
- 46.5 저장 즉시 / 목록에 등장(핫리로드) — 검증: 저장 후 3초 내 목록 포함

### T-047 / 에이전트 팔레트

deps: T-043, T-033 · 산출물: apps/web/src/composer/SlashPalette.tsx

- 47.1 입력 맨 앞 / 입력 시 팔레트 열림(입력창 위 팝오버) — 검증: 열림 테스트
- 47.2 그룹: 에이전트 / 플러그인 명령 / 스킬 / 내장 명령(/engines, /checklist, /resume) — 검증: 그룹 표시 스냅샷(컨셉 D와 일치) 🖐
- 47.3 퍼지 검색(한글 초성 검색 포함: ㄷㅈㅇ → 디자인) — 검증: 초성 테스트
- 47.4 각 행: 아이콘·이름·설명·노드 수·기본 엔진 — 검증: 스냅샷
- 47.5 ↑↓ 이동, Enter/Tab 선택, Esc 닫기 — 검증: 키보드 테스트
- 47.6 선택 시 입력창 앞에 에이전트 칩 고정(× 로 해제) — 검증: 칩 렌더

### T-048 / 실행 디스패치

deps: T-047, T-041 · 산출물: packages/kernel/src/dispatch.ts

- 48.1 칩 + 지시문 전송 → 해당 에이전트 파이프라인으로 새 세션 시작 — 검증: 세션 생성 이벤트
- 48.2 수식어 파서: @엔진(이번 실행만 엔진 교체), #strict, !plan(계획만) — 검증: 단위 테스트
- 48.3 사이드바 세션 항목에 에이전트 아이콘·현재 노드·진행률 — 검증: 스냅샷
- 48.4 실행 중 다른 에이전트를 /로 부르면 서브에이전트로 추가할지 묻기 — 검증: 확인 카드 표시
- 48.5 EPIC 4 게이트: 빌더로 만든 3노드 에이전트를 /로 실행해 체크리스트 완료 — 검증: E2E 테스트

## 티켓 EPIC 5 — Forge (대화로 스킬·플러그인 생성)

목표: 대화만으로 훅 플러그인 1개를 생성하고, 샌드박스에서 시험한 뒤 설치까지 마친다. Forge 자체도 에이전트(/forge)로 구현하므로 EPIC 4 위에 올라간다.

### T-050 템플릿 레지스트리

deps: T-003 · 산출물: packages/sdk/templates/

- 50.1 템플릿 5종 골격: skill, tool, hook, pipeline, panel — 검증: 각 템플릿 스캐폴드 후 pnpm build exit 0
- 50.2 템플릿 변수(id, 표시 이름, 권한, 설명) 치환기 — 검증: 스냅샷
- 50.3 SKILL.md 프런트매터 검증기(name, description 필수) — 검증: 누락 시 오류

### T-051 Forge 인터뷰와 spec

deps: T-050, T-048 · 산출물: packages/plugins-core/forge/

- 51.1 /forge 에이전트 등록(interview → spec → scaffold → check → test → install 6노드) — 검증: / 목록 포함
- 51.2 인터뷰 노드: 최대 5문항, 선택지 버튼 UI(종류·발동 시점·입출력·권한·성공 예시) — 검증: 답변 이벤트 생성
- 51.3 forge-spec.json 생성 + 사용자 확인 카드 — 검증: 스키마 통과
- 51.4 scaffold 노드가 spec으로 템플릿을 채우고 본문 작성 — 검증: 파일 생성

### T-052 정적 검사·샌드박스 시험·설치

deps: T-051 · 산출물: forge/src/check.ts, sandbox.ts, install.ts

- 52.1 매니페스트·타입체크·SKILL.md 검사 — 검증: 깨진 샘플 거부
- 52.2 권한 최소화 린트(선언했지만 코드에서 안 쓰는 권한 제거 제안) — 검증: 샘플 제안 생성
- 52.3 임시 워크스페이스에서 spec 예시 입력으로 실행, acceptance 통과 확인(실패 시 scaffold로, 최대 3회) — 검증: 루프 리플레이
- 52.4 설치 카드(파일 diff, 권한 요약, 네트워크·셸 권한이면 빨간 경고) — 검증: 스냅샷
- 52.5 설치: ~/.harness-x/plugins/forge/<id>/에 Git 저장소로 생성, 등급 "미서명·격리" — 검증: 등급 표시
- 52.6 EPIC 5 게이트: "PR 전에 Kotlin 린트 실패 시 막는 훅 만들어줘" 시나리오 완주 — 검증: E2E

### T-053 세션에서 스킬 추출·외부 가져오기

deps: T-052 · 산출물: forge/src/extract.ts, import/

- 53.1 완료 세션의 체크리스트·궤적에서 반복 단계·명령·검증을 SKILL.md로 일반화 — 검증: 샘플 세션 → SKILL.md
- 53.2 Claude Code 플러그인(.claude-plugin/plugin.json) → 하네스 매니페스트 변환 — 검증: 샘플 변환 후 로드
- 53.3 표준 SKILL.md 폴더 가져오기 — 검증: 로드 테스트
- 53.4 MCP 서버 설정 가져오기(tool 슬롯으로 래핑) — 검증: 도구 목록 표시

## 티켓 EPIC 6 — 안정화·패키징

목표: 1주 실사용 동안 데이터 손실 0건, 무한 루프 0건. Windows 설치 파일을 만든다.

### T-060 쿼터 미터와 폴백 라우팅

deps: T-015, T-031 · 산출물: packages/kernel/src/quota.ts

- 60.1 엔진별 usage 집계(토큰·요청·추정 비용·한도 대비 사용률) — 검증: 집계 테스트
- 60.2 상단 바 쿼터 미터(엔진별 막대, 80% 노랑·95% 빨강) — 검증: 스냅샷
- 60.3 quota_exceeded 시 같은 엔진 API 모드 → 폴백 엔진 → 일시정지 후 리셋 시각 재개 — 검증: 시뮬레이션 3경로
- 60.4 엔진이 바뀌어도 "다음 미완료 항목"부터 재개 — 검증: 리플레이

### T-061 크래시 복구

deps: T-029 · 산출물: packages/kernel/src/recover.ts

- 61.1 시작 시 미종료 세션 탐지(마지막 이벤트가 turn_end 아님) — 검증: 강제 종료 픽스처
- 61.2 이벤트 로그 + 원장으로 세션 상태 재구성 — 검증: 재구성 결과 일치
- 61.3 "이어서 하기" 카드 → 다음 미완료 항목부터 재개 — 검증: E2E

### T-062 플러그인 격리와 서명 등급

deps: T-006 · 산출물: packages/kernel/src/sandbox/

- 62.1 서드파티·Forge 플러그인을 worker_threads에서 실행, 메시지 RPC만 허용 — 검증: 직접 fs 접근 시 실패
- 62.2 권한 프록시(fs/net/shell 호출을 매니페스트 권한으로 검사) — 검증: 권한 밖 호출 거부
- 62.3 등급: 코어 / 신뢰 / 미서명·격리, UI에서 승격 — 검증: 승격 후 메인 실행

### T-063 Tauri 데스크톱 패키징

deps: T-035 · 산출물: apps/desktop/

- 63.1 Tauri 2 프로젝트, 웹 앱 번들 임베드 — 검증: pnpm --filter desktop tauri build 성공
- 63.2 하네스 서버를 사이드카로 실행·종료 연동 — 검증: 앱 종료 시 서버 프로세스 없음
- 63.3 + 버튼 폴더 선택을 @tauri-apps/plugin-dialog open({ directory: true })로 교체(capability dialog:allow-open) — 검증: Explorer형 대화상자 🖐
- 63.4 Windows 설치 파일(MSI/NSIS) 생성 — 검증: 설치·실행 🖐

### T-064 E2E 회귀 시나리오 묶음

deps: T-048, T-052, T-061 · 산출물: e2e/

- 64.1 경로 동치 회귀: 계획은 하네스/모바일, 엔진은 ai/mobile로 쓰려 함 → 쓰는 순간 harness/mobile로 교정 또는 L5 승인 카드 — 검증: 실패 판정 0건
- 64.2 + 버튼 → 폴더 선택 → /design-qa 실행 → 체크리스트 완료 — 검증: E2E(피커 모킹)
- 64.3 Claude Code 한도 초과 → Codex 폴백 → 완료 — 검증: 시뮬레이션
- 64.4 크래시 후 재개 — 검증: E2E
- 64.5 Forge로 만든 훅이 다음 세션에서 동작 — 검증: E2E
- 64.6 CI 워크플로(GitHub Actions, Windows + Ubuntu 매트릭스) — 검증: CI 녹색

## 리스크, 결정 사항, 출처

리스크

대응

관련 티켓

판정을 느슨하게 해서 진짜 잘못까지 통과

코드 판정(L1~L3)을 먼저 하고, 모델 판정은 0.9 이상만 자동 인정한다. 애매하면 반드시 다른 엔진이나 사람이 본다

T-025~T-027

판정 AI 서비스 변경·중단, 데이터 보존

판정 AI는 사용자 설정 → 로컬 → 구독 엔진 순서로 바꿔 쓸 수 있고 off 설정이 있다. 보내는 데이터는 메타데이터뿐이다

T-026

PowerShell 폴더 대화상자가 창 뒤에 숨거나 구형 트리로 뜸

pwsh의 Vista형 대화상자를 우선 쓰고, 5.1용 IFileOpenDialog 폴백과 소유 창 지정으로 막는다. 최종적으로는 Tauri 대화상자를 쓴다

T-034, T-063

Anthropic 구독 정책 재변경

공식 바이너리만 실행하고 토큰 파일 접근을 가드한다. API 모드 토글이 있다

T-013, T-014

CLI 출력 형식 변경

ACP를 우선 쓰고, 녹화 리플레이 테스트와 버전 호환표로 막는다

T-010, T-018

Claude Code가 티켓 중간에 멈추거나 건너뜀

T-000의 티켓 게이트 Stop 훅과 "항목 하나 = 커밋 하나" 규칙으로 막는다

T-000

### 결정 필요 사항 (시작 전 답변 권장)

- 기본 이름 정책: 경로는 영문 kebab-case, 표시는 한글 (권장안)
- L4 판정기 기본값: T-100에서 결정 — 사용자 설정 AI → 로컬 LLM → 구독 엔진 → 승인 카드 (유료 API 기본 호출 없음)
- 엄격 모드(manifest 밖 쓰기 즉시 거부)를 기본으로 할지
- 엔진 구현 순서: Claude Code → Codex → 로컬 LLM → Antigravity (권장안)

### 출처 (2026-11-10 확인)

- Tauri Dialog 플러그인
- Claude Code hooks 문서
- Claude Code Legal and compliance
- ACP Registry
- v1 계획서 (설계 근거 전체)