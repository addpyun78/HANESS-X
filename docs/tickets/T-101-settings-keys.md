# T-101 0A.1 — 코드에서 읽는 설정 키 전수 조사

조사 방법 (2026-11-12, 브랜치 기준선 `be5e3bf`):

```sh
grep -rn "settings\.json\|SETTINGS_FILE\|engines-settings" packages apps --include=*.ts --include=*.tsx
grep -rnE "parse(Judge|Builder|Tools|Assist)Settings|judgeSettingsFrom|loadEnginesSettings|readBuilderSettings" packages apps
grep -rnE "['\"\`](judge|builder|tools|assist|verifier)\.[a-zA-Z]" packages apps
grep -rn "localStorage" apps/web/src
grep -rn "process\.env\.HARNESS" packages apps
grep -rn "configSchema\|secrets\.get\|BRAVE_SECRET_ACCOUNT" packages
```

(`node_modules`·`dist`·`*.test.*` 제외)

## 1. 전체 설정 파일 `~/.harness-x/settings.json` (중첩 객체)

| 키                         | 형식                          | 기본값       | 읽는 곳 (설정 접근 함수)                                                                                                   | 읽는 시점          |
| -------------------------- | ----------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `judge.engine`             | string (빈 값 = 자동)         | `''`         | `verifiers/ladder/src/runtime.ts:176` `judgeSettingsFrom` → `verifiers/judge/src/settings.ts` `parseJudgeSettings`         | 시작 시 1회        |
| `judge.model`              | string                        | `''`         | 위와 같음                                                                                                                  | 시작 시            |
| `judge.samples`            | int 1~3                       | `3`          | 위와 같음                                                                                                                  | 시작 시            |
| `judge.maxCallsPerSession` | int ≥0                        | `50`         | 위와 같음                                                                                                                  | 시작 시            |
| `judge.semantic`           | `on`\|`off`                   | `on`         | 위와 같음 + `ladder/src/settings.ts` 마이그레이션(`to['judge.semantic']`)                                                  | 시작 시            |
| `judge.local.model`        | string                        | `''`         | `judge/src/settings.ts` `JudgeLocalSettingsSchema`                                                                         | 시작 시            |
| `judge.local.timeoutMs`    | int 1000~600000               | `20000`      | 위와 같음                                                                                                                  | 시작 시            |
| `verifier.local.baseUrl`   | string                        | (없음)       | `plugins/verifier-local/src/ollama.ts` `localSettingsFrom` (`verifier.local` 은 ladder `KEPT_VERIFIER_NAMES` 로 보존되는 절) | 시작 시            |
| `verifier.local.model`     | string                        | (없음)       | 위와 같음                                                                                                                  | 시작 시            |
| `verifier.local.timeoutMs` | number                        | (없음)       | 위와 같음                                                                                                                  | 시작 시            |
| `builder.engine`           | string (빈 값 = 세션 기본)    | `''`         | `agent-builder/src/designer/wire.ts:26` `readBuilderSettings` → `designer/settings.ts` `parseBuilderSettings`              | 요청마다           |
| `builder.maxQuestions`     | int 0~3                       | `3`          | 위와 같음                                                                                                                  | 요청마다           |
| `builder.animation`        | boolean                       | `true`       | 위와 같음 (화면 쪽 사본: 브라우저 `hx.builder.animation`, 아래 4절)                                                        | 요청마다           |
| `tools.budget`             | `free-only`\|`free-first`\|`any` | `free-first` | `tool-finder/src/finder.ts:120` `parseToolsSettings` (`tool-finder/src/settings.ts`)                                    | 도구 찾기 만들 때  |
| `tools.searxng`            | string (빈 값 = 끔)           | `''`         | 위와 같음                                                                                                                  | 도구 찾기 만들 때  |
| `tools.brave`              | boolean                       | `false`      | 위와 같음                                                                                                                  | 도구 찾기 만들 때  |
| `assist.engine`            | string (빈 값 = judge.engine) | `''`         | `tool-finder/src/settings.ts` `parseAssistSettings` (`assist.ts` 주석 P3-A.5)                                              | 요청마다           |
| `assist.model`             | string                        | `''`         | 위와 같음                                                                                                                  | 요청마다           |

