# HARNESS-X 웹 화면 디자인 방향 (2026)

> 대상: `apps/web` 화면 전체 (사이드바 · 상단바 · 입력창 · 오른쪽 패널 · 설정 · 설치 관리 · 에이전트 만들기)
> 원칙: **기능·버튼·`data-action`은 하나도 빼거나 바꾸지 않는다.** 모양(색·크기·모서리·그림자·움직임·아이콘)만 바꾼다.
> 작성: 2026-11-12. 이 문서는 파일을 읽기만 하고 쓴 것으로, 빌드·테스트·서버는 돌리지 않았다. 색 대비 숫자는 직접 계산했다(WCAG 상대 휘도 공식).

**쉬운 말 요약**: 지금 화면은 "회색 상자 + 얇은 선 + 모든 모서리 8px + 기호 아이콘(⚙ ☰ ⬇) + 움직임 없음"이라서 2018년쯤의 데스크톱 앱처럼 보인다. 2026년 AI 도구(Claude.ai, ChatGPT, Cursor 3, Linear)는 다음처럼 생겼다.

- 본문은 거의 흰색(어두운 모드는 거의 검정)이고, 그 위에 떠 있는 둥근 입력창이 있다.
- 선을 줄이고 높낮이(그림자)와 옅은 배경색 차이로 영역을 나눈다.
- 같은 굵기의 선 아이콘을 쓴다.
- 짧고 부드러운 움직임이 있다.

이번 작업은 대부분 **토큰 2개 파일(`tokens.json`, `css.ts`)만 바꿔서** 화면 전체를 한 번에 바꾸는 방식으로 설계했다.

---

## 1. 지금 디자인 진단 — 무엇이 오래돼 보이나

| #   | 문제                                                                                                                                                                    | 근거 (파일:줄)                                                                                                                                                                                                                                                              | 왜 오래돼 보이나                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | 밝은 모드에서 **배경보다 겉면이 더 어둡다**: bg=`neutral-100 #f7f7f8`, surface=`neutral-200 #ececef`. 사이드바·상단바·오른쪽 패널·입력창·팝업·카드가 전부 같은 회색이다 | `design/css.ts:14-24`, `shell/shell.css:57,187,356`, `composer/composer.css:9,115`, `settings/settings-screen.css:167`                                                                                                                                                      | 화면 4면이 회색 띠로 둘러싸인 "윈도우 7 관리 도구" 느낌이다. 2026 도구들은 작업 영역은 밝게 두고, 주변 틀을 아주 옅게 두거나 아예 같은 색으로 둔다                |
| D2  | 구역을 **1px 선**으로만 나누고, 경계 조절 막대가 **4px짜리 색 막대**다                                                                                                  | `shell/shell.css:12`(4px 칸), `:56,186,355,363`(선), `:338-347`(리사이저 배경=border, 마우스 올리면 accent)                                                                                                                                                                 | 선이 많아 화면이 복잡하다. 요즘은 조절 막대가 평소엔 보이지 않고 마우스를 올릴 때만 가는 선으로 나타난다                                                          |
| D3  | **모서리 반경이 8px 하나뿐**이다 (버튼·카드·입력창·탭·진행 막대 모두)                                                                                                   | `design/tokens.json:25`, `design/tokens.ts:9`, `composer/composer.css:8`                                                                                                                                                                                                    | 크기마다 둥글기가 달라야(작은 칩 6, 카드 12~14, 입력창 20+) 위아래 관계가 보인다. 입력창이 8px 네모 상자라서 ChatGPT·Claude의 둥근 입력창과 차이가 가장 크게 난다 |
| D4  | **그림자 체계가 없다**: 그림자가 제각각 8곳에 직접 적혀 있다                                                                                                            | `composer/composer.css:116`, `shell/shell.css:406`, `builder/builder.css:247,366,371`                                                                                                                                                                                       | 떠 있는 것(팝업·시트)과 바닥에 붙은 것의 차이가 약하다                                                                                                            |
| D5  | **움직임이 거의 없다**: transition이 0개, animation은 2곳뿐이다(`builder/draft/draft.css:48`, `engines/engines.css:69`)                                                 | 전체 CSS grep 결과                                                                                                                                                                                                                                                          | 마우스를 올리거나 탭을 바꿀 때 색이 "딱" 바뀌어서 딱딱하게 느껴진다                                                                                               |
| D6  | 아이콘이 **유니코드 기호·이모지**다: ✦ ⧉ ◇ ⬇ ⚙ ☰ ◐ ☀ ☾ 🖼 📁 📌 ✋ ⏸                                                                                                    | `shell/types.ts:78-84`, `design/ThemeToggle.tsx:5`, `shell/Sidebar.tsx:68,75`, `composer` 첨부 칩                                                                                                                                                                           | 윈도우에서는 OS 이모지 글꼴(Segoe UI Emoji)로 그려진다. 그래서 크기·굵기·기준선이 제각각이고, 색 이모지와 흑백 기호가 섞여 있다. 가장 "옛날" 느낌을 주는 부분이다 |
| D7  | **글자 대비 부족 (WCAG 1.4.3 미달)**                                                                                                                                    | `shell/shell.css:228,259`(text-faint `#8b8b96` on surface `#ececef` = **2.86:1**), `:195-196`(새 세션 버튼 글자/배경 = **3.90:1**), `:143`(멈춤 글자 warning `#e2b203` = **1.85:1**), `composer/composer.css:180,184`(success 3.11, danger 3.66), `shell/shell.css:428,438` | 본문 크기 글자는 4.5:1 이상이어야 한다. 흐린 글자가 너무 흐려서 오히려 "싸 보이고" 읽기도 어렵다                                                                  |
| D8  | **상태색·강조색이 밝은/어두운 모드에서 같은 값**이다                                                                                                                    | `design/tokens.json:14-22`, `design/css.ts:26-36`(중성색만 바꿈)                                                                                                                                                                                                            | 어두운 모드에서 진한 파랑·빨강이 탁하게 보인다. 강조색 `#5b6cff`는 검정 배경에서 4.41:1로 기준에 못 미친다                                                        |
| D9  | **토큰 밖에 직접 적은 글자 크기 29곳** (예: 설치 관리 15px 7곳)                                                                                                         | `install/install.css:232,254,277,288,308,327,344` 외                                                                                                                                                                                                                        | 크기 단계가 흐트러지고, 화면마다 글자 크기가 다르다                                                                                                               |
| D10 | 탭 모양이 **화면마다 3가지**다: 회색 알약(오른쪽 패널) / 테두리 상자(설정) / 밑줄(설치 관리·서랍)                                                                       | `shell/shell.css:366-378`, `settings/settings-screen.css:139-151`, `install/install.css:247-261`, `builder/builder.css:141`                                                                                                                                                 | 일관성이 없어서 "여러 사람이 덧붙인 앱"처럼 보인다                                                                                                                |
| D11 | 줄 높이가 낮고 빽빽하다: 세션 줄·메뉴 줄 위아래 여백이 4px                                                                                                              | `shell/shell.css:238,318`, `composer/composer.css:123`                                                                                                                                                                                                                      | 한 줄이 약 29px이다. 2026 도구들은 32px 줄, 8~10px 둥근 선택 표시를 쓴다                                                                                          |
| D12 | 기본 `<select>` 3개를 그대로 둔 사이드바 필터, 기본 select·버튼을 그대로 쓴 설치 화면                                                                                   | `shell/shell.css:201-216`, `install/install.css:280-289`                                                                                                                                                                                                                    | 브라우저 기본 컨트롤 모양이 그대로 보인다                                                                                                                         |
| D13 | 글자 굵기·줄 간격·자간 토큰이 없다 (본문 line-height 1.5 고정)                                                                                                          | `design/base.css:20`, `design/tokens.json:26-32`                                                                                                                                                                                                                            | 제목과 본문 차이가 크기로만 나서 위계가 약하다                                                                                                                    |
| D14 | 에이전트 만들기 캔버스가 어두운 모드에서도 밝게 나온다 (React Flow에 `light` 클래스)                                                                                    | `test/__snapshots__/builder.layout.test.tsx.snap`(`class="react-flow light"`), `builder/Canvas.tsx` colorMode 지정 없음                                                                                                                                                     | 어두운 모드에서 가운데만 하얗게 뜬다                                                                                                                              |

