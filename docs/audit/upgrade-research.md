# HARNESS-X 업그레이드 제안서 — "레고처럼 끼우고 빼는 에이전트 만들기"

작성일: 2026-11-12 · 범위: 조사·제안만(코드 수정 없음) · 대상: `/mnt/c/agentCli/harness-x`

> 기준(사용자 말 그대로): "도구, 스킬, 플러그인 등 각종 앱을 레고처럼 끼우고 빼면서 원하는 에이전트를 아주 쉽게 만드는 시스템. 코딩 완전 초보자, 로직도 모르는 사람이 쓰기 편해야 한다."

---

## 0. 한눈에 보기

| 항목                 | 점수            | 한 줄 평                                                                                         |
| -------------------- | --------------- | ------------------------------------------------------------------------------------------------ |
| 부품(블록) 종류 갖춤 | 8/10            | 노드·플러그인·스킬·엔진·도구 5종 블록, 설치 관리자·도구 추천·Forge까지 있음                      |
| 끼우기·빼기 조작     | 6/10            | 스킬·엔진 끌어 놓기, 플러그인 묶음 펼치기, 되돌리기 50단계 있음. 단, "안 맞는 블록" 안내가 약함  |
| 말로 만들기          | 8/10            | 대화로 초안 → 캔버스, 말로 고치기(변경 미리보기), 초안 버전까지 있음                             |
| 초보자 말투(용어)    | 3/10            | 빌더 화면에 `노드`·`스키마`·`YAML`·`fanout`·`인증 모드`·`워크스페이스` 등이 그대로 보임          |
| 시작점(템플릿)       | 3/10            | "빈 캔버스 / 플러그인 / 복제 / 말로" 4가지. 쓰임새별 완성 예시(템플릿)는 사실상 1개(design-qa)   |
| 미리 해 보기(시험)   | 5/10            | 비용 0 "드라이런(엔진을 안 부르는 모의 실행)"만 있음. 진짜 결과를 안전하게 보는 시험 모드는 없음 |
| 권한·비용 표시       | 6/10            | 초안 요약 카드에 권한을 쉬운 말로 보여 줌, 시험 실행에 추정 비용. 캔버스 블록 자체에는 표시 없음 |
| 오류를 쉬운 말로     | 4/10            | 승인 카드는 훌륭하나 빌더의 오류(비호환 선, JSON 오류, 저장 실패)는 개발자 말투                  |
| 공유·내보내기        | 2/10            | 설정 내보내기만 있음. 만든 에이전트를 파일/링크로 주고받는 기능은 찾지 못함                      |
| **합계**             | **45/90 (50%)** | 뼈대는 이미 거의 다 있다. **"말투·시작점·안전한 시험·공유"** 네 가지가 초보자를 막는다           |

**핵심 결론:** 새로 크게 만들 것보다, 이미 있는 부품(쉬운 말 검사기, 승인 카드, 드라이런, 설치 관리자, 초안 버전)을 **빌더 화면으로 끌어와 연결**하는 일이 효과가 가장 크다.

---

## 1. 현재 시스템 진단 (초보자 눈으로)

### 1-1. 지금 되는 것 (근거 파일)

| 기능                 | 어떻게 되나                                                                                                                                 | 근거                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 빌더 3칸 화면        | 왼쪽 블록 서랍 · 가운데 캔버스(React Flow, 16px 격자) · 오른쪽 속성 칸(인스펙터)                                                            | `apps/web/src/builder/BuilderPage.tsx`, `Canvas.tsx`, `Drawer.tsx`                                             |
| 블록 서랍 5탭 + 검색 | 노드·플러그인·스킬·엔진·도구, 검색창                                                                                                        | `apps/web/src/builder/catalog.ts`(`DRAWER_TABS`), `Drawer.tsx`                                                 |
| 레고 끼우기·빼기     | 스킬 칩 장착/분리/순서 이동, 엔진 지정, 플러그인 파이프라인을 묶음(점선 틀)으로 펼치고 통째로 이동·분리                                     | `apps/web/src/builder/lego/model.ts`(`legoReducer`), `LegoNode.tsx`, `GroupFrame.tsx`, `dnd.ts`                |
| 맞지 않는 연결 표시  | 출력→입력 형식이 안 맞으면 빨간 선 + "⚠ 비호환" 배지                                                                                        | `apps/web/src/builder/lego/CompatEdge.tsx`, `@harness-x/protocol`의 `checkSchemaCompat`                        |
| 되돌리기             | Ctrl+Z/Y 50단계, AI 변경도 한 단계로                                                                                                        | `apps/web/src/builder/lego/history.ts`, T-100 P4-E.7                                                           |
| 시작 선택 4가지      | 빈 캔버스 / 플러그인에서 시작 / 기존 에이전트 복제 / 말이나 글로 설명                                                                       | `apps/web/src/builder/StartChoice.tsx`, `start.ts`                                                             |
| 말로 만들기          | 자산 전수조사 → AI 초안 → 되묻기(최대 3개, 선택지 버튼) → 지어낸 부품 차단 → 빈 칸(gap) 빨간 점선 + [도구 찾기][Forge로 만들기][이 칸 빼기] | `packages/plugins-core/agent-builder/src/designer/`, `inventory/`, `apps/web/src/builder/draft/`, T-100 Part 4 |
| 말로 고치기          | 변경분(JSON Patch)만 받아 노란색 강조 + [적용][취소] 미리보기, 직접 고친 칸 보호, 초안 v1·v2…                                               | `apps/web/src/builder/draft/DraftCards.tsx`, `useDraftSession.tsx`                                             |
| 시험 실행(드라이런)  | 엔진을 부르지 않고 순서·추정 비용을 캔버스에 덧씌움                                                                                         | `apps/web/src/builder/inspector/dryrun.ts`, `DryRunTab.tsx`                                                    |
| 저장은 사람만        | 1회용 토큰, 저장 전 점검표, 이름 중복 검사, 빈 칸 있으면 회색 표시                                                                          | T-100 P4-F, `apps/web/src/builder/draft/SaveDialog.tsx`, `inspector/SaveBar.tsx`                               |
| 부품 설치            | 앱·도구·모델·MCP·플러그인 설치 계획 카드 → 승인 → 설치 → 검증 → 목록 등록                                                                   | `packages/plugins-core/installer/src/`(`adapters/mcp.ts`, `plugin.ts` 등), `apps/web/src/install/`             |
| 도구 추천            | 필요한 능력 → 패키지 저장소·웹 검색 → 2~5개, 무료/유료 표시 → 고르면 설치 카드                                                              | `packages/plugins-core/tool-finder/src/finder.ts`                                                              |
| 부품 직접 만들기     | Forge 인터뷰(최대 5문항) → 뼈대 → 검사 → 격리 시험 → 설치                                                                                   | `packages/plugins-core/forge/`, `packages/sdk/templates/`(skill·tool·hook·pipeline·panel)                      |
| 쉬운 말 검사기       | 금지어 0·문장 45자·존댓말·영어 30% 이하                                                                                                     | `packages/plugins-core/approvals/src/plain-korean.ts`                                                          |
| 쉬운 말 승인 카드    | "무슨 일이 있었나요?/왜 제가 못 정했나요?" + 자세히 보기 접기                                                                               | `packages/plugins-core/approvals/`, `apps/web/src/panels/Approvals/`                                           |
| 설정 화면            | 그룹별 설정 + 검색·고급·내보내기/가져오기                                                                                                   | `packages/kernel/src/settings/registry.ts`, `apps/web/src/settings/sections/TransferSection.tsx`               |
| 버튼 등록부          | 화면 버튼마다 `act('<id>')` 등록, 동작 없는 버튼 검사                                                                                       | `apps/web/src/actions/registry.ts`, `pnpm check:dead-buttons`                                                  |

