# T-100 P1-A.3 — Jev 사용처 전수 조사

명령: `grep -rni "jev\|typesafe\|systemone" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=.claude .`
조사 시점: master `7e200ed` (T-100 체크리스트 생성 직후). 일치 166줄 / 26파일 (아래 표의 줄 수 합).

`.claude`(다른 작업 트리)·`dist`(빌드 산출물)·`node_modules`는 제외했다. `docs/tickets/`(티켓·이 조사 파일)는 J.8 검사에서도 제외 대상이다.

| 파일 | 줄 수 | 종류 | 처리 (항목) |
| --- | --- | --- | --- |
| `packages/plugins/verifier-jev/**` (package.json, harness-plugin.json, src/client.ts, src/index.ts, test 3개, 스냅샷 1개) | 79 | Jev 클라이언트 패키지 본체 | 패키지 삭제 (J.1) |
| `pnpm-lock.yaml` | 4 | 워크스페이스 링크 3줄 + 무관한 패키지 integrity 해시 1줄(`…LjEv…`, 대소문자 무시 일치) | `pnpm install`로 링크 제거 (J.1). 해시 줄은 거짓 양성 — J.8 결과에 따로 적는다 |
| `tsconfig.test.json` | 1 | 테스트 별칭 `@harness-x/verifier-jev` | `sync-aliases.mjs`로 재생성 (J.1) |
| `packages/plugins-core/verifiers/ladder/package.json` | 1 | devDependency `@harness-x/verifier-jev` | 제거 (J.1) |
| `packages/plugins-core/verifiers/ladder/src/l4.ts` | 4 | `L4_MODES = ['jev','local','off']`, `verifier.l4` 선택, 팩토리 주석 | Jev 분기 삭제 (J.3), `verifier.l4` 폐기 → `judge.*` (J.4·J.5) |
| `packages/plugins-core/verifiers/ladder/test/ladder.l4-select.test.ts` | 12 | `JevClient`로 L4 선택 테스트 | Jev 케이스 삭제·로컬만 남김 (J.3) |
| `packages/plugins/verifier-local/harness-plugin.json`, `src/ollama.ts` | 2 | "Jev와 같은 질문 형식" 설명 문구 | 문구 수정 (J.7) |
| `packages/protocol/src/verifier.ts` | 3 | 주석 "L4(Jev·로컬 LLM)", 판정기 ID 예시 | 문구 수정 (J.7) |
| `packages/protocol/test/manifest-schema.test.ts` | 2 | 매니페스트 예시 id `verifier-jev`, net 도메인 `*.jev.example` | 중립 예시로 교체 (J.7) |
| `packages/plugins-core/checklist-ledger/test/export.test.ts` + 스냅샷 | 3 | 판정 사유 예시 `(Jev)` | 중립 문구로 교체 (J.7) |
| `apps/web/src/composer/types.ts` | 2 | 판정 사다리 L4 라벨 `'Jev'` (렌더러·패널 표시) | `'AI 판단'`으로 교체 (J.7) |
| `apps/web/test/checklist-fixtures.tsx`, `panels.checklist.detail.test.tsx` + 스냅샷 | 4 | 패널 픽스처 사유 문구 `Jev: …` | 중립 문구로 교체 (J.7) |
| `docs/PLAN-v2.md` | 18 | 계획서의 Jev 조사·T-026 설명·결정 필요 사항·참고 링크 | T-100 결정(사용자 설정 AI → 로컬 → 구독 엔진 → 승인 카드)으로 문구 교체 (J.7) |
| `docs/tickets/T-026.md`, `docs/tickets/T-100.md` | 21 | 완료 티켓 기록·이 티켓 | 유지 (티켓 파일은 J.8 제외 대상) |

## 코드 밖 사용처

- **키체인**: `verifier-jev`는 키를 키체인이 아니라 환경변수 `JEV_API_KEY`(또는 설정 `apiKeyEnv`)에서 읽었다. 그러나 사용자가 키체인에 넣었을 수 있는 계정(`harness-x` 서비스의 `verifier:jev`, `engine:jev`, `jev`)은 J.6에서 한 번 지운다.
- **설정**: `verifier.l4 = jev | local | off`(기본 off), `verifier.jev.{endpoint, apiKey, apiKeyEnv, timeoutMs, model}`. 설정 스키마 파일은 따로 없고 `l4ModeFrom(config)`이 직접 읽었다 → J.4·J.5.
- **plugins.lock**: `~/.harness-x/plugins.lock`(실행 시 생성)에 `verifier-jev` 항목이 남아 있을 수 있다 → J.2.
- **네트워크**: `JevClient`가 설정된 endpoint로 `POST /chat/completions`. 기본 endpoint 없음(설정 필수). 테스트는 모두 `https://jev.example` 모킹 → J.9에서 Jev 도메인 차단 레이어 추가.
- 차단 대상 도메인(J.9 테스트가 이 줄을 읽는다): `api.typesafe.ai`
- 삭제된 플러그인 id(J.2 테스트가 이 줄을 읽는다): `verifier-jev`
- 예전 설정 값·절 이름(J.5·J.6 테스트가 이 줄을 읽는다): `jev`

## 코드에 이름을 남기지 않는 방법 (J.8)

마이그레이션은 서비스 이름을 하드코딩하지 않는다. 사용자 설정에 남아 있는 `verifier.l4` 값과 `verifier.<이름>` 절(계속 쓰는 `local` 제외)을 "삭제된 판정 서비스"로 보고, 그 이름으로 키체인 계정·`plugins.lock` 항목(`verifier-<이름>`)을 지운다. 이름이 꼭 필요한 테스트는 위 세 줄을 읽어 쓴다.