폐기 키 (등록하지 않음, 읽으면 오류/자동 이전): `verifier.l4`, `verifier.<삭제된 외부 판정 이름>` — `ladder/src/settings.ts` `legacyVerifierKeys`·`migrateVerifierConfig`.

## 2. 엔진 설정 파일 `~/.harness-x/engines-settings.yaml`

| 키                       | 형식                        | 읽는 곳                                                                             |
| ------------------------ | --------------------------- | ----------------------------------------------------------------------------------- |
| `engines.<id>.mode`      | `subscription`\|`apiKey`    | `kernel/src/engines-settings.ts` `loadEnginesSettings` (cli.ts:356, engines-routes) |
| `engines.<id>.model`     | string                      | 위와 같음                                                                           |
| `engines.<id>.fallback`  | 엔진 id 또는 목록           | 위와 같음                                                                           |

엔진 id 별 묶음이라 레지스트리에는 `engines` 한 키(맞춤 위젯 `engine-settings`, 저장 위치 `engines-file`)로 등록한다.

## 3. OS 키체인 (`kernel/src/secrets.ts`, 서비스 `harness-x`)

| 계정             | 뜻                     | 읽는 곳                                                       | 레지스트리                               |
| ---------------- | ---------------------- | ------------------------------------------------------------- | ---------------------------------------- |
| `engine:<id>`    | 엔진 API 키            | `secrets.ts` `getApiKey` / `buildEngineEnv`, engines-routes   | `engines` 키(엔진 화면)에 포함           |
| `brave-search`   | Brave 검색 키          | `tool-finder/src/providers/web.ts` `BRAVE_SECRET_ACCOUNT`     | `tools.braveKey` (위젯 `secret`)         |

## 4. 브라우저 저장소 (`localStorage`, apps/web)

| 저장 이름                    | 뜻                              | 레지스트리                                        |
| ---------------------------- | ------------------------------- | ------------------------------------------------- |
| `hx-theme`                   | 화면 테마 system/light/dark     | `ui.theme` (저장 위치 `browser`)                  |
| `hx.stt.provider`            | 음성 입력 방식 local/browser/off | `voice.provider` (저장 위치 `browser`)            |
| `hx.builder.animation`       | 초안 조립 애니메이션            | `builder.animation` 의 화면 쪽 사본 (같은 키로 봄) |
| `hx-token`                   | 서버 접속 열쇠                  | 설정 아님 (비밀, 화면 노출 금지)                  |
| `hx-layout`                  | 열 너비·패널 순서               | 설정 아님 (화면 상태)                             |
| `hx.approvals.notify-asked`  | 알림 권한을 이미 물었는지       | 설정 아님 (한 번 묻기 기록)                       |

## 5. 설정이 아닌 것 (조사했지만 레지스트리 밖)

- 환경 변수 `HARNESS_X_HOME`·`HARNESS_X_API`·`HARNESS_X_TOKEN`·`HARNESS_X_OLLAMA_URL` — 실행 환경 지정, 화면 설정 아님.
- `~/.harness-x/workspaces.json` (최근 폴더) — 0-2 프로젝트 목록이 대신함.
- `plugins.lock`·`trust.json`·`engines.json`(스캔 결과) — 내부 기록.
- 플러그인 `harness-plugin.json` 의 `configSchema` — 지금 이 저장소의 플러그인 중 쓰는 곳 없음. 0A.9에서 `plugins.<플러그인 id>.*` 로 자동 포함.

## 6. 다른 구역에서 새로 생길 키 (등록 자리만 만들어 둠)

`mode.default`(3A.2), `main.engine`·`main.model`(5C.3), `attachments.*`(1A.5) 등 — 레지스트리 그룹 `mode`·`ai`·`attachments` 에 각 구역 작업자가 등록한다.
