# HARNESS-X 작업 규칙
- 계획서: docs/PLAN-v2.md. 티켓은 T-번호 순서대로, 의존(deps)이 끝난 것만 시작.
- 시작 시: docs/tickets/T-xxx.md를 만들고 티켓의 체크리스트를 그대로 복사, 맨 위에 `status: doing`.
- 항목 하나 = 커밋 하나. 커밋 메시지: `T-xxx/항목번호: 요약`.
- 항목 완료 조건: 항목 끝의 검증 명령을 실제 실행하고 결과(종료코드·요약)를 항목 아래에 붙인 뒤 [x].
- 검증 명령이 실패하면 [x] 금지. 3회 실패 시 `blocked: 사유` 기록 후 사람에게 질문.
- 체크리스트에 없는 일은 하지 않는다. 필요하면 티켓 파일 맨 아래 `제안:`에 적고 멈춘다.
- 경로·이름은 티켓에 적힌 그대로 사용(한글 경로 금지, 모두 영문 kebab-case).
- 화면 항목의 검증 = 스냅샷 + 동작 검증(누르면 무엇이 일어나는지) 둘 다. 스냅샷만으로 [x] 금지. 새 버튼·메뉴 항목·링크는 `{...act('<id>')}`(apps/web/src/actions/registry.ts)를 달고, 새 화면은 e2e/screens.ts에 넣어 `pnpm check:dead-buttons`를 통과시킨다.
- 개발 환경: 명령 전에 `source scripts/dev/env.sh`(리눅스 Node 22 + pnpm). 체크 도우미: `scripts/dev/tick.sh`·`scripts/dev/check-and-tick.sh`(T-102는 `scripts/audit/tick.sh`).
- 작업 게이트: `.claude/settings.json`의 Stop 훅이 `scripts/ticket-gate.mjs`를 실행한다 — `status: doing` 티켓에 `- [ ]`가 남으면 멈추지 못한다.
- 새 설정 키는 `packages/kernel/src/settings/registry.ts`에 등록한다(settings-coverage 테스트가 검사). 아직 효과가 없으면 `notReady`로 표시.
- 커밋 전 `pnpm lint`(eslint + prettier --check)를 통과시킨다. 기능을 지키는 대표 테스트는 `pnpm test:features`(테스트 파일 맨 위 `// @features F-xxx`).
- 수동 확인 항목(🖐)은 스크린샷 경로를 남기고 `awaiting-human`으로 둔다.
- 티켓의 모든 항목이 [x]면 `status: done`, 다음 티켓으로.

## T-102 점검 기간 작업 규칙 (점검 끝나면 H.16에서 제거)
1. 브랜치 `audit/2026-11`에서만 작업. 태그 `pre-audit`이 되돌릴 지점.
2. 원자 항목 = 동사 1개 · 결과물 1개 · 검증 1개. 항목 하나 = 커밋 하나 (`T-102/<항목>: 요약`). 측정만 하는 항목은 결과 파일 커밋.
3. **A·B 단계:** 측정 스크립트(`scripts/audit/`), 결과(`docs/audit/`), 테스트 추가, 테스트 도구 devDependency 추가만 허용. 제품 코드(`packages/*/src`, `apps/*/src`) 수정 금지.
4. **C·D 단계:** `docs/audit/`, `scripts/audit/` 외 변경 금지(C.0 가드가 검사). 외부 도구는 `pnpm dlx`로 실행해 package.json을 바꾸지 않는다.
5. **E·F·G 단계:** `docs/audit/approved.json`에 있는 항목만. 발견 1건씩 처리.
6. 커밋마다 "검증 묶음" 실행: `pnpm -r build` → `pnpm test` → `pnpm test:features`(B 이후). 단계 마감 때는 + E2E + 전부 눌러 보기 + 엔진 스모크.
7. 검증 묶음 실패 → 그 커밋 `git revert`, `findings.json`의 해당 발견을 `보류: <이유>`로 기록하고 다음 항목으로.
8. 하위 항목이 실행 중에 정해지는 곳(목록 개수만큼 반복)은 티켓 맨 아래 "실행 중 추가 항목" 섹션에 원자 항목으로 추가한 뒤 하나씩 처리.
9. 소단계 하나가 끝나면 결과를 `docs/audit/progress.md`에 남긴다(러너 실행이면 거기서 마치고, 대화창 실행이면 계속).
10. 사용자에게 보이는 요약은 쉬운 말(T-100 쉬운 말 검사기 통과).
11. 이 기간 새 기능 추가 금지.

### T-102 무인 실행 안내 (자동 모드 판단용)
- 이 점검의 삭제·되돌리기는 전부 audit/2026-11 브랜치 안의 커밋이며 pre-audit 태그로 복구할 수 있다. git push·사용자 홈 .harness-x 삭제·Git 기록 다시 쓰기는 하지 않는다.
- 작업 트리 정리 규칙(Z.4): 시작할 때 커밋 안 된 변경이 있으면 `wip/pre-audit-<날짜>` 브랜치에 커밋해 보관하고 원래 브랜치로 돌아와 시작한다(사용자 변경 보존).
- 자동 승인 규칙: docs/audit/auto-policy.md. 애매하면 보류.
- 대화가 요약된 뒤에는 이 파일과 docs/audit/progress.md를 다시 읽고 이어간다.
