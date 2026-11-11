import type { ActionCardBadge, ActionCardModel } from '../panels/Approvals/model.js';

/**
 * 설치 관리자 화면 모델 (T-100 Part 2 C·D·G)
 * 서버 계획(@harness-x/installer InstallPlan)과 같은 모양을 웹에서 따로 정의한다 (웹은 Node 패키지를 번들하지 않는다).
 * 카드는 승인 카드와 같은 범용 ActionCard 틀로 그린다 (D.8).
 */

export const INSTALL_KINDS = [
  'winget',
  'scoop',
  'choco',
  'npm-cli',
  'python-cli',
  'cargo',
  'go',
  'ollama-model',
  'mcp-local',
  'mcp-remote',
  'harness-plugin',
  'skill',
  'vscode-ext',
  'docker-image',
  'wsl-apt',
  'direct-download',
  'api-service',
] as const;
export type InstallKind = (typeof INSTALL_KINDS)[number];

export const PRICING_TIERS = ['free', 'freemium', 'trial', 'paid', 'unknown'] as const;
export type PricingTier = (typeof PRICING_TIERS)[number];
export type PlanAction = 'install' | 'uninstall' | 'update' | 'rollback';

export interface PricingView {
  tier: PricingTier;
  note: string;
  checkedAt: string;
  sourceUrl: string;
}

export interface InstallPlanView {
  id: string;
  kind: InstallKind;
  name: string;
  version: string;
  source: { url: string; publisher: string; verified: boolean };
  pricing: PricingView;
  license: { id: string; plain: string };
  sizeMB: number | null;
  etaSec: number | null;
  needsAdmin: boolean;
  needsRestart: boolean;
  changes: string[];
  risks: string[];
  commands: string[];
  uninstall: { commands: string[] };
  verify: { cmd: string; expect: string };
  target: string;
  host?: 'windows' | 'linux';
  action?: PlanAction;
  interactive?: boolean;
  toolId?: string;
}

// ── D.2 무료/유료 배지 (필수) ─────────────────────────────────────
export type BadgeTone = 'green' | 'blue' | 'orange' | 'red' | 'yellow';

export const PRICING_BADGES: Record<PricingTier, { label: string; tone: BadgeTone }> = {
  free: { label: '무료', tone: 'green' },
  freemium: { label: '무료+유료 기능', tone: 'blue' },
  trial: { label: '체험판', tone: 'orange' },
  paid: { label: '유료', tone: 'red' },
  unknown: { label: '무료인지 확인 못 했어요', tone: 'yellow' },
};

/** 배지 없는 설치 카드는 그리지 않는다 (D.2 — 렌더 오류) */
export class MissingPricingBadgeError extends Error {
  constructor(name: string) {
    super(`설치 카드에 무료/유료 표시가 없어요: ${name}`);
    this.name = 'MissingPricingBadgeError';
  }
}

export function isPricingTier(v: unknown): v is PricingTier {
  return typeof v === 'string' && (PRICING_TIERS as readonly string[]).includes(v);
}

/** 계획의 가격 정보 → 배지. 정보가 없거나 모르는 값이면 MissingPricingBadgeError */
export function pricingBadge(pricing: { tier?: unknown } | undefined | null, name = '?'): ActionCardBadge {
  if (!pricing || !isPricingTier(pricing.tier)) throw new MissingPricingBadgeError(name);
  const b = PRICING_BADGES[pricing.tier];
  return { label: b.label, tone: b.tone };
}

// ── 종류별 쉬운 말 ───────────────────────────────────────────────
export const KIND_LABEL: Record<InstallKind, string> = {
  winget: '윈도우 앱',
  scoop: '윈도우 앱',
  choco: '윈도우 앱',
  'npm-cli': '노드 명령줄 도구',
  'python-cli': '파이썬 명령줄 도구',
  cargo: '러스트 도구',
  go: 'Go 도구',
  'ollama-model': '내 PC에서 도는 AI 모델',
  'mcp-local': 'AI 연결 도구(내 PC)',
  'mcp-remote': 'AI 연결 도구(인터넷 주소)',
  'harness-plugin': '하네스 플러그인',
  skill: '하네스 스킬',
  'vscode-ext': '비주얼 스튜디오 코드 확장',
  'docker-image': '도커 이미지',
  'wsl-apt': 'WSL 리눅스 패키지',
  'direct-download': '직접 받는 설치 파일',
  'api-service': '가입형 인터넷 서비스',
};