### 1-2. 초보자가 막히는 곳 (구체 증거)

| #   | 막히는 곳                                   | 증거                                                                                                                                                                                                                                                                                                                                                    | 초보자에게 일어나는 일                                                                                                                                                                         |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | **개발 용어가 그대로 보임**                 | 서랍 탭 `노드`·`엔진`(`catalog.ts` `DRAWER_TAB_LABEL`), 노드 설명 "판정기로 검사, 실패 항목만 되돌림", "나가는 갈래를 병렬 실행"(`NODE_DESC`), 인스펙터 칸 "입력 스키마/출력 스키마"·"인증 모드: 구독/API 키"·"워크스페이스 쓰기/전체"(`inspector/NodeFields.tsx`), "YAML 보기" 탭(`YamlTab.tsx`), 드라이런 안내 "엔진을 부르지 않고…"(`DryRunTab.tsx`) | 쉬운 말 검사기의 금지어(`schema`, `YAML`, `JSON`, `API`, `token`…)가 **빌더 화면에는 적용되지 않음**(`apps/web/src`에서 검사기 사용처를 찾지 못함). 승인 카드만 쉬운 말이고 빌더는 개발자 말투 |
| B2  | **"로직" 블록을 먼저 고르게 함**            | 빈 캔버스 → "노드" 탭에 role·gate·fanout·join·loop·router·subagent 7종                                                                                                                                                                                                                                                                                  | 초보자는 "갈래·모음·반복"이 왜 필요한지 모름. Scratch 연구도 "구조 블록은 모양으로 막아 줘야 한다"고 말함                                                                                      |
| B3  | **안 맞는 블록을 끌어도 조용히 무시**       | `LegoNode.tsx`의 `accepts()`가 맞을 때만 강조, 안 맞으면 그냥 무시                                                                                                                                                                                                                                                                                      | "왜 안 붙지?"를 알 길이 없음                                                                                                                                                                   |
| B4  | **비호환 연결이 만들어지고 나서야 빨간 선** | `CompatEdge.tsx` — 연결은 허용, 사유는 툴팁(마우스를 올려야 보임)                                                                                                                                                                                                                                                                                       | 사유도 형식(스키마) 비교 문장이라 이해 불가, 고치는 버튼 없음                                                                                                                                  |
| B5  | **시작점이 빈약**                           | `StartChoice.tsx` 4가지 중 "플러그인에서 시작"은 파이프라인을 가진 플러그인만, 예시 에이전트는 `examples/agents/design-qa` 1개                                                                                                                                                                                                                          | "무엇을 만들 수 있는지" 그림이 없음. 다른 도구들은 수십~수천 개 템플릿으로 시작                                                                                                                |
| B6  | **진짜 시험이 없음**                        | `dryrun.ts`는 엔진을 부르지 않는 모의 실행(비용 0, 추정치만)                                                                                                                                                                                                                                                                                            | "내 에이전트가 진짜로 뭘 내놓나?"를 저장 전에 볼 수 없음. 저장 후 실제 실행은 실제 파일을 건드릴 수 있음                                                                                       |
| B7  | **권한·비용이 블록에 안 보임**              | 권한 요약은 초안 요약 카드(P4-D.3)에만, 비용은 드라이런 탭에만                                                                                                                                                                                                                                                                                          | 블록을 끼우는 순간 "이걸 끼우면 파일을 고칠 수 있게 돼요/돈이 들어요"를 모름                                                                                                                   |
| B8  | **빌더 오류가 개발자 말투**                 | 인스펙터 JSON 입력칸 "잘못된 JSON이면 오류 표시"(`NodeFields.tsx` 168행), `start.ts`의 `플러그인 파이프라인을 찾을 수 없음: <id>` 예외                                                                                                                                                                                                                  | 무엇을 눌러 고쳐야 하는지 안내 없음                                                                                                                                                            |
| B9  | **공유·내보내기 없음**                      | 내보내기는 설정 YAML만(`TransferSection.tsx`). 에이전트 묶음 내보내기·가져오기는 찾지 못함                                                                                                                                                                                                                                                              | 친구·동료에게 "내가 만든 에이전트"를 줄 수 없음                                                                                                                                                |
| B10 | **설치와 빌더가 따로 놂**                   | 설치 관리자(`apps/web/src/install/`)·도구 추천(`ToolPicker`)이 빌더 서랍과 별도 화면                                                                                                                                                                                                                                                                    | 서랍에 원하는 블록이 없으면 막다른 길("맞는 블록이 없습니다", `Drawer.tsx` 56행)                                                                                                               |
| B11 | **빈 화면**                                 | "빈 캔버스"를 고르면 정말 빈 캔버스                                                                                                                                                                                                                                                                                                                     | 첫 블록을 무엇으로 할지 모름. 안내 문구·첫 블록 자리 없음                                                                                                                                      |
| B12 | **되돌리기 범위가 화면 안**                 | 되돌리기는 캔버스 편집만. 저장한 에이전트의 이전 판, 설치 취소는 다른 곳                                                                                                                                                                                                                                                                                | "어제 잘 되던 상태로" 돌아가기 어려움                                                                                                                                                          |