잘 되어 있어서 **그대로 살릴 것**:

- 색을 모두 토큰 변수로만 쓰는 규칙(`apps/web/.stylelintrc.json`이 hex·rgb·oklch를 금지한다)
- 밝음/어두움/시스템 3단 전환(`design/theme.ts`)
- 움직임 줄이기 설정 2겹(`design/base.css:68-86`, OS 설정과 앱 설정 모두 따름)
- Pretendard 로컬 번들(`design/fonts.ts`)
- 4의 배수 간격(4/8/12/16/24/32)
- 포커스 테두리 2px(`design/base.css:54-57`)

---

## 2. 2025~2026 경향 요약표

| 영역             | 경향                                                                                                                                                   | 대표 사례                                                                                    | 출처                                                                                                                                                                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 전체 레이아웃    | **에이전트 중심 레이아웃**: 왼쪽에 에이전트·세션 목록(상태별 진행 중/대기/완료), 가운데에 대화, 오른쪽에 결과물(diff·브라우저·터미널)                  | Cursor 2.0(2025 가을), Cursor 3 Agents Window(2026.4)                                        | https://cursor.com/en-US/changelog/2-0 · https://www.codecademy.com/article/cursor-2-0-new-ai-model-explained · https://the-decoder.com/new-cursor-3-ditches-the-classic-ide-layout-for-an-agent-first-interface-built-around-parallel-ai-fleets/                                                               |
| 패널             | **떠 있는 둥근 패널은 되돌림** → 고정 + 크기 조절 + 접기. 여백 때문에 화면이 낭비된다는 반발이 있었다                                                  | Figma UI3                                                                                    | https://www.figma.com/blog/our-approach-to-designing-ui3/ · https://community.penpot.app/t/penpot-discarded-figmas-ui3-approach-more-than-a-year-ago/5995                                                                                                                                                       |
| 사이드바·밀도    | 선·잡음을 줄이고 정렬을 맞춤. 색을 기본색·강조색·대비 **3개 값에서 자동 생성**(LCH). 사이드바 항목 순서 바꾸기·숨기기. 2026.3 "훑어보기 쉽게" 리프레시 | Linear                                                                                       | https://linear.app/now/how-we-redesigned-the-linear-ui · https://linear.app/changelog/2024-12-18-personalized-sidebar · https://linear.app/changelog/2026-03-12-ui-refresh                                                                                                                                      |
| 유리 효과        | 떠 있는 층(탭바·시트·메뉴)에만 반투명 유리를 씀. 사용자가 **투명도 줄이기·대비 높이기**로 끌 수 있어야 함(가독성 불만이 많았음)                        | Apple Liquid Glass(iOS 26 / macOS Tahoe, 2025), Linear 모바일 frosted glass(2025.10)         | https://heise.de/-10445465 · https://www.macrumors.com/how-to/ios-reduce-transparency-liquid-glass-effect/ · https://developer.apple.com/forums/thread/811219 · https://linear.app/changelog/2025-10-16-mobile-app-redesign · https://linear.app/blog/linear-liquid-glass                                       |
| 움직임           | **스프링(물리 기반) 움직임**. 웹에서는 CSS `linear()`로 스프링 곡선을 흉내 냄(모든 주요 브라우저 지원)                                                 | Material 3 Expressive(2025.5 발표, Android 16 QPR1)                                          | https://www.androidauthority.com/google-material-3-expressive-features-changes-availability-devices-3556392 · https://developer.chrome.com/docs/css-ui/css-linear-easing-function · https://blog.nordcraft.com/approximating-reality-with-css-linear · https://joshwcomeau.com/animation/linear-timing-function |
| 모양             | 크기마다 다른 둥글기 + 알약 모양 버튼                                                                                                                  | Material 3 Expressive(모양 35종), shadcn/ui(`--radius` 0.625rem=10px 기준에서 sm/lg/xl 파생) | https://pub.dev/documentation/material_expressive/0.8.0/ · https://ui-v4.shadcn.com/docs/theming                                                                                                                                                                                                                |
| 색 체계          | **12단계(Radix)·10단계(Geist) 역할별 색 단계**: 1~2 배경, 3~5 컨트롤 바탕, 6~8 테두리, 9~10 진한 채움, 11~12 글자. 어두운 모드는 단계를 뒤집은 별도 값 | Radix Colors, Vercel Geist, shadcn(OKLCH 변수)                                               | https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale · https://vercel.com/geist · https://ui-v4.shadcn.com/docs/theming                                                                                                                                                             |
| AI 입력창        | **크고 둥근 입력창 하나에 모든 걸 넣음**: [+] 버튼, 첨부·도구 칩(× 로 빼기), 이미지 미리보기, 오른쪽 끝에 둥근 전송 버튼. 화면 아래에 고정             | Claude.ai, ChatGPT(입력창 단순화 리프레시)                                                   | https://ai-design-patterns.pages.dev/teardowns/claude/composer · https://aiuxplayground.com/teardowns/compare/design-the-composer · https://bgr.com/tech/chatgpt-got-a-makeover-but-all-of-your-ai-tools-are-still-there                                                                                        |
| 아이콘           | 같은 굵기의 **선 아이콘 SVG**(Lucide 기본 2px, 1.5~1.75로 가늘게 조정 가능, 개별 import로 필요한 것만 번들)                                            | Lucide(shadcn 기본 아이콘)                                                                   | https://lucide.dev/guide/react · https://lucide.dev/guide/basics/stroke-width · https://www.pkgpulse.com/guides/lucide-vs-heroicons-vs-phosphor-react-icon-libraries-2026                                                                                                                                       |
| 한국어 글꼴      | Pretendard는 자간·크기 조정 없이도 잘 읽히게 설계됨. 본문 행간 1.5~1.7                                                                                 | Pretendard                                                                                   | https://cdn.jsdelivr.net/npm/pretendard@1.3.9/docs/en/README.md · https://fontsource.org/fonts/pretendard/about                                                                                                                                                                                                 |
| 접근성           | WCAG 2.2 AA: **2.5.8 누르는 영역 24×24px 이상**, **2.4.11 포커스가 가려지지 않기**(+ 기존 1.4.3 글자 4.5:1, 1.4.11 컨트롤 경계 3:1)                    | W3C                                                                                          | https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/ · https://dequeuniversity.com/resources/wcag-2.2                                                                                                                                                                                                    |
| 사용자 설정 존중 | `prefers-reduced-motion`, `prefers-reduced-transparency`(Chrome·Edge 118+, Safari·Firefox 미지원 → 앱 설정으로 보완), `prefers-contrast`               | MDN / Chrome                                                                                 | https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-transparency · https://developer.chrome.com/blog/css-prefers-reduced-transparency                                                                                                                                                       |

