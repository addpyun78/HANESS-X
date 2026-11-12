# 시작 수치 (정리 전)

원본: docs/audit/baseline.json · 갱신 2026-11-12T14:10:50.741Z

| 항목                                          | 값                                |
| --------------------------------------------- | --------------------------------- |
| 테스트 수(전체/통과/실패/건너뜀)              | 4375 / 4368 / 3 / 4               |
| 커버리지 줄·분기·함수 %                       | 93.35 / 83.8 / 91.93              |
| 빌드 시간(초, 평균)                           | 173.7 (180.913, 173.854, 166.222) |
| 웹 번들 크기 / gzip (MB)                      | 17.8 / 6.7                        |
| 서버 시작 → 첫 응답(ms, 평균)                 | 88386 (88705, 88229, 88223)       |
| 저장소 크기 MB(소스·node_modules·.git·나머지) | 6.7 · 514.3 · 22.1 · 25.1         |
| 코드 파일 수 / 줄 수(빈 줄 제외)              | 577 / 73808                       |
| 설치 패키지 수 / 직접 외부 의존성 수          | 457 / 43                          |
| 흔들리는 테스트 수                            | 3                                 |

## 패키지별 코드

| 패키지                                      | 파일 | 줄    |
| ------------------------------------------- | ---- | ----- |
| apps/web                                    | 196  | 23787 |
| packages/engines/acp-generic                | 6    | 668   |
| packages/engines/antigravity                | 5    | 300   |
| packages/engines/claude-code                | 5    | 340   |
| packages/engines/codex                      | 7    | 919   |
| packages/engines/openai-compat              | 9    | 961   |
| packages/kernel                             | 79   | 13528 |
| packages/plugins-core/agent-builder         | 43   | 5331  |
| packages/plugins-core/approvals             | 12   | 1609  |
| packages/plugins-core/attachments           | 23   | 2558  |
| packages/plugins-core/checklist-ledger      | 29   | 5318  |
| packages/plugins-core/engine-scanner        | 17   | 917   |
| packages/plugins-core/forge                 | 17   | 2488  |
| packages/plugins-core/installer             | 18   | 4253  |
| packages/plugins-core/mcp-host              | 8    | 935   |
| packages/plugins-core/permission-gate       | 9    | 1289  |
| packages/plugins-core/tool-finder           | 23   | 1993  |
| packages/plugins-core/verifiers/comparators | 19   | 1250  |
| packages/plugins-core/verifiers/judge       | 12   | 1064  |
| packages/plugins-core/verifiers/ladder      | 12   | 1540  |
| packages/plugins/stt-browser                | 1    | 158   |
| packages/plugins/stt-local                  | 1    | 224   |
| packages/plugins/verifier-local             | 2    | 121   |
| packages/protocol                           | 16   | 1955  |
| packages/sdk                                | 3    | 180   |
| packages/sdk/templates/hook                 | 1    | 35    |
| packages/sdk/templates/panel                | 1    | 27    |
| packages/sdk/templates/pipeline             | 1    | 15    |
| packages/sdk/templates/skill                | 1    | 14    |
| packages/sdk/templates/tool                 | 1    | 31    |