---

## 2. 세계 사례 조사 — 초보자에게 효과가 있는 패턴만

| 사례                                    | 효과 있는 패턴                                                                                                                                          | HARNESS-X에 주는 교훈                                                                                                                                                                                                                 | 출처                                                                                                                                                                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OpenAI Agent Builder (AgentKit)**     | 끌어 놓는 캔버스, 템플릿 또는 빈 캔버스로 시작, 맨 위에 "미리 보기(Preview)·평가·게시" 버튼, 안전장치(가드레일)·"사람 승인" 블록이 서랍에 블록으로 존재 | 승인·안전장치를 **블록**으로 만들면 초보자도 "여기서 내가 확인" 을 끼울 수 있음. ⚠ 2026-06-03 종료 발표(2026-11-30 종료) — 자연어 쪽은 "Workspace Agents"로 옮김. **캔버스만으로는 해자가 안 된다 → 말로 만들기가 주, 캔버스는 보조** | https://openai.com/index/introducing-agentkit/ · https://mcp.directory/blog/openai-agentkit-deprecation-2026 · https://www.nocode.tech/article/openai-is-killing-its-no-code-agent-builder-heres-what-that-tells-us-about-the-real-no-code-moat |
| **Google Opal**                         | 말로 설명 → 단계 그림(워크플로) 자동 생성, **말로 고치기 ↔ 끌어서 고치기를 자유롭게 오감**, 남의 앱을 "리믹스(복사해 고치기)", 링크로 공유              | 지금의 "말로 고치기 + 캔버스"를 한 화면에서 동시에 쓰게, "리믹스" 버튼과 링크/파일 공유                                                                                                                                               | https://developers.googleblog.com/en/introducing-opal/ · https://www.infoq.com/news/2025/07/google-opal-ai                                                                                                                                      |
| **n8n AI Workflow Builder**             | 예시 문장(프롬프트)을 골라 시작, 만드는 과정을 단계별로 보여 줌, 만든 뒤 검증은 여전히 필요                                                             | "예시 문장 카드"로 첫 입력 부담 제거, 조립 과정 실시간 표시(이미 P4-D.2 조립 애니메이션 있음)                                                                                                                                         | https://docs.n8n.io/advanced-ai/ai-workflow-builder · https://claude.com/customers/n8n                                                                                                                                                          |
| **Microsoft Copilot Studio**            | 설명만 쓰면 설정 생성, **오른쪽 "시험 창(Test pane)"이 만드는 동안 실시간 반영**, 시험 대화를 다시 쓸 수 있는 시험 사례로 저장, 시험 사례 자동 생성     | 빌더 오른쪽에 "시험 대화" 칸 상시 배치, 시험 대화를 "확인 목록(체크리스트 시험)"으로 저장                                                                                                                                             | https://learn.microsoft.com/microsoft-copilot-studio/agents-experience/overview · https://learn.microsoft.com/en-us/training/modules/create-copilots-copilot-studio/copilot-creation-with-natural                                               |
| **Zapier Agents / Copilot**             | 템플릿이 80%를 주고 나머지를 말로 다듬음, 지시문 다듬기 도우미                                                                                          | "템플릿 + 말로 다듬기" 조합이 초보자에게 가장 빠름                                                                                                                                                                                    | https://zapier.com/blog/zapier-agents-guide/ · https://www.zapier.com/blog/introducing-zapier-ai-agents/                                                                                                                                        |
| **Lindy / Gumloop**                     | 1,000개+ 템플릿·클릭 위주(Lindy)가 초보자에게 가장 쉽다는 평, 가지가 5~6단계를 넘으면 불안정(Gumloop 평)                                                | **단계 수를 짧게** 유지하도록 권장(6블록 넘으면 안내), 템플릿 수가 곧 쉬움                                                                                                                                                            | https://www.lindy.ai/blog/how-create-ai-agents · https://beginnersinai.org/gumloop-vs-lindy/ (경쟁사 글이 섞여 있어 참고만)                                                                                                                     |
| **Make AI Agents**                      | 같은 캔버스에서 만들고·돌리고·고침, **"생각 과정(Reasoning) 패널"로 왜 그 도구를 골랐는지 보여 줌**, Grid = 전체 자동화 지도 + 비용                     | 실행 후 블록마다 "왜 이렇게 했나요?" 보기, 내 에이전트 전체 지도                                                                                                                                                                      | https://www.make.com/en/blog/make-ai-agents-trust-through-transparency · https://help.make.com/meet-the-new-make-ai-agents-app                                                                                                                  |
| **Dify / Flowise**                      | 파일(DSL) 하나로 내보내기·가져오기, 템플릿 마켓에 올리기(검수 있음), 비공개/팀/공개 단계                                                                | 에이전트를 **파일 1개 묶음**으로 내보내기·가져오기, 공개 범위 3단계                                                                                                                                                                   | https://docs.dify.ai/features/workflow/export-import · https://www.mintlify.com/FlowiseAI/Flowise/features/marketplace                                                                                                                          |
| **Claude Agent Skills (open standard)** | 폴더 + SKILL.md, 이름·설명만 먼저 읽고 필요할 때 본문(점진적 공개), 여러 회사 도구가 같은 형식을 읽음                                                   | 스킬 블록 = 표준 SKILL.md 그대로(이미 `packages/sdk/src/skill-md.ts`), 엔진을 바꿔도 같은 블록 사용                                                                                                                                   | https://www.anthropic.com/research/equipping-agents-for-the-real-world-with-agent-skills · https://agentskills.io/                                                                                                                              |
| **Claude Code 플러그인 마켓**           | `/plugin install 이름@마켓` 한 줄 설치, 커뮤니티 목록 수천 개                                                                                           | 마켓 주소를 등록하면 서랍에 블록으로 보이게(이미 T-053.2 변환기 있음)                                                                                                                                                                 | https://code.claude.com/docs/en/plugin-marketplaces · https://claude-plugins.dev/                                                                                                                                                               |
| **MCP 공식 레지스트리**                 | 공개 목록(2025-09 미리보기), 단 **안전 검수 없음(자기 신고)**                                                                                           | 레지스트리 검색을 도구 추천의 한 출처로, 그러나 "검수 안 됨" 표시와 설치 카드 승인은 필수                                                                                                                                             | https://blog.modelcontextprotocol.io/posts/2025-09-08-mcp-registry-preview/                                                                                                                                                                     |
| **Scratch / Blockly 연구**              | 블록 **모양**이 문법을 강제해 "안 맞는 조립" 자체가 불가능, 색으로 데이터 종류 구분. 단, 모양은 구조 오류만 막고 논리 오류는 못 막음                    | 블록에 "볼록(내보냄)·오목(받음)" 모양과 색을 주고, 안 맞으면 **붙기 전에** 막기. 논리 오류는 시험 모드로 잡기                                                                                                                         | https://arxiv.org/pdf/1705.09413 · https://textbooks.cs.ksu.edu/intro-scratch/02-blocks/02-block-shapes/                                                                                                                                        |

