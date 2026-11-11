# HARNESS-X

엔진 중립 에이전트 하네스 (TypeScript · Node 22 · pnpm 모노레포). 작업 규칙은 `CLAUDE.md`, 개발 방법은 `docs/DEV-CONVENTIONS.md`, 계획은 `docs/PLAN-v2.md`.

```bash
pnpm install && pnpm -r build
node packages/kernel/dist/cli.js serve --workspace <프로젝트 폴더>   # 로컬 API 서버 (기본 127.0.0.1:3790)
node packages/kernel/dist/cli.js approvals --workspace <프로젝트 폴더> # 확인이 필요한 카드를 글로 보고 번호로 고르기
pnpm test
```

## 체크리스트 판정 — 비교기 · 판정 AI · 승인 카드 (T-100 Part 1)

체크리스트 항목의 "기대값"과 "실제값"(명령 출력·경로·JSON·숫자·버전 …)은 글자 그대로 맞대지 않고 **비교기**를 거친다.

```
정규화(비교기) → 사전(다음부터 자동) → 의미 판단(판정 AI 체인) → 사용자 승인(쉬운 말 카드)
```

1. **정규화** — 비교기가 사소한 차이(줄바꿈·공백·`./`·키 순서·`1,000` …)를 정리해 같으면 통과, 확실히 다르면 실패.
   코드로 확정되는 진짜 틀림(`200` vs `500`, `success` vs `error`, 서로 다른 폴더 `harness/server` vs `harness/client`)은
   여기서 실패로 끝나므로 AI가 잘못 "같다"고 해도 통과하지 않는다.
2. **사전** — 승인 카드에서 "같은 걸로 인정" + "다음부터 자동"을 고른 쌍. 경로·이름은 `<프로젝트>/.harness-x/glossary.json`,
   글 표현은 `<프로젝트>/.harness-x/equivalences.json`. 사전에 있으면 AI를 부르지 않고 통과.
3. **의미 판단** — 아래 판정 AI 체인에 묻는다. 신뢰도 ≥ 0.9면 통과(기록에 `AI 판단(엔진, 0.93)`·`ai_judged: true`),
   0.6~0.9면 승인 카드, < 0.6이면 실패. 같은 쌍을 AI가 3번 인정하면 사전에 넣을지 카드로 묻는다(자동 등록 없음).
4. **사용자 승인** — 판단이 애매하거나 판정할 AI가 없으면 카드를 띄우고 항목은 사람의 선택을 기다린다.

### 비교기 표

`compare.kind`를 적지 않으면 기대값으로 추론한다(JSON → `json`, semver → `version`, 숫자 → `number`, 경로 → `path`, 그 밖 → `text`).