/** 어디서 받나요? (설치 도구 이름은 따옴표로 — 쉬운 말 검사에서 값으로 본다) */
export const KIND_SOURCE: Record<InstallKind, string> = {
  winget: '윈도우 공식 앱 저장소("winget")',
  scoop: '내 사용자 폴더용 앱 저장소("scoop")',
  choco: '관리자용 앱 저장소("choco")',
  'npm-cli': '노드 공식 패키지 저장소("npm")',
  'python-cli': '파이썬 공식 패키지 저장소("PyPI")',
  cargo: '러스트 공식 패키지 저장소("crates.io")',
  go: 'Go 공식 패키지 저장소',
  'ollama-model': '올라마 모델 목록("Ollama")',
  'mcp-local': 'AI 연결 도구 저장소',
  'mcp-remote': '서비스 회사의 인터넷 주소',
  'harness-plugin': '만든 사람의 코드 저장소',
  skill: '만든 사람의 코드 저장소',
  'vscode-ext': '비주얼 스튜디오 코드 공식 확장 마켓',
  'docker-image': '도커 이미지 저장소("Docker Hub")',
  'wsl-apt': '리눅스 공식 패키지 저장소',
  'direct-download': '게시자 공식 누리집',
  'api-service': '서비스 회사 누리집',
};

const ACTION_TITLE: Record<PlanAction, string> = {
  install: '설치해도 될까요?',
  uninstall: '지워도 될까요?',
  update: '업데이트해도 될까요?',
  rollback: '정리해도 될까요?',
};

export const ACTION_BUTTON: Record<PlanAction, string> = {
  install: '설치',
  uninstall: '지우기',
  update: '업데이트',
  rollback: '정리하기',
};

/** 클릭 토큰 종류 (커널 GESTURE_KINDS) */
export const ACTION_GESTURE: Record<PlanAction, 'install' | 'uninstall' | 'update' | 'rollback'> = {
  install: 'install',
  uninstall: 'uninstall',
  update: 'update',
  rollback: 'rollback',
};

export const UNKNOWN_CHECK_LABEL = '무료인지 직접 확인했어요';
export const NO_PAYMENT_TEXT = '하네스는 결제를 하지 않아요.';
export const ADMIN_TEXT = '윈도우가 허락을 물어볼 거예요. (예 누르기)';
export const ADMIN_WAITING_TEXT = '윈도우 허락 창을 기다리고 있어요. 예를 눌러 주세요.';
export const SUDO_TEXT = '관리자 비밀번호가 필요해요. 터미널 창에서 직접 넣어 주세요.';

const TIER_NOTE: Record<PricingTier, string> = {
  free: '돈을 내지 않고 쓸 수 있어요.',
  freemium: '기본 기능은 무료이고, 일부 기능은 돈을 내야 해요.',
  trial: '정해진 기간만 무료로 써 볼 수 있어요.',
  paid: '쓰려면 돈을 내야 해요.',
  unknown: '무료인지 확인하지 못했어요.',
};

function sizeText(p: InstallPlanView): string {
  const parts: string[] = [];
  if (p.sizeMB !== null && p.sizeMB !== undefined)
    parts.push(p.sizeMB >= 1024 ? `약 ${(p.sizeMB / 1024).toFixed(1)}GB` : `약 ${Math.round(p.sizeMB)}MB`);
  if (p.etaSec !== null && p.etaSec !== undefined)
    parts.push(p.etaSec < 60 ? '1분 안쪽' : `${Math.round(p.etaSec / 60)}분 정도`);
  if (parts.length === 0) return '크기와 걸리는 시간은 아직 몰라요.';
  return `${parts.join(', ')} 걸려요.`.replace('MB 걸려요', 'MB예요');
}

function adminText(p: InstallPlanView): string {
  if (p.kind === 'wsl-apt') return SUDO_TEXT;
  return p.needsAdmin ? ADMIN_TEXT : '필요 없어요.';
}

function quoted(s: string): string {
  return `"${s.replace(/"/g, '')}"`;
}

export type InstallCardButtonId = 'install' | 'alternatives' | 'open-purchase' | 'cancel';

export interface PlanCardOptions {
  /** 다른 설치 방법이 있으면 [다른 방법 보기] 사용 (기본 true) */
  alternatives?: boolean;
  /** 지금 상태 (D.7 대기 표시 등) */
  status?: string;
}

/**
 * P2-D.1 InstallPlan → 쉬운 말 카드
 * 무엇을 / 어디서 / 무료·유료(배지) / 사용 조건 / 크기·시간 / 관리자 권한 / 바뀌는 것 / 위험 / 지우는 방법
 */