**뽑은 공통 원칙 7가지**

1. **말로 시작, 그림으로 확인** — 말로 만들기가 주 경로, 캔버스는 "보여 주고 조금 고치는 곳"(Opal, n8n, Copilot Studio, AgentKit 종료 교훈).
2. **빈 화면 금지** — 템플릿·예시 문장·첫 블록 자리를 항상 보여 준다(Zapier, Lindy, n8n).
3. **안 맞으면 붙기 전에 막는다** — 모양·색·말로 이유(Scratch).
4. **만드는 옆에 시험 창** — 바로 말 걸어 보고, 그 대화를 시험으로 저장(Copilot Studio).
5. **왜 그랬는지 보여 주기** — 블록마다 한 일·이유(Make Reasoning).
6. **파일 1개로 주고받기 + 리믹스** — 공유·복사해 고치기(Dify, Opal).
7. **마켓은 편하게, 설치는 승인** — 한 번 누르기 설치지만 권한·검수 여부를 먼저 보여 줌(MCP 레지스트리, Claude 마켓).

---

## 3. 제안

### 3-1. 우선순위 표

효과: ★(작음)~★★★(큼) · 작업량: S(1~3일) / M(1주) / L(2주+) · 위험: 낮음/중간/높음

| 순위 | 제안                                                                                                | 효과 | 작업량 | 위험       | 막는 문제 |
| ---- | --------------------------------------------------------------------------------------------------- | ---- | ------ | ---------- | --------- |
| P1   | **빌더 쉬운 말 바꾸기 + 용어집** (쉬운 말 검사기를 빌더 문구에도 적용)                              | ★★★  | S      | 낮음       | B1, B2    |
| P2   | **템플릿에서 시작** (쓰임새별 10개 + 예시 문장 카드, 빈 화면 안내)                                  | ★★★  | M      | 낮음       | B5, B11   |
| P3   | **호환 블록 표시** (끌기 시작하면 붙는 곳만 밝게, 안 맞는 곳은 회색 + 이유 한 줄, 블록 모양·색)     | ★★★  | M      | 중간       | B3, B4    |
| P4   | **시험 모드(안전한 진짜 실행)** + 시험 대화 저장                                                    | ★★★  | L      | 중간       | B6, B12   |
| P5   | **오류를 쉬운 말로 + [고쳐 줘] 버튼** (빌더 전 오류를 승인 카드 형식으로)                           | ★★★  | M      | 낮음       | B4, B8    |
| P6   | **블록에 권한·비용 배지** + 끼우는 순간 알림                                                        | ★★   | S      | 낮음       | B7        |
| P7   | **서랍 안 마켓 + 원클릭 설치** (없으면 [찾아서 설치] → 기존 설치 카드)                              | ★★   | M      | 중간(보안) | B10       |
| P8   | **말 ↔ 캔버스 한 화면 왕복** (블록 클릭 → "이 블록을 말로 고치기", 캔버스 수정 → 대화에 한 줄 기록) | ★★   | S      | 낮음       | B2        |
| P9   | **"간단 보기 / 자세히 보기" 두 단계** (로직 블록·형식 칸·YAML은 자세히 보기에만)                    | ★★   | S      | 낮음       | B1, B2    |
| P10  | **에이전트 내보내기·가져오기·리믹스** (파일 1개 `.hxagent`)                                         | ★★   | M      | 중간(보안) | B9        |
| P11  | **저장한 에이전트 판(버전) 되돌리기** + 설치 되돌리기 연결                                          | ★    | S      | 낮음       | B12       |
| P12  | **실행 후 "블록별로 무엇을 했나요?"** (궤적을 블록에 덧씌움)                                        | ★    | M      | 낮음       | 신뢰      |

> 순서 주의: CLAUDE.md의 T-102 규칙상 **점검 기간에는 새 기능 추가 금지**. 아래 T-103은 T-102 끝(H.16) 뒤에 시작.

### 3-2. 제안별로 어디에 어떻게 붙이나 (기존 구조 재사용 우선, 새 의존성 0이 목표)

**P1. 빌더 쉬운 말 + 용어집**