| 종류       | 정규화 / 판단                                                                                                                                                                        | 옵션                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `exact`    | 정규화 없음 — 한 글자라도 다르면 실패 (융통성 끄기)                                                                                                                                  | —                                                                                                               |
| `path`     | NFC · 구분자(`\` → `/`) · `./`·끝 슬래시 · Windows 대소문자 · `C:\` ⇄ `/mnt/c/` · realpath, glossary 별칭(하네스 → harness), manifest 별칭 경로. 서로 다른 glossary 단어 폴더는 실패 | `aliases`, `dictionary: false`, `caseInsensitive` · `-`/`_` 동치는 사전 규칙 `path.dash-underscore`가 있을 때만 |
| `text`     | CRLF → LF · 줄 끝 공백 · 마지막 빈 줄 · NFC · 연속 공백 1개. 상태 반대(성공 vs 실패)·숫자만 다름은 실패                                                                              | `mode: equals \| contains \| lines`, `ignoreOrder`, `ignoreCase`, `collapseSpaces`                              |
| `json`     | 구조 비교(키 순서 무시, `1` = `1.0`), 다르면 첫 차이 위치(`$.a.list[1]`). 파싱 실패 → `text`로 강등                                                                                  | `ignoreKeys`, `arrayOrder: strict \| ignore`                                                                    |
| `number`   | 천 단위 구분자 제거(`1,000` = `1000`)                                                                                                                                                | `tolerance` (기본 0)                                                                                            |
| `version`  | `v` 제거, `1.2` = `1.2.0`, `+빌드` 무시, semver 순서                                                                                                                                 | `range` (`^1.2`, `~1.4`, `>=1 <2`, `1.x \|\| 2.x`)                                                              |
| `regex`    | 기대값 정규식(`/패턴/flags`)을 정규화된 실제 텍스트에 적용 (CRLF 출력에서도 같은 정규식)                                                                                             | `flags`                                                                                                         |
| `exitCode` | 정수 비교, 정규화 없음                                                                                                                                                               | —                                                                                                               |

플러그인은 `harness-plugin.json`의 `provides.comparator`로 비교기를 더할 수 있다. 회귀 픽스처: `fixtures/comparators/`(비교기마다 같아야 5 + 달라야 3 이상).

### `exact` 와 `semantic: off`

```json
{ "type": "command", "run": "node -v", "expectOutput": "v22.23.4", "compare": { "kind": "exact" } }
{ "type": "command", "run": "pnpm test", "expectOutput": "Tests: 12 passed", "compare": { "kind": "text", "options": { "mode": "contains" }, "semantic": "off" } }
```

- `kind: "exact"` 또는 `semantic: "off"` 항목은 비교기가 같다고 못 하면 **의미 판단·승인 카드 없이 바로 실패**한다.
- 해시·체크섬(16진 32자 이상), 비밀번호·토큰 모양 값, lockfile(`pnpm-lock.yaml` 등) 비교는 자동으로 `semantic: off`.
- 전체를 끄려면 설정 `judge.semantic: "off"` (아래).

### 판정 AI 설정 `judge.*` (`~/.harness-x/settings.json`)

```json
{
  "judge": {
    "engine": "",
    "model": "",
    "samples": 3,
    "maxCallsPerSession": 50,
    "semantic": "on",
    "local": { "model": "", "timeoutMs": 20000 }
  }
}
```

| 키                                            | 뜻                                                                                       | 기본           |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------- |
| `judge.engine`                                | 판정에 쓸 엔진 id (`claude-code` · `codex` · `antigravity` …, 감지된 엔진). 빈 값 = 자동 | `""`           |
| `judge.model`                                 | `judge.engine`에 넘길 모델 (빈 값 = 엔진 기본)                                           | `""`           |
| `judge.samples`                               | 같은 질문을 몇 번 물어 일치율을 신뢰도로 쓸지 (1~3, 병렬)                                | `3`            |
| `judge.maxCallsPerSession`                    | 세션당 판정 호출 상한 — 넘으면 "물어볼 수 있는 횟수를 다 썼어요" 카드                    | `50`           |
| `judge.semantic`                              | `on` \| `off` (off면 의미 판단 없이 실패)                                                | `on`           |
| `judge.local.model` · `judge.local.timeoutMs` | 로컬 Ollama 모델(빈 값 = 자동) · 시간 상한                                               | `""` · `20000` |

판정 AI 고르는 순서 (유료 API는 기본으로 부르지 않는다):

1. `judge.engine` — 사용자가 정한 엔진 (감지되고 로그인돼 있을 때)
2. 로컬 Ollama — 켜져 있고 모델이 있을 때 (무료, 주소는 환경 변수 `HARNESS_X_OLLAMA_URL`로 바꿀 수 있음)
3. 로그인된 구독 엔진 — 추가 과금 없음. 항목을 쓴 엔진과 **다른 엔진**을 먼저 고른다
4. 승인 카드 — 위가 전부 안 되면 "판정해 줄 AI가 연결돼 있지 않아요"

엔진 판정은 판정 전용 짧은 세션(빈 임시 폴더, 도구 사용 금지, 읽기 전용)으로 돌고, 구독 모드면 API 키 환경 변수를 지운다.
보내는 값은 기대값·실제값·항목 제목·비교기 종류뿐이며 값마다 2KB로 자르고 비밀 모양은 가린다. 같은 쌍은 캐시해 다시 묻지 않는다.
예전 설정 `verifier.l4`는 서버 시작 때 한 번 `judge.*`로 옮겨 쓰고(`off` → `judge.semantic: off`, 그 밖 → `judge.engine: ""`),
더 이상 쓰지 않는 판정 서비스 키는 키체인에서 지운 뒤 패널에 한 번 안내한다.

### 승인 카드 동작

- **언제 뜨나**: 의미 판단 신뢰도 0.6~0.9 · 판정할 AI가 하나도 없음 · 세션 호출 상한 초과. (`exact`·`semantic: off`는 카드 없이 실패)
- **어디에**: 우측 패널 맨 위 "확인이 필요해요"(여러 장이면 개수 배지), 토스트, 사이드바 세션 "확인 필요" 배지, 탭 제목 `(1)`,
  브라우저가 뒤에 있으면 OS 알림, 채팅에는 축소 카드. 768px 미만이면 하단 시트. 패널 없이: `harness-x approvals`.
- **무엇이 보이나**: "무슨 일이 있었나요?" · "왜 제가 정하지 못했나요?" · 확신 정도(말로: 높은 편 / 중간 / 낮은 편) · AI 추천(쉬운 말 검사를 통과할 때만).
  원문 값·차이·비교 방법·신뢰도 숫자·판정 엔진·항목 id는 "자세히 보기"(기본 접힘)에만.
- **버튼** (키보드 1/2/3):
  - `같은 걸로 인정` → 항목 done(`level: human`). "다음부터 같은 경우는 자동으로 처리해 주세요"를 켜면 사전에 저장
  - `원래 자리로 다시 만들기` → 항목 doing, 다음 지시에 쉬운 말 이유 + 정식 경로
  - `잘 모르겠어요 — 안전하게 멈추기` → 그 항목만 blocked, 의존 항목은 대기, 나머지는 계속
  - `이 위치로 옮긴 걸 허락` (경로 차이일 때) → manifest·참조 항목 경로 일괄 갱신
- **자동 승인 없음**: 시간이 지나도 결정되지 않는다. 30분·2시간 뒤 알림만 다시 보낸다.
- 같은 세션 안에서 "방금 선택 취소"(사전 저장도 되돌림). 같은 종류 카드가 5장 이상이면 "한 번에 정할까요?" 묶음 제안.
- 결정 기록: `<프로젝트>/.harness-x/sessions/<세션>/approvals.jsonl` (시각·카드 id·선택·remember·화면 문구 원문).

### API (`harness-x serve --workspace <폴더>`)

| 요청                                                                                                            | 하는 일                                                                                                           |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `POST /api/compare` `{sessionId, itemId, itemTitle?, kind?, expected, actual, options?, semantic?}`             | 비교 파이프라인 실행 → `status: pass \| fail \| awaiting`(카드). 세션에 체크리스트가 있으면 항목에 비교 증거 기록 |
| `GET /api/approvals?status=pending` · `POST /api/approvals/:id {choice, remember}` · `POST /api/approvals/undo` | 승인 카드 목록·선택·방금 선택 취소 (WebSocket `approval_request`·`approval_resolved`)                             |
| `GET /api/notices`                                                                                              | 한 번만 보여 줄 안내 (예: 예전 판정 서비스 키 정리)                                                               |
