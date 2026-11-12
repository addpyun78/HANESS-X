# 용량 보고 (C-3)

원본: docs/audit/raw/size-_.json, git-_.json, bundle-top.json, heavy-deps.json, dup-versions.json

| 종류                                             | 지금 크기(MB)                      | 줄일 수 있는 양(추정)                                                                                              |
| ------------------------------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 작업자 복사본(.claude/worktrees, 저장소 밖 취급) | 9718.6 (어림, 39개 × 표본 249.2MB) | 거의 전부(9718.6MB) — 끝난 작업자 복사본이면 지워도 됨, 단 자동 삭제 대상 아님(보류·사람 결정)                     |
| 의존성 node_modules                              | 514.3 (27곳)                       | 작음 — 같은 큰 버전 중복 정리(pnpm dedupe) 정도. 여러 버전 16종은 대부분 큰 버전이 달라 못 합침                    |
| pnpm 저장소(저장소 밖)                           | 517.2                              | `pnpm store prune`으로 안 쓰는 판 정리 가능(점검 범위 밖, 제안만)                                                  |
| 빌드 결과 dist(추적 안 함)                       | 22.5                               | 0 — 다시 빌드하면 생김(Git 추적 안 함)                                                                             |
| 웹 번들(apps/web/dist)                           | 17.8 / gzip 6.7                    | 코드 편집기(monaco) 언어 작업자: ts 6.7MB·css·html·json — 쓰는 언어만 남기면 수 MB 줄 수 있음(동작 영향 확인 필요) |
| 소스 코드(src)                                   | 2.8                                | 통합(C-5) 결과에 따라 조금                                                                                         |
| 테스트 데이터·녹화                               | 0.4 (184개)                        | 0 — 작음                                                                                                           |
| .git                                             | 26.3 (느슨한 객체 6374개)          | `git gc`로 느슨한 객체 묶기(기록은 그대로) — 수 MB                                                                 |

## 사용자 데이터 — 보고만, 삭제 대상 아님

| 항목                         | 크기                |
| ---------------------------- | ------------------- |
| 하네스 홈(~/.harness-x) 합계 | 1.2MB               |
| drafts                       | 0MB                 |
| engines.json                 | 0MB                 |
| logs                         | 1.2MB               |
| plugins.lock                 | 0MB                 |
| run                          | 0MB                 |
| sessions                     | 0MB                 |
| 하네스 로그·이벤트           | 1.2MB (6개)         |
| 로컬 모델                    | 없음(ollama 미설치) |

## 설치 크기가 큰 의존성 상위 8

| 패키지                                          | MB   |
| ----------------------------------------------- | ---- |
| monaco-editor@0.57.0                            | 97   |
| pretendard@1.3.9                                | 93.1 |
| @anthropic-ai+claude-agent-sdk@0.2.83_zod@4.6.7 | 58.4 |
| typescript@5.8.3                                | 21.8 |
| @tauri-apps+cli-linux-x64-gnu@2.12.4            | 19   |
| @img+sharp-libvips-linux-x64@1.2.4              | 15.9 |
| esbuild@0.28.2                                  | 11   |
| @esbuild+linux-x64@0.28.2                       | 10.9 |

## Git 기록 속 큰 객체 (보고만, 기록 다시 쓰기 안 함)

- docs/audit/raw/test-run-1.json 1.9MB
- docs/audit/raw/done-items.json 0.5MB
- docs/audit/raw/eslint.json 0.3MB
- docs/audit/feature-map.json 0.3MB
- docs/audit/feature-map.json 0.3MB

점검 결과 파일(raw/test-run-*.json, 각 약 2MB)이 가장 큽니다 — 점검 기록이라 남깁니다.