- 새 파일 `apps/web/src/builder/words.ts` 한 곳에 빌더의 모든 화면 문구를 모은다(지금은 `catalog.ts`·`NodeFields.tsx`·`DryRunTab.tsx` 등에 흩어짐).
- 바꿀 말 예: 노드 → **블록**, 역할(role) → **일꾼**, 게이트(gate) → **검사관**, fanout/join → **나눠 하기/모으기**, loop → **될 때까지 반복**, router → **갈림길**, subagent → **다른 에이전트 부르기**, 엔진 → **AI**, 스킬 → **기술 카드**, 도구 → **도구**, 플러그인 → **부품 묶음**, 입력/출력 스키마 → **받는 것/내놓는 것**, 인증 모드 구독/API 키 → **구독으로 / 사용량만큼 결제**, 읽기 전용/워크스페이스 쓰기/전체 → **보기만 / 이 프로젝트 파일 고치기 / 컴퓨터 전체**, 드라이런 → **모의 실행(돈 안 듦)**, YAML 보기 → **설계도 글로 보기(고급)**.
- `packages/plugins-core/approvals/src/plain-korean.ts`의 검사기를 테스트에서 `words.ts` 전체에 돌린다(버튼·제목은 `label: true`). 화면 코드는 브라우저에서 이 패키지를 직접 부르지 않아도 됨 — **테스트로만 강제**해 의존성 증가 없음.
- 용어집 패널: 낱말에 점선 밑줄 → 누르면 한 줄 풀이(`?` 아이콘). 용어집 데이터는 `words.ts`에 같이.

**P2. 템플릿에서 시작**

- 템플릿 = 지금의 `agent.yaml + pipeline.yaml` 그대로(새 형식 금지). 위치: `packages/plugins-core/agent-builder/templates/<id>/` + `template.json`(제목·한 줄 설명·그림 아이콘·필요한 블록·예상 비용 범위·예시 문장).
- `StartChoice.tsx` 첫 줄을 "템플릿 카드 격자"로 바꾸고, 기존 4가지는 아래로. 카드에 "필요한 것: ✓ 있음 / ⬇ 설치 필요"(인벤토리 `agent-builder/src/inventory/` 재사용).
- 예시 10개(초보자 쓰임새): 회의록 요약, 글 다듬기, 폴더 정리 제안, 웹 조사 보고서, 코드 설명해 주기, 버그 찾기 + 다른 AI가 검사, 엑셀 정리, 사진·문서 비교, 매일 할 일 정리, 질문 답변 도우미.
- 빈 캔버스: 가운데 "여기에 첫 블록을 놓으세요" 자리 + "말로 시작하기" 버튼 + 예시 문장 3개.

**P3. 호환 블록 표시(레고 모양)**

- 이미 있는 `acceptsSkills/acceptsEngine`(`lego/model.ts`)와 `checkSchemaCompat`(protocol)를 **끌기 시작 시점**에 미리 계산하는 순수 함수 `lego/compat.ts`(`whereCanDrop(graph, block) → {nodeId, ok, reason}[]`)를 추가.
- `Canvas.tsx`가 끌기 중 상태를 들고, `LegoNode.tsx`가 `ok`면 초록 테두리, 아니면 회색 + 한 줄 이유("이 블록은 기술 카드를 받지 않아요. '일꾼' 블록에 놓아 주세요").
- 연결선: 비호환이면 **연결 자체를 막고** 이유를 말풍선으로(지금은 빨간 선 허용). 고급 설정 `builder.allowIncompatible`(기본 끔)로 예전 동작 유지 — `packages/kernel/src/settings/registry.ts`에 키 추가.
- 모양·색: 블록 왼쪽 오목(받는 것), 오른쪽 볼록(내놓는 것), 내놓는 종류마다 색(글=파랑, 파일=초록, 목록=보라, 판정=주황). CSS만(`builder.css`), 새 라이브러리 없음.

**P4. 시험 모드**

- 새 실행 방식 "시험": 프로젝트 복사본(임시 폴더)에서 실제 엔진으로 실행, 결과·변경 파일만 보여 주고 **원본에는 적용 안 함**. 재사용: Forge 격리 시험(`packages/plugins-core/forge/src/sandbox.ts`), 실행기(`agent-builder/src/runner/`), 오버레이(`inspector/dryrun.ts`의 `overlayFromEvents`는 실제 이벤트도 받도록 이미 설계됨).
- 비용 상한: 시험 1회 상한(설정 `builder.testRunMaxUsd`), 구독 엔진 우선. 시작 전 "약 ○원, 약 ○분" 카드.
- 오른쪽 칸에 "시험 대화" 탭(Copilot Studio 방식). 시험이 잘 되면 [이 시험을 저장] → 에이전트 폴더 `tests/*.json`(입력 + 기대 결과) → 다음 저장 때 자동 재시험(체크리스트 비교기 재사용).
- 결과 화면에 [원본에 적용](사람 클릭만) / [버리기].

**P5. 오류를 쉬운 말로 고치기 안내**

- 빌더 오류 형식 하나로 통일: `{ 무슨 일, 왜, 고치는 버튼들[] }` — 승인 카드(`packages/plugins-core/approvals/src/templates.ts`)의 문장 틀 재사용.
- 고치는 버튼 예: 비호환 연결 → [가운데에 변환 블록 넣기] [다른 블록 추천] [AI에게 고쳐 달라기], 엔진 로그인 안 됨 → [로그인하기] [다른 AI로 바꾸기], 블록 없음 → [찾아서 설치] [Forge로 만들기].
- [AI에게 고쳐 달라기] = 기존 "말로 고치기" 변경 패치 흐름(P4-E.2~E.4)에 오류 내용을 자동 입력 — 새 AI 경로 없음.
- `start.ts`·`NodeFields.tsx`의 원문 오류는 "자세히 보기"로 접기.

**P6. 권한·비용 배지**

- 블록 오른쪽 위 작은 배지: 🔒보기만 / ✏️파일 고침 / ⚠️컴퓨터 전체 / 🌐인터넷, 💰무료·구독·유료. 데이터는 노드 `permission`, 도구 목록 `pricing`(`installer/src/registry.ts`), 엔진 모드에서.
- 권한이 올라가는 끼우기(예: 셸 도구 장착)는 토스트 "이제 이 일꾼이 명령을 실행할 수 있어요 [되돌리기]".
- 캔버스 위 띠에 합계: "이 에이전트는: 파일 고침 · 인터넷 사용 · 1회 약 ○원".

**P7. 서랍 안 마켓 + 원클릭 설치**

