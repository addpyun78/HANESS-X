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

- allow: packages/plugins-core/verifiers/ladder/src/candidates.ts|extMatch: ext === expExt — 후보 정렬용 점수(유사도), 판정 아님
- allow: packages/plugins-core/checklist-ledger/src/learn.ts|if (ee !== ae || eb === ab) continue; — 별칭 학습에서 조각 쌍 추출, 판정 아님
- allow: packages/plugins-core/checklist-ledger/src/store.ts|opts.expectedVersion !== actual — 낙관적 잠금 버전 충돌(정수 동시성 검사)
- allow: packages/plugins-core/checklist-ledger/src/manifest.ts|opts.expectedRevision !== cur.revision — 낙관적 잠금 개정 충돌
- allow: packages/plugins-core/forge/src/sandbox.ts|if (ex.expect.decision === undefined) { — 기대값이 없는지 확인(비교 아님)
- allow: apps/web/src/panels/Checklist/model.ts|a.expectExit !== undefined && a.expectExit !== 0 — 화면 표시 문구(기본값 0이면 생략)
- allow: packages/plugins-core/verifiers/ladder/src/ladder.ts|target === expKey — 판정 사유 문구 선택(기대 경로 자체인지 manifest 별칭 경로인지), 판정 아님
- allow: packages/plugins-core/installer/src/adapters/download.ts|meta.sha256 && meta.sha256 !== actual — 내려받은 파일 무결성(sha256) 검사, D.4 자동 엄격 대상과 같은 성격(해시는 정확히 같아야 함) (P1-G.1 때 추가, Part 2 코드)
- allow: packages/plugins-core/installer/src/adapter.ts|output.includes(plan.verify.expect) — 설치 확인 명령 출력에 기대 문구 포함 여부 (Part 2 코드, P1-G.1 때 추가 — 제안: Part 2에서 text 비교기 contains로 교체)
- allow: packages/plugins-core/verifiers/comparators/src/ — 비교기 구현 자체 (C.2에서 옮긴 경로 정규화 `isWithinKey`의 `childKey === parentKey` 포함)

## 해당 없음으로 분류한 것 (참고)

- `checklist-ledger/src/escalate.ts:decideL4`·`ladder/src/l4.ts:decideL4` — 판정 결과(enum) 분기, 기대/실제 비교 아님.
- `evidence.ts` schema 조건의 `k in v` — 필수 키 존재 검사(구조 검사). D.6 검사 패턴(`===`·`includes`·정규식)에 해당하지 않는다.
- `stop-guard.ts`·`naming.ts`·`glossary.ts`의 정규식 `.test(` — 입력 형식 검사(세션 id·단어 문자 종류).

## D.6 처리 결과

| # | 위치 | 바뀐 호출 |
| --- | --- | --- |
| 1 | `ladder/src/evidence.ts:defaultAcceptanceRunner` (command/test) | `compareValues('exitCode', expectExit, code)` + `expectOutput`이 있으면 `compareValues(compare.kind ?? 'auto', expectOutput, 출력)` |
| 2 | `ladder/src/evidence.ts:defaultAcceptanceRunner` (symbol) | `textComparator.equals(symbol, 파일 내용, ctx, {mode: 'contains'})` |
| 3 | `pathsEqualL1` | `comparators/src/comparators/path.ts` — `pathComparator.equals(…, {dictionary: false})` (ladder `normalize.ts`는 다시 내보내기, C.2) |
| 4 | `pathsEqualL2` | `comparators/src/comparators/path.ts` — `pathComparator.equals(…)` (ladder `alias.ts`는 다시 내보내기, C.2) |
| 5 | `ladder/src/ladder.ts:matchPrefix` | `pathComparator.equals(target, actual, ctx, {dictionary})` (C.2) |
| 6 | `forge/src/sandbox.ts:runExample` decision | `compareValues('exact', expect.decision, out.decision)` |
| 7 | `forge/src/sandbox.ts:runExample` reasonContains | `compareValues('text', want, reason, {mode: 'contains'}, semantic off)` |

검사: `packages/plugins-core/verifiers/comparators/test/compare-sites.test.ts` — 패턴이 위 7종을 잡는지 확인하고, `packages/**/src`·`apps/**/src`에서 허용 목록 밖 일치 0건을 확인한다.