> 참고: ChatGPT의 2026 "에이전트 중심 개편"은 보도(유출) 수준이라 근거로 쓰지 않았다. Material 3 Expressive의 세부 수치는 제3자 패키지 문서 기준이다.

---

## 3. 새 디자인 방향

### 3.1 한 줄 콘셉트

**"조용한 작업대 + 떠 있는 입력창"**

- 틀(사이드바·상단바·패널)은 배경과 거의 같은 옅은 색으로 물러난다.
- 작업 내용(대화·카드)과 입력창은 흰 판 + 부드러운 그림자로 앞에 나온다.
- 강조색은 "지금 누를 것"과 "지금 도는 것"에만 쓴다.

### 3.2 색 체계

**밝은 모드** (중성색은 살짝 푸른 회색, 순흰색·순검정은 쓰지 않음)

| 역할                               | 값                                    | 비고                                            |
| ---------------------------------- | ------------------------------------- | ----------------------------------------------- |
| 작업 배경 `bg`                     | `#fcfcfd`                             | 대화·설정 본문                                  |
| 틀 `surface`                       | `#f4f4f6`                             | 사이드바·상단바·오른쪽 패널. 지금보다 훨씬 옅음 |
| 떠 있는 판 `surface-raised`(신규)  | `#fcfcfd` + 그림자                    | 입력창·팝업·카드                                |
| 마우스 올림·선택 `surface-2`       | `#e6e6ea`                             |                                                 |
| 글자 `text`                        | `#111113`                             | bg 대비 18.4:1                                  |
| 보조 글자 `text-muted`             | `#4e4e58`                             | surface 대비 7.5:1                              |
| 흐린 글자 `text-faint`             | `#6b6b77`                             | bg 5.1:1, surface 4.8:1 (기존 2.86 → 통과)      |
| 장식 테두리 `border`               | `#e6e6ea`                             | 장식용이라 3:1 필요 없음                        |
| 입력칸 테두리 `border-input`(신규) | `color-mix(500 70%, 400)` ≈ `#878792` | 3.2~3.5:1 → WCAG 1.4.11 통과                    |
| 강조 `accent`                      | `#4f5bea`                             | 흰 글자 5.1:1 (기존 3.9 → 통과)                 |

**어두운 모드**

| 역할             | 값                                                    | 비고                                                         |
| ---------------- | ----------------------------------------------------- | ------------------------------------------------------------ |
| bg               | `#111113`                                             |                                                              |
| surface          | bg와 800의 중간                                       | 사이드바                                                     |
| raised·surface-2 | `#1c1c20` / `#33333a`                                 |                                                              |
| text             | `#fcfcfd`                                             |                                                              |
| text-muted       | `#c8c8d0`                                             | 10.2:1                                                       |
| text-faint       | `color-mix(400 50%, 500)` ≈ `#9a9aa4`                 | 6.1~6.8:1                                                    |
| accent           | 밝힌 강조색 `color-mix(#4f5bea 72%, 100)` ≈ `#7f88ef` | bg 대비 5.9:1. **강조색 위 글자는 어두운 색(`neutral-900`)** |
| 상태색           | 밝은 값을 60%로 밝힌 값                               | 아래 표, 전부 6:1 이상                                       |

**상태색** (밝음 / 어두움, 대비는 bg·surface 기준)

| 상태    | 밝은 모드 | 어두운 모드 (≈) | 대비                                     |
| ------- | --------- | --------------- | ---------------------------------------- |
| success | `#15803d` | `#71b28a`       | 4.9 / 4.6 · 7.6 / 6.8                    |
| warning | `#b45309` | `#d1976b`       | 4.9 / 4.6 · 7.5 / 6.8 (기존 1.85 → 통과) |
| danger  | `#c62828` | `#e78080` 근처  | 5.5 / 5.1 · 7.0 / 6.3                    |
| info    | `#2563eb` | `#7ba0f2`       | 5.0 / 4.7 · 7.3 / 6.6                    |
| running | `#7c3aed` | `#af88f3`       | 5.6 / 5.2 · 6.9 / 6.2                    |
| paused  | `#6b6b77` | `#a5a5ad`       | 5.1 / 4.8 · 7.7 / 6.9                    |

**옅은 바탕(-soft) 위 글자**

- 문제: 상태색 그대로 쓰면 3.9~4.4:1로 미달이다.
- 해결: 신규 `-text` 변수 `color-mix(상태색 80%, text)`를 쓴다 → 5.5~6.1:1.
- 옅은 바탕 농도는 밝은 모드 12%, 어두운 모드 18%(지금은 둘 다 16%)로 한다.

**대비 규칙** (WCAG 2.2 AA)

- 글자 4.5:1, 큰 글자(20px+ 또는 16px 굵게)와 아이콘·컨트롤 경계 3:1.
- `text-faint`는 `surface-2`(마우스 올림 바탕) 위에 쓰지 않는다(4.2:1). 그 자리는 `text-muted`로 한다.
- `prefers-contrast: more`일 때: `border`→`border-strong`, `text-faint`→`text-muted`, 유리 효과 끔.

### 3.3 글꼴·크기 단계

- 글꼴은 그대로: 본문 **Pretendard Variable**, 코드 **JetBrains Mono**(이미 로컬 번들). 숫자가 바뀌는 자리(쿼터 %, 진행률, 토큰 수)에는 `font-variant-numeric: tabular-nums`.
- 크기 토큰 이름에 값이 들어 있다(`--hx-font-14`). 그래서 **값은 바꾸지 않고 쓰임만 정리**하고, 큰 제목용 24만 추가한다.

| 토큰                  | 쓰임                                       | 줄 간격 | 굵기               |
| --------------------- | ------------------------------------------ | ------- | ------------------ |
| `--hx-font-12`        | 배지·보조 정보·단축키                      | 1.4     | 500                |
| `--hx-font-13`        | 사이드바 줄·메뉴·칩·탭·패널 본문           | 1.45    | 400 / 선택 500     |
| `--hx-font-14`        | 기본 본문·폼                               | 1.6     | 400                |
| `--hx-font-16`        | **대화 메시지 본문**·입력창 글자·카드 제목 | 1.65    | 400 / 제목 600     |
| `--hx-font-20`        | 화면 제목(설정·설치 관리·에이전트 만들기)  | 1.3     | 600, 자간 -0.01em  |
| `--hx-font-24` (신규) | 빈 세션 인사 "○○에서 무엇을 할까요?"       | 1.25    | 650, 자간 -0.015em |

- 본문 자간은 0(Pretendard 권장대로 손대지 않음). 20px 이상 제목만 살짝 좁힌다.
- 굵기 단계 신규: `--hx-weight-regular 400`, `--hx-weight-medium 500`, `--hx-weight-semibold 600`.
- `install.css`의 15px 7곳은 `--hx-font-14` 또는 `--hx-font-16`으로 바꾼다. "큰 글씨가 필요하면 설정 > 글자 크기"라는 원칙으로 간다.

### 3.4 간격

- 값 4/8/12/16/24/32는 그대로 둔다(이미 4의 배수, 이름 `--hx-space-1…6`).
- 바꿀 것은 **쓰는 방법**:
  - 컨트롤 높이 `--hx-control-h` **32px**(지금 28) — 아이콘 버튼·칩·탭·select
  - 목록 한 줄 높이 `--hx-row-h` **32px**(지금 약 29)
  - 좁은 화면(768px 미만) `--hx-control-h-touch` **44px**
  - 구역 안쪽 여백 16, 카드 안쪽 16, 카드 사이 12, 화면 제목 아래 24