- 서랍 각 탭 아래 "더 찾기" 줄: 설치 안 된 후보를 흐리게 표시 + [설치]. 후보 출처: 도구 추천(`tool-finder`), 설치 관리자 주소 설치(`installer/src/resolve.ts`), MCP 공식 레지스트리를 새 검색 출처(`tool-finder/src/providers/`에 1개 추가, `fetch`만).
- [설치]는 항상 기존 설치 계획 카드(`apps/web/src/install/InstallPlanCard.tsx`)를 거침. 레지스트리 출처는 "검수 안 된 부품" 배지.
- 설치 완료 → 서랍 목록 자동 새로고침 → 끌고 있던 자리에 자동 장착(선택).

**P8. 말 ↔ 캔버스 왕복**

- 블록 오른쪽 클릭/길게 누르기 → "이 블록을 말로 고치기" → 대화 칸에 `@블록이름` 붙여 입력 시작.
- 캔버스에서 직접 고치면 대화 칸에 회색 한 줄 "직접 바꿈: 검사관 AI를 codex로" — AI가 다음 변경에서 맥락을 앎(`graphToDraft` 재사용).
- 대화 칸과 캔버스를 **동시에** 보이게(지금은 서랍 탭 전환). `BuilderSidebar.tsx` 배치 변경.

**P9. 간단 보기 / 자세히 보기**

- 설정 `builder.view: simple | detailed`(기본 simple). 간단 보기: 서랍에 "일꾼·검사관·다른 에이전트" 3종 + 기술 카드·AI·도구. 반복·갈림길·나눠 하기는 "AI에게 말로 부탁"으로 유도. 인스펙터는 이름·AI·할 일·권한 4칸만.
- 자세히 보기: 지금 화면 그대로(전문가 보호).

**P10. 내보내기·가져오기·리믹스**

- 파일 1개 `<이름>.hxagent`(zip 아님, JSON 한 덩어리: agent.yaml·pipeline.yaml·포함 스킬 SKILL.md·필요 부품 목록·시험). 비밀 값은 `maskSecrets`(kernel)로 제거.
- 가져오기 = 미리 보기 카드(무엇을 하나·권한·필요한 설치) → [가져오기] → 없는 부품은 설치 카드 묶음.
- "리믹스" = 가져온 것을 초안으로 열기(`startGraph`의 clone 경로 재사용). API: `POST /api/agents/export`, `/api/agents/import`(kernel `api/server.ts`).

**P11. 저장판 되돌리기** — 저장 때마다 `~/.harness-x/agents/<이름>/versions/<n>/`에 이전 판 보관(초안 버전 P4-E.6 방식 재사용), 에이전트 목록에서 [이전 판으로].

**P12. 블록별로 무엇을 했나요** — 실제 실행 후 빌더에서 그 에이전트를 열면 궤적(`apps/web/src/panels/trajectory.ts`)을 블록에 덧씌우고, 블록 클릭 시 "한 일 · 쓴 도구 · 걸린 시간 · 비용"을 쉬운 말로.

### 3-3. 하지 않을 것 (위험 대비 효과 작음)

- 새 캔버스 라이브러리 교체(React Flow 유지).
- 자체 공개 마켓 서버 운영(검수·악성 부품 책임). 우선 파일 공유 + 외부 레지스트리 검색까지만.
- AI가 자동 저장·자동 설치(지금의 "사람만 저장·설치" 원칙 유지).

---

## 4. 다음 티켓 T-103 초안 — "초보자 레고 빌더"

deps: T-102 완료(H.16) · 산출물: `apps/web/src/builder/**`, `packages/plugins-core/agent-builder/**`, `packages/plugins-core/tool-finder/src/providers/`, `packages/kernel/src/settings/registry.ts`, `packages/kernel/src/api/server.ts`
규칙: 화면 항목은 스냅샷 + 동작 검증, 새 버튼은 `act('<id>')` 등록 + `pnpm check:dead-buttons` 통과.

### A. 쉬운 말과 용어집 (P1·P9)

