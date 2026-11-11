# T-100 P1-A.2 — 기대값/실제값 직접 비교 지점 전수 조사

조사 범위: `packages/**/src`, `apps/**/src` (테스트·dist·node_modules 제외).
조사 방법: `===`/`!==`, `.includes(`, 정규식 `.test(`/`.match(`가 **기대값(expected·expect·acceptance 조건)과 실제값(출력·경로·결정)** 을 맞대는 줄을 찾았다.
(`grep -rnE "===|!==|includes\(|\.test\(|\.match\(" packages/*/src packages/*/*/src packages/*/*/*/src apps/*/src` 결과를 사람이 분류)

## 교체 대상 (D.6에서 비교기 호출로 바꾼다)

| # | 위치 (파일:함수) | 현재 비교 | 비교기 |
| --- | --- | --- | --- |
| 1 | `packages/plugins-core/verifiers/ladder/src/evidence.ts:defaultAcceptanceRunner` (command/test) | `code === acc.expectExit` | `exitCode` |
| 2 | `packages/plugins-core/verifiers/ladder/src/evidence.ts:defaultAcceptanceRunner` (symbol) | `text.includes(acc.symbol)` | `text` (`mode: contains`) |
| 3 | `packages/plugins-core/verifiers/ladder/src/normalize.ts:pathsEqualL1` | `normalizePath(a) === normalizePath(b)` | `path` (L1) |
| 4 | `packages/plugins-core/verifiers/ladder/src/alias.ts:pathsEqualL2` | `aliasKey(a) === aliasKey(b)` | `path` (L2, glossary) |
| 5 | `packages/plugins-core/verifiers/ladder/src/ladder.ts:matchPrefix` (kind=file) | `mapped(key) === mapped(expKey)` | `path` |
| 6 | `packages/plugins-core/forge/src/sandbox.ts:runExample` | `out.decision !== ex.expect.decision` | `exact` |
| 7 | `packages/plugins-core/forge/src/sandbox.ts:runExample` | `(out.reason ?? '').includes(ex.expect.reasonContains)` | `text` (`mode: contains`) |

## 허용 목록 (직접 비교 유지 — 기대값/실제값 판정이 아님)

D.6 검사(`packages/plugins-core/verifiers/comparators/test/compare-sites.test.ts`)는 아래 `allow:` 줄의 `파일|코드 조각`과 일치하는 줄을 건너뛴다.

- allow: packages/plugins-core/verifiers/ladder/src/normalize.ts|childKey === parentKey — 디렉터리 포함 관계(접두사) 계산, 동치 판정 아님
- allow: packages/plugins-core/verifiers/ladder/src/candidates.ts|extMatch: ext === expExt — 후보 정렬용 점수(유사도), 판정 아님
- allow: packages/plugins-core/checklist-ledger/src/learn.ts|if (ee !== ae || eb === ab) continue; — 별칭 학습에서 조각 쌍 추출, 판정 아님
- allow: packages/plugins-core/checklist-ledger/src/store.ts|opts.expectedVersion !== actual — 낙관적 잠금 버전 충돌(정수 동시성 검사)
- allow: packages/plugins-core/checklist-ledger/src/manifest.ts|opts.expectedRevision !== cur.revision — 낙관적 잠금 개정 충돌
- allow: packages/plugins-core/forge/src/sandbox.ts|if (ex.expect.decision === undefined) { — 기대값이 없는지 확인(비교 아님)
- allow: apps/web/src/panels/Checklist/model.ts|a.expectExit !== undefined && a.expectExit !== 0 — 화면 표시 문구(기본값 0이면 생략)
- allow: packages/plugins-core/verifiers/comparators/src/ — 비교기 구현 자체

## 해당 없음으로 분류한 것 (참고)

- `checklist-ledger/src/escalate.ts:decideL4`·`ladder/src/l4.ts:decideL4` — 판정 결과(enum) 분기, 기대/실제 비교 아님.
- `evidence.ts` schema 조건의 `k in v` — 필수 키 존재 검사(구조 검사). D.6 검사 패턴(`===`·`includes`·정규식)에 해당하지 않는다.
- `stop-guard.ts`·`naming.ts`·`glossary.ts`의 정규식 `.test(` — 입력 형식 검사(세션 id·단어 문자 종류).
