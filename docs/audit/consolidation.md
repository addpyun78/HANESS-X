# 통합 계획 (C-5)

원본: `docs/audit/raw/same-*.json`(같은 일 찾기), `docs/audit/raw/same-compare-*.json`(같은 입력 100개 비교), `docs/audit/raw/jscpd/jscpd-report.json`(복사 코드).

복사 코드 비율은 **0.21%**(src 76,240줄 중 162줄, 21묶음)로 낮습니다. 그래서 통합할 곳은 "같은 일을 하는 함수가 여러 벌 있는 곳"뿐입니다.

## 영역별 통합 판단

| 영역                | 구현 목록                                                                                                 | 대표로 남길 구현                                                                     | 동작 차이(같은 입력 100개)                                            | 영향 기능                                  | 위험도     | 판단                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------ |
| 쉬운 말 판정        | `agent-builder/src/designer/plain.ts` isPlain · `tool-finder/src/reasons.ts` isPlain                      | `approvals`의 `checkPlainKorean(s).ok`를 바로 쓰는 agent-builder 쪽(label 옵션 포함) | **0개**                                                               | 대화로 에이전트 만들기, 도구 추천 이유     | 낮음       | 통합 후보(자동 승인 규칙: 차이 0 + 위험 낮음)                                              |
| 경로 정규화         | kernel `toPosixForm`·`normalizePath` · pause-snapshot `toPosix` · checklist-ledger `normPath`             | kernel `path-normalize.ts`                                                           | 77개 (드라이브 문자·UNC 변환은 toPosixForm만, `./` 제거는 normPath만) | 일시정지 스냅샷, 단계 범위 검사, 경로 비교 | 보통       | 보류 — 각자 목적이 다름(동작이 바뀜)                                                       |
| AI 응답 JSON 뽑기   | openai-compat `extractJson`(비공개) · judge `extractJsonObject` · protocol `extractJsonObject`            | protocol `extractJsonObject`                                                         | 63개 (protocol은 실패 시 예외, 나머지는 undefined)                    | 로컬 모델 도구 호출, 판정 AI 답 읽기       | 보통       | 보류 — 실패 처리 방식이 다름                                                               |
| 시간 제한           | hooks `withTimeout` · loader `withTimeout` · engine-scanner `withTimeout`                                 | —                                                                                    | 64개 (거절 오류 종류가 다르거나 대체값으로 끝남 — 의도된 차이)        | 훅 실행, 플러그인 켜기, 엔진 검사          | 보통       | 보류 — 이름만 같고 약속이 다름                                                             |
| 비밀 마스킹         | kernel `maskSecrets` · attachments `maskSecretText` · diagnostics `redactSecrets`                         | kernel `maskSecrets`                                                                 | 90개 (가리는 패턴·표시 문구가 다름)                                   | 이벤트 기록, 첨부 글 형태, 진단 파일       | 높음(보안) | 보류 — 하나로 합치면 가리는 범위가 바뀜. 대신 "패턴 목록을 한 곳에서 공유"를 다음 티켓으로 |
| 자식 프로세스       | kernel `proc.ts`(spawnGroup·killTreeCommand·runLineProcess) · projects `runCli` · installer `runCommands` | kernel `proc.ts`                                                                     | 비교 안 함(용도 다름: 줄 단위 이벤트 / 한 번 실행 / 설치 단계)        | —                                          | —          | 통합 대상 아님                                                                             |
| 설정 읽기           | `readSetting`(값) · `readSettingsFile`(파일)                                                              | —                                                                                    | 용도 다름                                                             | —                                          | —          | 통합 대상 아님                                                                             |
| 승인·확인 카드 화면 | InstallPlanCard · MiniApprovalCard · ApprovalCard · PlanDoneCard · ConfirmCard                            | —                                                                                    | 화면 내용이 다름                                                      | —                                          | —          | 통합 대상 아님(공통 틀은 디자인 토큰으로 이미 맞춤)                                        |
| 엔진 실행 인자      | buildClaudeArgs · buildExecArgs(codex) · buildAgyArgs · buildJudgeCliArgs                                 | —                                                                                    | 엔진마다 다른 CLI                                                     | —                                          | —          | 통합 대상 아님                                                                             |

합치면 줄어드는 코드량: 통합 후보(isPlain)는 3줄 정도. 보류 4영역을 모두 합쳐도 약 60줄이라, **통합의 이득은 작고 동작이 바뀌는 위험이 큽니다.**

## 폴더 구조 제안 (C5.14) — 제안만, 자동 승인 규칙상 이동은 하지 않음

현재 트리(요약):

```
packages/
  kernel/src/            (79개 파일 — resume-*.ts 11개가 한 폴더에 평평하게 있음)
  protocol/ sdk/
  engines/{acp-generic,antigravity,claude-code,codex,openai-compat}
  plugins/{stt-browser,stt-local,verifier-local}      ← 커널이 불러오지 않는 "라이브러리 플러그인"
  plugins-core/{agent-builder,approvals,attachments,checklist-ledger,engine-scanner,forge,installer,mcp-host,permission-gate,tool-finder}
  plugins-core/verifiers/{comparators,judge,ladder}
apps/{web,desktop}
```

제안 트리:

```
packages/
  kernel/src/resume/     ← resume-*.ts 11개를 한 폴더로 (이동만으로 가능: 예, import 경로 수정 필요)
  libs/{stt-browser,stt-local}  ← "플러그인"이 아니라 라이브러리로 쓰이는 것 (이동만으로 가능: 아니오 — 패키지 이름·워크스페이스 설정 변경)
  plugins-core/...       (그대로)
```

| 제안                                        | 이동만으로 가능?                          | 이득                    | 위험 |
| ------------------------------------------- | ----------------------------------------- | ----------------------- | ---- |
| kernel `resume-*.ts` → `src/resume/`        | 예(`git mv` + import 경로 수정 커밋 분리) | 찾기 쉬움               | 낮음 |
| `packages/plugins/stt-*` → `packages/libs/` | 아니오(워크스페이스·별칭 변경)            | 이름이 실제 쓰임과 맞음 | 보통 |
| `verifier-local` 정리                       | 아니오(설정 4개 C2-004와 함께 결정)       | 효과 없는 설정 정리     | 보통 |

자동 승인 규칙의 "폴더 구조 이동 = 전부 제안만"에 따라 F.4·F.5에서는 옮기지 않습니다.