- [ ] 1.1 `apps/web/src/builder/words.ts` 만들기 — 빌더 화면 문구 전부를 한 파일로 — 검증: `grep`으로 builder/*.tsx 안 한글 문구 리터럴 0개(테스트 `words.inventory.test.ts`)
- [ ] 1.2 노드 종류 이름 바꾸기(블록·일꾼·검사관·나눠 하기·모으기·반복·갈림길·다른 에이전트 부르기) — 검증: `catalog.ts` `NODE_LABEL/NODE_DESC` 스냅샷
- [ ] 1.3 인스펙터 칸 이름 바꾸기(받는 것/내놓는 것, 구독으로/사용량만큼 결제, 보기만/이 프로젝트 파일 고치기/컴퓨터 전체) — 검증: `NodeFields` 스냅샷
- [ ] 1.4 쉬운 말 검사 테스트 추가 — `words.ts` 전 문구에 `plain-korean` 검사 — 검증: 위반 0개로 vitest 통과
- [ ] 1.5 용어집 데이터 추가 — 낱말 30개 한 줄 풀이 — 검증: 항목마다 검사기 통과 테스트
- [ ] 1.6 용어 밑줄 + 풀이 말풍선 컴포넌트 `builder/Term.tsx` 만들기 — 검증: 누르면 풀이 보임(동작 테스트) + 스냅샷
- [ ] 1.7 설정 키 `builder.view`(simple|detailed, 기본 simple) 등록 — 검증: 설정 레지스트리 테스트
- [ ] 1.8 간단 보기 서랍 필터 적용 — 노드 탭에 일꾼·검사관·다른 에이전트 3종만 — 검증: simple일 때 블록 3개 테스트
- [ ] 1.9 간단 보기 인스펙터 4칸(이름·AI·할 일·권한)만 표시 — 검증: simple 스냅샷, detailed는 기존 스냅샷 유지
- [ ] 1.10 "설계도 글로 보기(고급)" — YAML 탭을 자세히 보기에서만 표시 — 검증: simple에서 탭 없음 테스트

### B. 템플릿에서 시작·빈 화면 없애기 (P2)

- [ ] 2.1 `template.json` 스키마 정의(제목·설명·아이콘·필요 블록·비용 범위·예시 문장) — 검증: Zod 테스트(정상 1·잘못 3)
- [ ] 2.2 템플릿 10개 폴더 추가 `agent-builder/templates/<id>/` — 검증: 10개 모두 pipeline 스키마 통과 테스트
- [ ] 2.3 템플릿 목록 API `GET /api/agent-templates` 추가 — 검증: 응답 10개 + 필요 블록 있음/없음 표시 테스트
- [ ] 2.4 `StartChoice.tsx` 맨 위에 템플릿 카드 격자 넣기 — 검증: 스냅샷 + 카드 클릭 시 캔버스에 블록 생성 동작 테스트
- [ ] 2.5 템플릿 카드에 "필요한 것: 있음/설치 필요" 표시 — 검증: 인벤토리 가짜 데이터로 두 상태 스냅샷
- [ ] 2.6 빈 캔버스에 첫 블록 자리 + [말로 시작하기] + 예시 문장 3개 표시 — 검증: 블록 0개일 때 표시·1개 이상이면 사라짐 테스트
- [ ] 2.7 예시 문장 누르면 말로 만들기 입력에 채우기 — 검증: 클릭 후 입력값 일치 테스트

### C. 호환 블록 표시 (P3)

- [ ] 3.1 `lego/compat.ts`의 `whereCanDrop(graph, block)` 순수 함수 만들기 — 검증: 블록 5종 × 노드 7종 표 테스트
- [ ] 3.2 끌기 중 상태를 `Canvas.tsx`에 추가 — 검증: dragstart/dragend로 상태 변화 테스트
- [ ] 3.3 `LegoNode.tsx`에 붙는 곳 초록·안 붙는 곳 회색 + 이유 한 줄 표시 — 검증: 스킬 끌 때 검사관 노드에 이유 문구 보임 동작 테스트
- [ ] 3.4 비호환 연결 막기 + 이유 말풍선 — 검증: 비호환 connect 시 엣지 수 그대로 테스트
- [ ] 3.5 설정 키 `builder.allowIncompatible`(기본 false) 등록·연결 — 검증: true면 예전처럼 빨간 선 테스트
- [ ] 3.6 비호환 이유를 쉬운 말로 바꾸는 `compatReasonPlain()` 만들기 — 검증: 검사기 통과 + 원문은 자세히 보기에 남음 테스트
- [ ] 3.7 블록 모양(오목·볼록)과 내놓는 종류별 색 CSS 추가 — 검증: 스냅샷 🖐(스크린샷 경로 기록)

### D. 오류를 쉬운 말로 고치기 (P5)

- [ ] 4.1 빌더 오류 형식 `BuilderProblem {what, why, fixes[]}` 정의 — 검증: 타입 테스트
- [ ] 4.2 빌더 오류 변환기 `toProblem()` 만들기(비호환·엔진 로그인·블록 없음·잘못된 형식·저장 실패 5종) — 검증: 5종 변환 테스트 + 검사기 통과
- [ ] 4.3 문제 카드 컴포넌트 `builder/ProblemCard.tsx` 만들기 — 검증: 스냅샷 + 버튼마다 동작 테스트
- [ ] 4.4 [AI에게 고쳐 달라기] 버튼을 말로 고치기 패치 흐름에 연결 — 검증: 클릭 시 변경 미리보기 카드 생성 테스트
- [ ] 4.5 [가운데에 변환 블록 넣기] 고치기 추가 — 검증: 클릭 후 두 블록 사이 일꾼 1개 + 연결 2개 테스트
- [ ] 4.6 `start.ts` 예외를 문제 카드로 보여 주기 — 검증: 없는 플러그인 선택 시 카드 표시 테스트

### E. 권한·비용 배지 (P6)

- [ ] 5.1 블록 배지 계산 함수 `badgesOf(node, catalog)` 만들기 — 검증: 권한 3종·가격 3종 테스트
- [ ] 5.2 `LegoNode.tsx`에 배지 표시 — 검증: 스냅샷
- [ ] 5.3 권한이 올라가는 끼우기에 [되돌리기] 토스트 띄우기 — 검증: 셸 도구 장착 시 토스트 + 되돌리기 동작 테스트
- [ ] 5.4 캔버스 위 합계 띠(권한 요약·1회 예상 비용) 추가 — 검증: 블록 추가·삭제 시 합계 변화 테스트

### F. 시험 모드 (P4)

- [ ] 6.1 설정 키 `builder.testRunMaxUsd`(기본 0.5) 등록 — 검증: 레지스트리 테스트
- [ ] 6.2 시험 실행 API `POST /api/agents/test-run`(임시 복사 폴더, 원본 쓰기 금지) 추가 — 검증: 실행 후 원본 폴더 해시 불변 테스트(리플레이 엔진)
- [ ] 6.3 시험 전 예상 비용·시간 카드 표시 — 검증: 상한 초과 시 시작 버튼 잠김 테스트
- [ ] 6.4 실제 이벤트를 캔버스 오버레이에 연결 — 검증: 리플레이 로그로 블록 상태 변화 테스트
- [ ] 6.5 오른쪽 칸 "시험 대화" 탭 추가 — 검증: 스냅샷 + 메시지 보내면 시험 실행 시작 동작 테스트
- [ ] 6.6 [이 시험을 저장] → 에이전트 폴더 `tests/*.json` 생성 — 검증: 파일 생성 테스트
- [ ] 6.7 저장 전 점검표에 "저장한 시험 다시 돌리기" 줄 추가 — 검증: 실패 시 점검표 ✗ 테스트
- [ ] 6.8 시험 결과 [원본에 적용]/[버리기] 버튼 — 검증: 적용은 사람 클릭만, 버리기 후 임시 폴더 삭제 테스트

### G. 말 ↔ 캔버스 왕복 (P8)

- [ ] 7.1 블록 메뉴 "이 블록을 말로 고치기" 추가 — 검증: 누르면 대화 입력에 `@블록이름` 채움 테스트
- [ ] 7.2 직접 수정을 대화 칸에 회색 한 줄로 기록 — 검증: 엔진 교체 후 대화 기록 1줄 테스트
- [ ] 7.3 대화 칸과 캔버스 동시 표시 배치로 바꾸기 — 검증: 스냅샷 + 768px 미만은 하단 시트 🖐

### H. 서랍 안 마켓·원클릭 설치 (P7)

- [ ] 8.1 MCP 공식 레지스트리 검색 출처 `providers/mcp-registry.ts` 추가 — 검증: 가짜 fetch 응답으로 후보 변환 테스트
- [ ] 8.2 서랍 탭마다 "더 찾기" 줄(설치 안 된 후보 흐리게) 표시 — 검증: 스냅샷 + 검색어 입력 시 후보 표시 테스트
- [ ] 8.3 [설치] 버튼을 기존 설치 계획 카드에 연결 — 검증: 클릭 시 InstallPlanCard 열림 동작 테스트
- [ ] 8.4 "검수 안 된 부품" 배지 표시 — 검증: 레지스트리 출처 후보에 배지 테스트
- [ ] 8.5 설치 완료 시 서랍 새로고침 + 블록 사용 가능 — 검증: 설치 이벤트 후 블록 목록 +1 테스트

### I. 공유·내보내기·되돌리기 (P10·P11)

- [ ] 9.1 `.hxagent` 파일 형식 스키마 정의 — 검증: Zod 테스트
- [ ] 9.2 내보내기 API `POST /api/agents/export` 추가(비밀 값 가림) — 검증: 토큰 모양 값 0개 테스트
- [ ] 9.3 가져오기 미리 보기 API `POST /api/agents/import/preview` 추가 — 검증: 권한·필요 설치 목록 응답 테스트
- [ ] 9.4 가져오기 미리 보기 카드 + [가져오기] 버튼 — 검증: 스냅샷 + 클릭 시 초안으로 열림 동작 테스트
- [ ] 9.5 에이전트 목록에 [내보내기]·[리믹스] 버튼 추가 — 검증: 파일 다운로드·초안 열림 동작 테스트
- [ ] 9.6 저장 때마다 `versions/<n>/` 보관 — 검증: 2번 저장 후 판 2개 테스트
- [ ] 9.7 [이전 판으로] 되돌리기 — 검증: 되돌린 뒤 pipeline.yaml이 1판과 같음 테스트

### J. 마무리

- [ ] 10.1 초보자 시나리오 E2E 작성 — 템플릿 고르기 → 블록 1개 바꾸기 → 시험 → 저장 → `/` 실행 — 검증: `e2e/` 통과
- [ ] 10.2 새 화면을 `e2e/screens.ts`에 등록 — 검증: `pnpm check:dead-buttons` 통과
- [ ] 10.3 초보자 사용성 확인 — 코딩 모르는 1명이 10분 안에 템플릿으로 에이전트 1개 저장 🖐 — 검증: 화면 녹화·스크린샷 경로 기록(awaiting-human)

(총 60개 중 🖐 3개 — 필요하면 H·I 묶음을 T-104로 나눠 50개 안팎으로 줄일 수 있음)

---

## 5. 출처 모음

- OpenAI AgentKit 소개: https://openai.com/index/introducing-agentkit/
- Agent Builder 종료 안내 정리: https://mcp.directory/blog/openai-agentkit-deprecation-2026 · https://www.nocode.tech/article/openai-is-killing-its-no-code-agent-builder-heres-what-that-tells-us-about-the-real-no-code-moat
- Google Opal: https://developers.googleblog.com/en/introducing-opal/ · https://www.infoq.com/news/2025/07/google-opal-ai
- n8n AI Workflow Builder: https://docs.n8n.io/advanced-ai/ai-workflow-builder · https://claude.com/customers/n8n
- Microsoft Copilot Studio: https://learn.microsoft.com/microsoft-copilot-studio/agents-experience/overview · https://learn.microsoft.com/en-us/training/modules/create-copilots-copilot-studio/copilot-creation-with-natural
- Zapier Agents: https://zapier.com/blog/zapier-agents-guide/ · https://www.zapier.com/blog/introducing-zapier-ai-agents/
- Lindy / Gumloop 비교(경쟁사 글 포함): https://www.lindy.ai/blog/how-create-ai-agents · https://beginnersinai.org/gumloop-vs-lindy/
- Make AI Agents: https://www.make.com/en/blog/make-ai-agents-trust-through-transparency · https://help.make.com/meet-the-new-make-ai-agents-app
- Dify 내보내기/가져오기: https://docs.dify.ai/features/workflow/export-import · Flowise 마켓: https://www.mintlify.com/FlowiseAI/Flowise/features/marketplace
- Agent Skills: https://www.anthropic.com/research/equipping-agents-for-the-real-world-with-agent-skills · https://agentskills.io/
- Claude Code 플러그인 마켓: https://code.claude.com/docs/en/plugin-marketplaces · https://claude-plugins.dev/
- MCP 레지스트리: https://blog.modelcontextprotocol.io/posts/2025-09-08-mcp-registry-preview/
- 블록 프로그래밍 연구: https://arxiv.org/pdf/1705.09413 · https://textbooks.cs.ksu.edu/intro-scratch/02-blocks/02-block-shapes/

참고: 웹 자료 일부는 검색 요약으로 확인했고(본문 전체를 열지 않음), 경쟁사 비교 글은 홍보 성격이 있어 패턴만 참고했습니다. Claude Code 플러그인 공식 문서 주소는 검색 결과의 안내를 바탕으로 적었으므로 쓰기 전에 한 번 확인이 필요합니다.

## 사용자 추가 요구 (2026-11-12) — T-103 범위에 넣기

- 회사(기업) 운영이 가능한 수준: 문제없이 돌아가는 것이 먼저 — T-102에서 고친 것 위에 운영 장치(상태 확인·기록 보관·자동 재시작·백업·오류 안내)를 점검해 보탠다.
- 패널 디자인이 너무 오래돼 보임 → 2026 최신 수준으로 패널 디자인을 다시 만든다. 모든 기능은 그대로 문제없이 써야 한다(기능 지도 146개·`pnpm test:features`·전부 눌러 보기로 확인).
- 초보자용 레고식 에이전트 조립(위 제안서).