export function planToCard(plan: InstallPlanView, o: PlanCardOptions = {}): ActionCardModel {
  const badge = pricingBadge(plan.pricing, plan.name);
  const action: PlanAction = plan.action ?? 'install';
  const tier = plan.pricing.tier;
  const note = plan.pricing.note?.trim() || TIER_NOTE[tier];
  const version = plan.version && plan.version !== 'latest' ? ` 버전은 ${quoted(plan.version)}이에요.` : '';
  const sections: ActionCardModel['sections'] = [
    {
      heading: '무엇을',
      text: `종류는 ${KIND_LABEL[plan.kind]}이고, 이름은 ${quoted(plan.name)}이에요.${version}`,
    },
    {
      heading: '어디서 받나요?',
      text:
        `${KIND_SOURCE[plan.kind]}에서 받아요.` +
        (plan.source.verified ? '' : ' 게시자를 확인하지 못했어요.'),
    },
    { heading: '무료인가요?', text: note },
    { heading: '사용 조건', text: plan.license.plain || '사용 조건을 직접 확인해 주세요.' },
    { heading: '크기·시간', text: sizeText(plan) },
    { heading: '관리자 권한', text: adminText(plan) },
    {
      heading: '바뀌는 것',
      text: plan.changes.length ? plan.changes.join(' ') : '바뀌는 것을 미리 알 수 없어요.',
    },
  ];
  if (plan.risks.length) sections.push({ heading: '조심할 점', text: plan.risks.join(' ') });
  if (plan.needsRestart) sections.push({ heading: '다시 켜기', text: 'PC를 다시 켜야 할 수도 있어요.' });
  if (action === 'install')
    sections.push({
      heading: '지우는 방법',
      text: plan.uninstall.commands.length
        ? '설치 관리에서 [지우기]를 한 번 누르면 돼요.'
        : '지우는 방법은 직접 확인해 주세요.',
    });
  // D.3 유료·체험판: 가격 안내 + 결제는 하지 않음 + 공식 구매 페이지
  const paidLike = tier === 'paid' || tier === 'trial';
  if (paidLike)
    sections.push({
      heading: '가격 안내',
      text:
        `${NO_PAYMENT_TEXT} 값을 내야 하면 공식 구매 페이지에서 직접 해 주세요.` +
        (plan.kind === 'api-service' ? ' 구매한 뒤 받은 키는 [키 넣기]로 넣어 주세요.' : ''),
    });
  const buttons: ActionCardModel['buttons'] = [
    {
      id: 'install',
      label: ACTION_BUTTON[action],
      primary: true,
      ...(tier === 'unknown' && action !== 'uninstall' ? { requiresCheck: true } : {}),
    },
    ...(o.alternatives === false ? [] : [{ id: 'alternatives', label: '다른 방법 보기' }]),
    ...(paidLike && plan.pricing.sourceUrl ? [{ id: 'open-purchase', label: '공식 구매 페이지 열기' }] : []),
    { id: 'cancel', label: '취소' },
  ];
  const technical = [
    { label: '실행할 명령', value: plan.commands.join('\n') || '(없음)' },
    ...(plan.uninstall.commands.length
      ? [{ label: '지우는 명령', value: plan.uninstall.commands.join('\n') }]
      : []),
    ...(plan.verify.cmd ? [{ label: '확인 명령', value: plan.verify.cmd }] : []),
    { label: '종류', value: plan.kind },
    { label: '대상', value: plan.target },
    ...(plan.source.url ? [{ label: '출처', value: plan.source.url }] : []),
    ...(plan.license.id ? [{ label: '라이선스', value: plan.license.id }] : []),
    ...(plan.pricing.sourceUrl
      ? [
          {
            label: '가격 확인',
            value: `${plan.pricing.sourceUrl} (${plan.pricing.checkedAt || '날짜 없음'})`,
          },
        ]
      : []),
  ];
  return {
    id: plan.id,
    icon: '📦',
    title: ACTION_TITLE[action],
    subtitle: plan.name,
    badges: [badge],
    sections,
    buttons,
    ...(tier === 'unknown' && action !== 'uninstall' ? { checkbox: UNKNOWN_CHECK_LABEL } : {}),
    ...(o.status ? { status: o.status } : {}),
    technical,
  };
}

/** 카드의 쉬운 말 글 (H.6 검사 대상): [문장들, 짧은 이름표들] */
export function cardTexts(card: ActionCardModel): { sentences: string[]; labels: string[] } {
  return {
    sentences: [...card.sections.map((s) => s.text), ...(card.status ? [card.status] : [])],
    labels: [
      card.title,
      ...(card.badges ?? []).map((b) => (typeof b === 'string' ? b : b.label)),
      ...card.sections.flatMap((s) => (s.heading ? [s.heading] : [])),
      ...card.buttons.map((b) => b.label),
      ...(card.checkbox ? [card.checkbox] : []),
    ],
  };
}

// ── C.6 주소 해석 실패 카드 ───────────────────────────────────────
export interface ResolveResultView {
  input: string;
  classification?: { type?: string; url?: string };
  candidates: CandidateView[];
  recommended?: CandidateView;
  reason?: string;
  failure?: string;
}