- 누르는 영역은 어디서나 24×24 이상(2.5.8). 지금 `hx-plus-menu__pin`, `hx-attachment__remove`(× 버튼)는 기준보다 작을 수 있으니 패딩을 넣는다.

### 3.5 모서리

- 기준 `--hx-radius` 8 → **10**(shadcn 기준값과 같음). 여기서 파생한다.

| 토큰 (신규)        | 값    | 쓰는 곳                             |
| ------------------ | ----- | ----------------------------------- |
| `--hx-radius-sm`   | 6px   | 배지·작은 칩·체크박스               |
| `--hx-radius`      | 10px  | 버튼·입력칸·목록 줄·탭·팝업 안 항목 |
| `--hx-radius-lg`   | 14px  | 카드·팝업·설정 카드·설치 줄·블록    |
| `--hx-radius-xl`   | 22px  | **입력창**·시트·시작 선택 카드      |
| `--hx-radius-full` | 999px | 전송·[+] 버튼, 상태 알약, 진행 막대 |

- 바깥 판 안에 안쪽 요소가 있을 때는 안쪽 반경 = 바깥 반경 − 안쪽 여백으로 맞춘다(예: 입력창 22, 안쪽 칩 10~12).

### 3.6 그림자·유리 효과 — 쓰는 범위

그림자 3단계(신규). 그림자 색은 `color-mix(var(--hx-neutral-900) n%, transparent)`로 만든다(스타일 검사 규칙 통과).

| 토큰            | 밝은 모드                          | 어두운 모드                                                    | 쓰는 곳                              |
| --------------- | ---------------------------------- | -------------------------------------------------------------- | ------------------------------------ |
| `--hx-shadow-1` | `0 1px 2px` 6%                     | 그림자 대신 **위쪽 1px 밝은 테두리**(`inset 0 1px 0` 100의 6%) | 카드·설치 줄                         |
| `--hx-shadow-2` | `0 2px 8px` 8% + `0 0 0 1px` 5%    | 같음 + 테두리 강조                                             | **입력창**, 선택된 블록              |
| `--hx-shadow-3` | `0 12px 32px` 14% + `0 0 0 1px` 6% | 40%                                                            | 팝업·메뉴·슬래시 팔레트·시트·확인 창 |

**유리 효과**(`--hx-glass-bg: color-mix(var(--hx-surface-raised) 78%, transparent)` + `backdrop-filter: blur(16px) saturate(1.4)`)

- **쓰는 곳 (떠 있는 층만)**: `.hx-popover`(칩 메뉴·+ 메뉴), 슬래시 팔레트(`slash.css`), `.hx-stop__menu`, 좁은 화면 `.hx-sheet`와 `.hx-sheet-backdrop`(배경 흐림).
- **쓰지 않는 곳**: 사이드바·상단바·오른쪽 패널·입력창 글자 영역·설정 본문·diff·터미널. 이유는 두 가지다.
  - 글자가 많은 고정 영역에 유리를 쓰면 가독성이 떨어진다(Liquid Glass 불만 사례).
  - 고정 패널은 떠 있지 않아야 한다(Figma가 되돌린 사례).
- **끄는 조건**: 다음 중 하나라도 해당하면 `--hx-glass-bg`를 불투명 `surface-raised`로 바꾸고 blur를 없앤다.
  - `@supports not (backdrop-filter: blur(1px))`
  - `@media (prefers-reduced-transparency: reduce)`
  - `@media (prefers-contrast: more)`
  - 앱 설정 `html[data-reduce-transparency='on']`(선택, 6B.1 일반 설정에 추가 후보 — Safari·Firefox가 미디어 쿼리를 지원하지 않으므로)

### 3.7 움직임

| 토큰 (신규)          | 값                              | 쓰는 곳                                                                                                                                                                                                        |
| -------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--hx-dur-1`         | 100ms                           | 마우스 올림·누름 색 변화, 스위치                                                                                                                                                                               |
| `--hx-dur-2`         | 160ms                           | 팝업 열기(투명도 + 4px 위로), 탭 표시 이동, 칩 추가                                                                                                                                                            |
| `--hx-dur-3`         | 240ms                           | 시트 밀려 나오기, 패널 접기·펴기, 카드 펼치기                                                                                                                                                                  |
| `--hx-ease-standard` | `cubic-bezier(0.2, 0, 0, 1)`    | 기본 (M3 표준 곡선)                                                                                                                                                                                            |
| `--hx-ease-out`      | `cubic-bezier(0.16, 1, 0.3, 1)` | 나타나기                                                                                                                                                                                                       |
| `--hx-ease-in`       | `cubic-bezier(0.4, 0, 1, 1)`    | 사라지기 (나타나기보다 짧게: 0.75배)                                                                                                                                                                           |
| `--hx-ease-spring`   | `linear(...)` 문자열            | 입력창 전송 버튼, [+] 회전, 블록 끌어 놓기 착지. 값은 Jake Archibald·Adam Argyle의 linear() 생성기에서 "Spring" 프리셋(바운스 약하게)으로 만든다. 지원하지 않는 브라우저용으로 `--hx-ease-out`을 먼저 선언한다 |

- 움직이는 것은 `opacity`·`transform`만 쓴다(`width`·`height` 애니메이션 금지 → 화면 버벅임 방지).
- 진행 중 표시는 점 맥박(1.6s)만 둔다. 무한 반복 움직임은 "실행 중" 점 하나로 제한한다.
- **움직임 줄이기 존중**: 지금 `base.css:68-86` 규칙(OS 설정 + 앱 설정 `data-reduce-motion`)이 모든 transition·animation을 0.01ms로 만든다. 이 규칙을 그대로 두면 새 움직임도 자동으로 꺼진다. 추가로 줄이기 상태에서는 `transform` 이동 없이 투명도만 바뀌도록 `--hx-motion-distance: 0`을 둔다.

### 3.8 아이콘

- 유니코드·이모지 기호 → **Lucide** 선 아이콘(ISC 라이선스, React 컴포넌트, 쓰는 것만 번들)으로 바꾼다.
- 크기 16px(목록·버튼) / 20px(상단바·빈 화면), `strokeWidth` 1.75, 색 `currentColor`.
- 한곳에 모은 `design/icons.tsx`(이름 → 컴포넌트 표)로 관리한다. 바꿀 대상 예시:

| 지금              | 새 아이콘                      |
| ----------------- | ------------------------------ |
| ✦ 에이전트 만들기 | `Sparkles`                     |
| ⧉ 플러그인        | `Puzzle`                       |
| ◇ 스킬            | `Wand`                         |
| ⬇ 설치 관리       | `PackagePlus`                  |
| ⚙ 엔진            | `Cpu`                          |
| ☰ 설정           | `Settings`                     |
| ◐☀☾ 테마          | `SunMoon` / `Sun` / `Moon`     |
| ↑ 전송            | `ArrowUp`                      |
| ■ 정지            | `Square`                       |
| + 추가            | `Plus`                         |
| ▾ 펼치기          | `ChevronDown`                  |
| ⏸ 멈춤            | `Pause`                        |
| ✋ 확인 필요      | `Hand`                         |
| ✓ 완료            | `Check`                        |
| ⚠ 경고            | `TriangleAlert`                |
| 📁 폴더           | `Folder`                       |
| 📌 고정           | `Pin`                          |
| 🖼📄📊 첨부 종류   | `Image` / `FileText` / `Sheet` |
| ↶↷ 되돌리기·다시  | `Undo2` / `Redo2`              |

- 아이콘에는 반드시 `aria-hidden="true"`를 달고, 의미는 지금처럼 `aria-label`·글자로 전달한다(지금 구조 유지).
- **에이전트가 직접 고른 아이콘**(사용자가 입력한 `agent.icon` 이모지)은 사용자 데이터이므로 그대로 둔다.
- 이 단계는 TSX를 바꾸므로 2단계로 미룬다(5장 참고).

---

## 4. 바꿀 디자인 토큰 표

토큰 출처는 두 곳이다.

- **`apps/web/src/design/tokens.json`**: 원시 값
- **`apps/web/src/design/css.ts`**: 밝음/어두움 의미 연결과 파생 값

이 두 파일만 바꾸면 모든 CSS가 `var(--hx-*)`를 쓰므로 화면 대부분이 한 번에 바뀐다.

### 4.1 `tokens.json` 원시 토큰 (이름 그대로, 값만)

| 현재 토큰 (CSS 변수)                     | 현재 값             | 새 값                 | 메모                                     |
| ---------------------------------------- | ------------------- | --------------------- | ---------------------------------------- |
| `color.neutral.100` (`--hx-neutral-100`) | `#f7f7f8`           | `#fcfcfd`             | 밝은 bg / 어두운 글자                    |
| `color.neutral.200` (`--hx-neutral-200`) | `#ececef`           | `#f4f4f6`             | 밝은 틀(사이드바 등)                     |
| `color.neutral.300` (`--hx-neutral-300`) | `#dcdce1`           | `#e6e6ea`             | 밝은 테두리·선택                         |
| `color.neutral.400` (`--hx-neutral-400`) | `#b9b9c2`           | `#c8c8d0`             | 밝은 강한 테두리 / 어두운 보조 글자      |
| `color.neutral.500` (`--hx-neutral-500`) | `#8b8b96`           | `#6b6b77`             | 밝은 흐린 글자(4.5:1 통과)               |
| `color.neutral.600` (`--hx-neutral-600`) | `#62626c`           | `#4e4e58`             | 밝은 보조 글자                           |
| `color.neutral.700` (`--hx-neutral-700`) | `#3f3f47`           | `#33333a`             | 어두운 테두리·선택                       |
| `color.neutral.800` (`--hx-neutral-800`) | `#26262c`           | `#1c1c20`             | 어두운 떠 있는 판                        |
| `color.neutral.900` (`--hx-neutral-900`) | `#141417`           | `#111113`             | 밝은 글자 / 어두운 bg / 터미널 바탕      |
| `color.accent` (`--hx-accent`)           | `#5b6cff`           | `#4f5bea`             | 흰 글자 5.1:1                            |
| `color.status.success` (`--hx-success`)  | `#22a06b`           | `#15803d`             |                                          |
| `color.status.warning` (`--hx-warning`)  | `#e2b203`           | `#b45309`             | 노랑 → 호박색(글자로 읽힘)               |
| `color.status.danger` (`--hx-danger`)    | `#e5484d`           | `#c62828`             |                                          |
| `color.status.info` (`--hx-info`)        | `#3b82f6`           | `#2563eb`             | 빌더 "스킬 블록" 돌기 색                 |
| `color.status.running` (`--hx-running`)  | `#8b5cf6`           | `#7c3aed`             |                                          |
| `color.status.paused` (`--hx-paused`)    | `#8b8b96`           | `#6b6b77`             |                                          |
| `space` (`--hx-space-1…6`)               | `[4,8,12,16,24,32]` | **그대로**            |                                          |
| `radius` (`--hx-radius`)                 | `8`                 | `10`                  | 스키마 테스트 수정 필요                  |
| `font.size` (`--hx-font-12…20`)          | `[12,13,14,16,20]`  | `[12,13,14,16,20,24]` | 24 추가(이름이 값이라 기존 값 변경 금지) |
| `font.family.body`                       | Pretendard…         | **그대로**            |                                          |
| `font.family.mono`                       | JetBrains Mono…     | **그대로**            |                                          |

