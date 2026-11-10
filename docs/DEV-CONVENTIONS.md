# 개발 규칙 (티켓 구현자용)

CLAUDE.md 규칙이 우선한다. 이 문서는 그 규칙을 이 저장소에서 실제로 지키는 방법이다.

## 환경

- 모든 셸 명령 앞에 `source scripts/dev/env.sh` (리눅스 Node 22.23 + 리눅스 pnpm 12). Windows `pnpm`을 쓰지 말 것.
- 저장소가 WSL `/mnt/c` 위에 있으면 모듈 로딩이 느리다(서버 기동 수 초~15초). 타이밍 테스트는 여유를 둔다.

## 티켓 진행

1. `scripts/dev/gen-ticket.sh T-xxx` → `docs/tickets/T-xxx.md`(status: doing) 생성.
2. 구현 + 테스트.
3. 항목마다 검증 명령을 실제로 실행하고 통과하면:
   `scripts/dev/tick.sh T-xxx N.M "결과(종료코드·요약)" "커밋 요약" <이 항목 파일들...>`
   (prettier → `pnpm lint` 전체 통과 확인 → 체크 → 커밋. lint 실패 시 아무것도 바뀌지 않는다)
4. 모든 항목이 [x]면 `sed -i 's/^status: doing/status: done/'` 후 커밋 `T-xxx: status: done`.

- 🖐 항목: 자동 검증 가능한 부분은 테스트로 확인하되 체크하지 않는다. 항목 아래 `  - awaiting-human: <확인할 내용/스크린샷 경로>`를 적는다. 남은 것이 🖐뿐이면 `status: awaiting-human`.
- 외부 조건 때문에 검증할 수 없는 항목은 체크하지 말고 `  - blocked: 사유`를 적는다. 절대 가짜로 체크하지 않는다.
- 커밋 메시지 끝: 빈 줄 + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (tick.sh가 자동으로 붙인다).

## 패키지 배치·이름

| 위치                                 | 패키지 이름                                        |
| ------------------------------------ | -------------------------------------------------- |
| `packages/protocol`, `kernel`, `sdk` | `@harness-x/protocol` 등                           |
| `packages/plugins-core/<x>`          | `@harness-x/<x>`                                   |
| `packages/plugins/<x>`               | `@harness-x/<x>`                                   |
| `packages/engines/<x>`               | `@harness-x/engine-<x>`                            |
| `apps/<x>`                           | `@harness-x/<x>` (`pnpm --filter <x>`로 선택 가능) |

- 새 패키지는 `packages/sdk`의 `package.json`·`tsconfig.json`을 본떠 만든다(`extends` 상대 경로 주의, `"type": "module"`, `build: tsc -p tsconfig.json`, `src/index.ts`).
- 다른 패키지는 `"@harness-x/<name>": "workspace:*"`로 의존하고 `@harness-x/<name>`로 import (ESM, 상대 import는 `.js` 확장자).
- 패키지 추가 후: `pnpm install && node scripts/dev/sync-aliases.mjs` (테스트가 src를 직접 쓰도록 별칭 동기화).
- `plugins-core`·`plugins` 패키지는 하네스 플러그인이기도 하다: 패키지 폴더에 `harness-plugin.json`(`main: "dist/index.js"`)을 둔다.

## 테스트

- `<패키지>/test/*.test.ts`, 루트 `pnpm test`가 전부 실행(타입 검사 포함, `expectTypeOf` 사용 가능).
- 임시 폴더는 `os.tmpdir()` 아래에 만들고 지운다. 포트는 0(임의)을 쓴다.
- 외부 CLI·네트워크는 기본적으로 모킹. "실제 1회" 항목만 실제로 실행하고 결과를 티켓에 적는다.
- 커널 테스트 도우미: `packages/kernel/test/helpers.ts`, `plugin-fixtures.ts`.

## 공유 파일

- 자기 티켓 산출물 밖의 파일은 꼭 필요할 때만 최소로 고친다(예: `src/index.ts`에 export 한 줄 추가).
- `pnpm-lock.yaml` 충돌은 `pnpm install`로 다시 만든다.