export interface CandidateView {
  kind: InstallKind;
  target: { id: string; version?: string; name?: string };
  label: string;
  source: string;
  trust?: { level: string; reasons: string[] };
}

export const RESOLVE_FAIL_TITLE = '이 주소에서 설치 방법을 찾지 못했어요';

const FAIL_REASONS: Record<string, string> = {
  unknown: '하네스가 아는 설치 주소 모양이 아니에요.',
  'github-repo': '저장소 안에서 설치할 수 있는 파일을 찾지 못했어요.',
  'github-release': '릴리스에 Windows용 설치 파일이 없어요.',
  'gist-skill': '스킬 설명 파일을 찾지 못했어요.',
};

/** 끝에 붙은 괄호 덧붙임을 따로 떼어 낸다: "…없어요(인터넷 조회 꺼짐)." → "…없어요. (인터넷 조회 꺼짐)" */
function splitAside(s: string): string {
  return s.replace(/\s*\(([^)]*)\)\.?$/, '. ($1)').replace(/\.\. \(/, '. (');
}

const politeEnd = (s: string) => /(요|니다)[.!?]?$/.test(s.replace(/\s*\([^)]*\)$/, '').trim());

/** 서버 실패 문구가 존댓말 문장이면 그대로(괄호 덧붙임만 정리), 아니면 주소 모양에 맞는 설명 */
export function failureReason(r: ResolveResultView): string {
  const raw = splitAside((r.failure ?? '').trim());
  if (raw && raw.replace(/\.$/, '') !== RESOLVE_FAIL_TITLE && politeEnd(raw)) return raw;
  return FAIL_REASONS[r.classification?.type ?? 'unknown'] ?? FAIL_REASONS.unknown!;
}

export function resolveFailureCard(
  r: ResolveResultView,
  cardId = `resolve-fail:${r.input}`,
): ActionCardModel {
  const url = r.classification?.url ?? r.input;
  const openable = /^https?:\/\//i.test(url);
  return {
    id: cardId,
    title: RESOLVE_FAIL_TITLE,
    sections: [
      { heading: '이유', text: failureReason(r) },
      {
        heading: '이렇게 해 보세요',
        text: openable
          ? '주소를 열어 설치 안내를 직접 확인해 주세요.'
          : '주소를 다시 확인해 주세요. 이름으로 찾기도 할 수 있어요.',
      },
    ],
    buttons: [
      ...(openable ? [{ id: 'open-url', label: '주소 열기', primary: true }] : []),
      { id: 'close', label: '닫기' },
    ],
    technical: [
      { label: '넣은 주소', value: r.input },
      { label: '주소 모양', value: r.classification?.type ?? 'unknown' },
      ...(r.failure ? [{ label: '원래 메시지', value: r.failure }] : []),
    ],
  };
}

// ── 레지스트리·기록 (G.3·G.6) ─────────────────────────────────────
export interface ToolEntryView {
  id: string;
  name: string;
  kind: InstallKind;
  version: string;
  command?: string;
  pricing: PricingView;
  license?: { id: string; plain: string };
  installedAt: string;
  origin: 'installed' | 'imported';
  purpose?: string;
}

export interface InstallLogRecordView {
  ts: string;
  action: PlanAction | 'import';
  plan: { name?: string; kind?: InstallKind; version?: string; action?: PlanAction } | null;
  gestureId?: string;
  result: { ok: boolean; status: string; message: string };
  output?: string;
  toolId?: string;
  jobId?: string;
}

const RESULT_PLAIN: Record<string, string> = {
  installed: '설치했어요',
  removed: '지웠어요',
  updated: '업데이트했어요',
  imported: '목록에 가져왔어요',
  failed: '실패했어요',
  'verify-failed': '설치했지만 확인에 실패했어요',
  cancelled: '취소했어요',
  timeout: '시간이 너무 걸려서 멈췄어요',
  cleaned: '정리했어요',
  'waiting-user': '사용자 확인을 기다렸어요',
};

/** G.6 기록 한 줄 → 쉬운 말 */
export function historyLine(r: InstallLogRecordView): { when: string; text: string; ok: boolean } {
  const name = r.plan?.name ?? r.toolId ?? '도구';
  const status = r.action === 'import' && r.result.ok ? 'imported' : r.result.status;
  const verb = RESULT_PLAIN[status] ?? '기록이 있어요';
  const d = new Date(r.ts);
  const when = Number.isNaN(d.getTime())
    ? r.ts
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return {
    when,
    text: `${quoted(name)}${r.plan?.kind ? ` (${KIND_LABEL[r.plan.kind]})` : ''} — ${verb}.`,
    ok: r.result.ok,
  };
}