### 4.2 `tokens.json`에 새로 넣을 키 (스키마 확장)

| 새 키                 | 만들어질 CSS 변수                                      | 값                     |
| --------------------- | ------------------------------------------------------ | ---------------------- |
| `color.dark.accent`   | 어두운 모드 `--hx-accent` 덮어쓰기                     | `#7f88ef`              |
| `color.dark.status.*` | 어두운 모드 `--hx-success` 등 덮어쓰기                 | 3.2 표의 어두운 값     |
| `radiusScale`         | `--hx-radius-sm/lg/xl/full`                            | `6 / 14 / 22 / 999`    |
| `weight`              | `--hx-weight-regular/medium/semibold`                  | `400 / 500 / 600`      |
| `lineHeight`          | `--hx-leading-tight/normal/relaxed`                    | `1.3 / 1.5 / 1.65`     |
| `control`             | `--hx-control-h`, `--hx-row-h`, `--hx-control-h-touch` | `32 / 32 / 44`         |
| `motion.duration`     | `--hx-dur-1/2/3`                                       | `100 / 160 / 240` (ms) |
| `motion.easing`       | `--hx-ease-standard/out/in/spring`                     | 3.7 표                 |

> `color.dark`는 css.ts가 hex를 그대로 넣거나 `color-mix(<밝은 hex> 60%, var(--hx-neutral-100))`로 계산해도 된다. 단, `--hx-success` 정의 안에서 `var(--hx-success)`를 다시 부르면 순환 참조가 된다. 그래서 반드시 **원래 hex 값**을 넣는다.

### 4.3 `css.ts` 의미 토큰 (LIGHT / DARK 표)

| 의미 토큰                                 | 현재 LIGHT → 새 LIGHT                                 | 현재 DARK → 새 DARK                              |
| ----------------------------------------- | ----------------------------------------------------- | ------------------------------------------------ |
| `--hx-bg`                                 | `n100` → `n100`                                       | `n900` → `n900`                                  |
| `--hx-surface`                            | `n200` → `n200` (값이 옅어져 사실상 바뀜)             | `n800` → `color-mix(n900 55%, n800)`             |
| `--hx-surface-2`                          | `n300` → `n300`                                       | `n700` → `n700`                                  |
| `--hx-surface-raised` (신규)              | — → `n100`                                            | — → `n800`                                       |
| `--hx-border`                             | `n300` → `n300`                                       | `n700` → `color-mix(n700 70%, n800)`             |
| `--hx-border-strong`                      | `n400` → `n400`                                       | `n600` → `n600`                                  |
| `--hx-border-input` (신규)                | — → `color-mix(n500 70%, n400)`                       | — → `n500`                                       |
| `--hx-text`                               | `n900`                                                | `n100`                                           |
| `--hx-text-muted`                         | `n600`                                                | `n400`                                           |
| `--hx-text-faint`                         | `n500`                                                | `n500` → `color-mix(n400 50%, n500)`             |
| `--hx-on-accent`                          | `n100`                                                | `n100` → **`n900`** (밝힌 강조색 위 어두운 글자) |
| `--hx-<상태>-soft`, `--hx-accent-soft`    | 16% → **12%**                                         | 16% → **18%**                                    |
| `--hx-<상태>-text` (신규)                 | — → `color-mix(var(--hx-<상태>) 80%, var(--hx-text))` | — → `var(--hx-<상태>)`                           |
| `--hx-shadow-1/2/3` (신규)                | 3.6 표                                                | 3.6 표                                           |
| `--hx-glass-bg`, `--hx-glass-blur` (신규) | `color-mix(raised 78%, transparent)`, `16px`          | `color-mix(raised 72%, transparent)`, `20px`     |
| `--hx-focus-ring` (신규)                  | `0 0 0 2px var(--hx-bg), 0 0 0 4px var(--hx-accent)`  | 같음                                             |

### 4.4 `base.css` (토큰을 쓰는 기본 규칙) 손볼 곳

- `body`: `line-height: var(--hx-leading-normal)`, `font-feature-settings` 없이(Pretendard 기본).
- `.hx-icon-btn`: 높이 `--hx-control-h`, 테두리 없는 "고스트" 버튼, `--hx-radius`, `transition: background var(--hx-dur-1) var(--hx-ease-standard)`.
- `:focus-visible`: `outline` 대신 `box-shadow: var(--hx-focus-ring)`. 둥근 모서리를 따라가고, 바깥 2px 간격으로 2.4.11(가려짐)과 대비 3:1을 확보한다.
- 공통 `transition` 기본값: 버튼·탭·칩·줄에 `background-color, color, border-color, box-shadow, opacity` 100~160ms.
- `@media (prefers-contrast: more)`, `@media (prefers-reduced-transparency: reduce)` 블록 추가(3.6).
- 공통 스크롤바: `scrollbar-width: thin; scrollbar-color: var(--hx-border-strong) transparent`.

---

## 5. 패널별 적용 계획

**공통 원칙** (모든 패널)

- 버튼·메뉴 항목·링크의 개수, 순서, 글자, `data-action` id(레지스트리 180개, `apps/web/src/actions/registry.ts`), `aria-*`, `role`, `disabled` 이유(`title`), 키보드 단축키는 **하나도 바꾸지 않는다**.
- **1단계(CSS·토큰만)**: TSX를 건드리지 않는다 → DOM이 그대로다 → 화면 스냅샷 54개(`apps/web/test/__snapshots__/`)가 **변하지 않는다**. 스냅샷은 HTML 구조만 저장하고 CSS는 저장하지 않는다.
- **2단계(아이콘 SVG 교체 등 TSX 변경)**: DOM이 바뀌므로 해당 스냅샷을 갱신(`vitest -u` 해당 파일만)하고, 바뀐 내용이 "아이콘 태그 교체뿐"인지 사람이 diff를 확인한다.
- 같은 클래스를 여러 화면이 함께 쓴다는 점에 주의한다.
  - `.hx-composer`는 대화 입력창과 빌더 "대화로 만들기"에서 쓴다.
  - `.hx-sidebar__tab`은 빌더 왼쪽 열(`builder/chat/chat.css:11-26`)에서 쓴다.
  - `.hx-popover`는 칩 메뉴·+ 메뉴에서 쓴다.

### 5.1 사이드바 (`shell/Sidebar.tsx`, `shell/shell.css:181-335`, `shell/projects/projects.css`)

- **레이아웃 변화**:
  - 배경을 `surface`(아주 옅은 회색)로 두고 오른쪽 테두리선을 없앤다. 본문과는 색 차이만으로 나눈다.
  - 폭은 240 그대로 둔다(조절·접기 기능 유지).
  - **[+ 새 세션]**: 꽉 찬 강조색 덩어리 대신 `surface-raised` 바탕 + `shadow-1` + 아이콘 + 오른쪽에 단축키 `Ctrl N` 회색 표시. 높이 36, `radius`. 본체·▾ 분할 구조(0B.22)는 그대로 둔다.
  - 세션 줄: 높이 32, 좌우 여백 8, `radius`. 선택된 줄은 `surface-2` + 글자 `text` + 굵기 500. 상태 점 8px → 상태 아이콘(2단계). 엔진 이름·시각은 `font-12 text-faint`로 오른쪽 정렬한다.
  - 프로젝트 머리글: `font-12 semibold text-faint` 대문자 느낌 라벨. 접기 화살표는 회전 움직임(`dur-2`).
  - 필터 select 3개: 높이 28 "고스트 select"(테두리 없음, 마우스 올리면 `surface-2`). 기능은 그대로다.
  - 하단 메뉴: 위쪽 선을 없애고 여백 12로 구분한다. 아이콘 16 + 글자 13. 준비 중 항목은 `opacity .5` + `title` 유지.
  - "확인 필요" 배지는 `warning-soft` 바탕 + `warning-text` 알약(`radius-full`).
  - 진행 막대는 높이 4, `radius-full`, 채움에 `transition: width` 대신 `transform: scaleX`.
- **스냅샷**: 1단계는 변화 없음. 2단계(아이콘) 때 `shell.sidebar`, `shell.agent-sessions`, `projects.sidebar`, `projects.flows`, `stages.session-row` 갱신.

### 5.2 상단바 (`shell/TopBar.tsx`, `shell/shell.css:49-179`, `shell/WorkspaceBar.tsx`)

- **레이아웃 변화**:
  - 높이 48 → 44. 배경을 `bg`와 같게 하고, 아래 테두리선 대신 본문이 스크롤될 때만 `shadow-1`을 보여 준다(선택. JS 없이 하려면 항상 hairline `border` 50%).
  - 작업 공간 이름 `font-14 semibold`, 경로 `font-12 text-faint`, 브랜치는 `radius-full` 알약 + `GitBranch` 아이콘(2단계).
  - 실행 상태: 점 + 글자 → 상태별 `-soft` 알약(실행 중이면 `running-soft` + 점 맥박).
  - 쿼터 막대: 48×6 → 56×4, `radius-full`. 80%·95% 색 규칙(`QUOTA_WARNING_RATIO`)은 그대로다.
  - [전체 정지]: `danger-soft` 바탕 + `danger-text`, 높이 28, `radius-full`.
  - 테마 버튼: 고스트 아이콘 버튼.
- **좁은 화면**: 경로·쿼터 숨김 규칙(`shell.css:31-34`)을 그대로 둔다.
- **스냅샷**: 1단계 변화 없음. 2단계 `shell.topbar`, `shell.quota`(아이콘 추가 시).

### 5.3 입력창 (`composer/*.tsx`, `composer/composer.css`, `composer/slash.css`) — 가장 큰 체감 변화

- **레이아웃 변화** (T-101 "최종 입력창 모습" 구조는 그대로):
  - 바깥: `surface-raised` + `radius-xl`(22) + `shadow-2` + 테두리 `border`. 대화 폭과 맞춰 가운데 정렬하고 최대폭 760.
  - 포커스되면 테두리 `border-strong` + `shadow-2` 강화(`dur-2`).
  - 끌어 놓기: 점선 대신 `accent` 2px 테두리 + `accent-soft` 바탕 + 가운데 "여기에 놓으세요"(1E.1).
  - 글자: `font-16`, 줄 간격 1.6, 최소 높이 56. 자동 높이(최대 240)는 그대로다.
  - 아래 도구 줄: [+] 32px 원형 **고스트**(꽉 찬 강조색 대신 `surface-2`). 권한·모드·엔진 칩은 높이 32, `radius-full`, 테두리 없는 `surface-2` 바탕. 펼침 ▾ 아이콘 회전.
  - 전송 [↑]: 32px **원형** 강조색(`radius-full`). 비활성은 `surface-2` + `text-faint`. 실행 중 [■ 정지]는 같은 자리에서 `danger` 원형 + 사각 아이콘으로 바뀌고, 모양이 바뀌는 움직임에 `ease-spring`을 쓴다.
  - 첨부 칩: `surface-2` 바탕, `radius`(10), 높이 28, 종류 아이콘 16. 상태(바꾸는 중/✓/⚠)는 `-text` 색. × 버튼은 24×24 누름 영역.
  - 팝업(칩 메뉴·+ 메뉴·슬래시 팔레트·정지 메뉴): `radius-lg` + `shadow-3` + **유리 효과**. 열림은 160ms 투명도 + 4px 위로. 항목 높이 32, 선택 항목 `surface-2`.
  - 서브에이전트 확인 카드·모드 확인: `accent-soft` 바탕 + `radius-lg`, 주 버튼 강조색·보조 버튼 고스트.
- **모바일**: 좌우 여백 8, 칩 아이콘 숨김(`composer.css:81-93`) 유지, 버튼 44px.
- **스냅샷**: 1단계 변화 없음. 2단계 `composer.chips`, `composer.toolbar`, `composer.plus-menu`, `composer.slash`, `composer.mode`, `composer.mobile-picker`, `run-mode.*`, `chat.stopblock` 갱신.

### 5.4 오른쪽 패널 (`shell/RightPanel.tsx`, `shell/shell.css:349-389`, `panels/*.css`, `panels/Checklist/checklist.css`, `panels/Approvals/approvals.css`)

- **레이아웃 변화**:
  - 고정 + 크기 조절 + 접기 그대로(Figma 사례: 떠 있는 패널 금지). 배경 `surface`, 왼쪽 선을 없앤다.
  - 리사이저(`shell.css:338-347`): 4px 칸은 유지하되 평소 투명. 마우스를 올리거나 끌 때 가운데 2px `accent` 선(`dur-1`). 누름 영역은 그대로 4px + `::before`로 좌우 4px 확장(끌기 쉬움).
  - 탭(체크리스트·Diff·터미널·궤적): **통일된 "세그먼트" 탭**. 높이 32, 선택 탭은 `surface-raised` + `shadow-1` + 글자 `text`, 나머지는 `text-muted`. 끌어서 순서 바꾸기·`data-drop-target` 표시(왼쪽 2px accent)는 그대로다. `cursor: grab`은 끄는 중에만 쓴다.
  - 본문: 안쪽 여백 16, 카드형 섹션(`surface-raised` + `radius-lg` + `shadow-1`).
  - 체크리스트: 진행 막대 `radius-full`. 상태 기호 ●◐○ → `CircleCheck`/`CircleDashed`/`Circle` 아이콘(2단계). 현재 항목은 `accent-soft` 바탕.
  - 승인 카드: 위험도별 `-soft` 바탕 + 왼쪽 3px 상태색 막대. [승인]/[거절] 버튼 위치는 그대로다.
  - Diff·터미널: Monaco·xterm 테마를 토큰과 맞춘다(터미널 바탕 `neutral-900` 유지). 바깥 `radius-lg`.
- **스냅샷**: 1단계 변화 없음. 2단계 `panels.checklist.*`, `approvals.*` 갱신.

### 5.5 설정 (`settings/SettingsScreen.tsx`, `settings/settings-screen.css`, `settings/form/settings-form.css`, `settings/Engines/engines.css`)

- **레이아웃 변화**:
  - 지금은 위쪽 탭 줄(테두리 상자 탭)이다. 넓은 화면(≥ 1024px)에서는 **왼쪽 세로 목록 탭**으로 바꾼다(ChatGPT·Linear·macOS 설정 방식). 같은 `role="tab"` 버튼을 CSS `flex-direction: column` + grid 2열로 배치하므로 DOM은 그대로다. 좁은 화면은 지금처럼 위쪽 가로 스크롤 탭.
  - 본문 최대폭 880 → 720(읽기 폭). 제목 `font-20 semibold`.
  - 설정 카드: `surface-raised` + `radius-lg` + `shadow-1`. 카드 안 항목은 "왼쪽 이름·설명 / 오른쪽 조작" 2열, 항목 사이 hairline 구분.
  - 스위치(`hx-setting__switch`): 36×20 알약, 손잡이 이동 `dur-2 ease-spring`. 켜짐=`accent`. "켜짐/꺼짐" 글자 유지.
  - 검색칸: 높이 36, `radius-full`, 돋보기 아이콘.
  - "이 값이 어디에 적용되나요?"(6B.14) 배지: `info-soft` 알약.
- **스냅샷**: 1단계 변화 없음(세로 탭도 CSS만). 2단계 `settings.screen.*` 14개, `settings.form.widgets`, `settings.engines.*`(아이콘 추가 시).

### 5.6 설치 관리 (`install/InstallManager.tsx`, `install/install.css`, `install/FirstRunCard.tsx`, `install/InstallPlanCard.tsx`)

- **레이아웃 변화**:
  - 15px 직접 지정 7곳 → 토큰(본문 `font-14`, 이름 `font-16 semibold`).
  - 탭: 설정과 같은 세그먼트 탭으로 통일한다(밑줄 탭 제거). 높이 44는 초보자용이라 유지한다.
  - 설치 줄: 테두리 상자 → `surface-raised` 카드(`radius-lg`, `shadow-1`). 왼쪽에 종류 아이콘 32px 원형, 가운데에 이름·버전(mono)·출처·신뢰 배지, 오른쪽에 동작 버튼. 실패 줄은 `danger` 왼쪽 막대 + `danger-soft` 바탕.
  - 입력칸·select·버튼: 높이 44, `radius`, 입력 테두리 `border-input`(3:1). 주 버튼(설치)은 강조색, 나머지는 고스트.
  - **사람 클릭 없이 설치 금지 원칙**(T-100)에 따라 확인 버튼·순서를 바꾸지 않는다.
- **스냅샷**: 1단계 변화 없음. 2단계 `install.card`, `install.manager`, `install.resolve-fail`.

### 5.7 에이전트 만들기 (`builder/*.tsx`, `builder/builder.css`, `builder/chat/chat.css`, `builder/draft/draft.css`)

- **레이아웃 변화**:
  - 3열(서랍 260 / 캔버스 / 인스펙터 300) 그대로. 서랍·인스펙터는 `surface`, 캔버스는 `bg` + 점 격자(16px, `border-strong` 40%).
  - **React Flow 어두운 모드 연결**: `colorMode`를 앱 테마(`data-theme`/시스템)에 맞춘다(TSX 한 줄, 2단계). 노드·간선·컨트롤 색을 `--xy-*` 변수 → `--hx-*` 토큰으로 연결한다(CSS).
  - 노드 카드: `surface-raised` + `radius-lg` + `shadow-1`. 선택 시 `0 0 0 2px accent` + `shadow-2`. 머리(종류·이름) `font-13 semibold`.
  - 블록(레고): 돌기 색 규칙(스킬=`info` 파랑, 엔진=`warning` 주황, `builder.css:1-2`)을 유지하되 새 상태색 값을 쓴다. 끌어 놓을 때 착지 움직임 `ease-spring` 200ms.
  - 시작 선택 카드 3개: `radius-xl`, 마우스 올리면 `shadow-2` + 2px 떠오르기. 선택은 `accent` 테두리 + `accent-soft`.
  - 저장줄(`hx-savebar`): 위쪽 바 안의 입력칸 높이 32, 고스트 입력칸(포커스 때만 테두리).
  - 인스펙터 탭(노드·YAML 보기·시험 실행): 세그먼트 탭으로 통일.
- **스냅샷**: 1단계 변화 없음. 2단계 `builder.layout`(React Flow `light`→테마 클래스가 바뀌므로 **반드시 갱신**), `builder.dryrun.stages`, `engines.builder`, `forge.cards`.

### 5.8 진행 순서 제안 (커밋 단위)

| 순서 | 묶음                                           | 바꾸는 파일                                                                     | 스냅샷        |
| ---- | ---------------------------------------------- | ------------------------------------------------------------------------------- | ------------- |
| 1    | 토큰 값 + 신규 토큰 + 생성기                   | `design/tokens.json`, `design/tokens.ts`, `design/css.ts`, 테스트 2개(아래 6장) | 변화 없음     |
| 2    | 기본 규칙(포커스·전환·대비·투명도 미디어 쿼리) | `design/base.css`                                                               | 변화 없음     |
| 3    | 셸(사이드바·상단바·패널·리사이저)              | `shell/shell.css`, `shell/projects/projects.css`                                | 변화 없음     |
| 4    | 입력창·팝업                                    | `composer/composer.css`, `composer/slash.css`                                   | 변화 없음     |
| 5    | 오른쪽 패널 내용                               | `panels/**/*.css`                                                               | 변화 없음     |
| 6    | 설정·설치 관리 (15px 정리, 탭 통일)            | `settings/**/*.css`, `install/install.css`                                      | 변화 없음     |
| 7    | 빌더 CSS                                       | `builder/**/*.css`                                                              | 변화 없음     |
| 8    | 아이콘 SVG 교체 + React Flow colorMode (TSX)   | `design/icons.tsx`(신규), 각 TSX, `package.json`(lucide-react)                  | **갱신 필요** |

---

## 6. 위험·검증 방법

### 6.1 위험

| 위험                          | 내용                                                                                                                                                                                                                    | 대응                                                                                                                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1 토큰 테스트가 옛 값을 고정 | `apps/web/test/tokens.schema.test.ts`가 `radius: z.literal(8)`, 글자 `[12,13,14,16,20]`, `strictObject`(새 키 거부)로 고정. `apps/web/test/tokens.css.test.ts`가 `#f7f7f8`, `#141417`, `#5b6cff`, `8px`를 문자열로 확인 | 1단계 커밋에서 **테스트 기대값을 새 값으로 함께 수정**(규칙이 바뀐 것이지 기능 퇴행이 아님을 커밋 메시지에 적음). `design/tokens.ts`의 `RADIUS`, `FONT_SIZES` 상수도 함께 수정 |
| R2 스타일 검사 규칙           | `apps/web/.stylelintrc.json`이 CSS 파일에서 hex·이름 색·`rgb/hsl/oklch()`를 금지                                                                                                                                        | 새 색은 전부 `tokens.json`에 hex로 두고, CSS에서는 `var()`·`color-mix(var())`만 쓴다. `transparent`는 키워드라 허용(현재도 사용 중)                                            |
| R3 공유 클래스                | `.hx-composer`(빌더 대화), `.hx-sidebar__tab`(빌더), `.hx-popover`(여러 메뉴)를 함께 씀                                                                                                                                 | 셸을 바꾼 뒤 빌더 화면을 꼭 함께 확인                                                                                                                                          |
| R4 겹침·가려짐                | 그림자·유리 팝업이 z-index를 바꾸거나, 높아진 입력창이 포커스 항목을 가릴 수 있음(2.4.11)                                                                                                                               | z-index 단계 토큰화(팝업 5, 시트 10/11 유지), 대화 스크롤 영역에 `scroll-padding-bottom: 입력창 높이`                                                                          |
| R5 눌림 영역 변화             | 32px로 커지거나 고스트 버튼이 되면서 "전부 눌러 보기" 검사의 클릭 좌표·표시 여부가 달라질 수 있음                                                                                                                       | `pnpm check:dead-buttons`로 확인. `display:none`으로 숨기는 버튼을 새로 만들지 않음                                                                                            |
| R6 성능                       | `backdrop-filter`는 GPU 비용이 큼                                                                                                                                                                                       | 떠 있는 작은 층에만 사용(3.6), 큰 영역 금지                                                                                                                                    |
| R7 글자 크기 설정과 충돌      | `base.css:60-66`이 `zoom`으로 글자 크기를 조절 → px 그림자·반경도 함께 커짐                                                                                                                                             | 의도한 동작으로 두고 small/large에서 눈으로 확인                                                                                                                               |
| R8 아이콘 의존성              | lucide-react 추가로 번들이 커짐                                                                                                                                                                                         | 개별 import(tree-shaking), 아이콘 약 30개만 사용                                                                                                                               |
| R9 화면 비교 자동화 없음      | 스냅샷은 HTML만 비교하므로 **색·모양이 바뀌어도 테스트가 모름**                                                                                                                                                         | 사람 확인(🖐): 밝음·어두움 × 넓은·좁은 화면 × 7개 패널 = 28장 스크린샷을 `docs/tickets/` 기록 경로에 첨부                                                                      |

### 6.2 검증 순서 (각 단계 커밋마다)

1. **스타일 규칙**: `apps/web/test/stylelint.test.ts` + stylelint 실행 — 하드코딩 색 0건.
2. **토큰 테스트**: `apps/web/test/tokens.schema.test.ts`, `apps/web/test/tokens.css.test.ts` — 새 기대값으로 통과.
3. **전부 눌러 보기**: `pnpm check:dead-buttons` — ESLint(data-action 규칙) + `click-all.self.test.tsx` + `click-all.test.tsx`. 180개 동작이 전부 "누르면 무언가 일어남"인지 확인한다. **1~7단계에서 결과가 이전과 똑같아야 한다.**
4. **기능 고정 테스트**: `pnpm test:features` — `// @features F-xxx` 태그가 붙은 테스트 전체(일꾼 4개, 타입 검사 끔). 기능이 하나도 안 바뀌었다는 증거.
5. **화면 스냅샷**: 1~7단계는 `vitest run` 결과 스냅샷 **변경 0건**이어야 한다(변경이 생기면 실수로 TSX를 건드린 것). 8단계만 `vitest -u <해당 파일>` 후 diff가 "아이콘 태그·테마 클래스 교체뿐"인지 확인한다.
6. **대비 점검**: 3.2 표의 쌍을 브라우저 개발자 도구(색 대비 표시) 또는 axe로 다시 측정한다. 글자 4.5:1, 아이콘·입력 테두리 3:1.
7. **설정 존중 점검**: OS 움직임 줄이기 ON / 앱 설정 `on`·`off`·`system`, Chrome `prefers-reduced-transparency` 에뮬레이션, `prefers-contrast: more` 에뮬레이션(개발자 도구 Rendering 탭)에서 움직임·유리 효과가 꺼지는지 본다.
8. **키보드**: Tab으로 모든 패널을 돌며 포커스 링이 보이고 입력창·시트에 가려지지 않는지 본다(2.4.11).
9. **사람 확인 🖐**: 6.1 R9의 스크린샷 28장 + "옛날 느낌이 사라졌나" 사용자 판정.

### 6.3 완료 점수표 (이 문서 기준)

| 항목                                                       | 완료 / 전체 | %                     |
| ---------------------------------------------------------- | ----------- | --------------------- |
| 1. 진단 (근거 파일:줄)                                     | 14 / 14     | 100%                  |
| 2. 경향 요약표 (출처)                                      | 12 / 12     | 100%                  |
| 3. 새 방향 (색·글꼴·간격·모서리·그림자/유리·움직임·아이콘) | 7 / 7       | 100%                  |
| 4. 토큰 표 (원시·신규·의미·base)                           | 4 / 4       | 100%                  |
| 5. 패널별 계획 (7패널 + 순서)                              | 8 / 8       | 100%                  |
| 6. 위험·검증                                               | 3 / 3       | 100%                  |
| 실제 코드 적용                                             | 0 / 8 단계  | 0% (이 문서는 방향만) |
