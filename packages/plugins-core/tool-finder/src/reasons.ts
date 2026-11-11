import { checkPlainKorean } from '@harness-x/approvals';
import type { InstallKind } from '@harness-x/installer';
import type { ToolCandidate } from './candidate.js';

/**
 * P3-C.2 추천 이유(쉬운 말 1~2문장) + 아쉬운 점(1문장).
 * 모두 쉬운 말 검사(Part 1 H.6)를 통과해야 쓴다. 실패하면 템플릿 문장으로 대체한다.
 * AI가 준 장단점(pros·cons)이 있으면 먼저 검사해서 쓰고, 없거나 실패하면 후보 정보로 만든 문장을 쓴다.
 */

export const REASON_TEMPLATE = '이 일에 맞는 도구라서 골랐어요.';
export const CON_TEMPLATE = '쓰기 전에 설명을 한번 읽어 보세요.';

/** 설치 방법 쉬운 이름 (카드 "설치:" 줄) */
export const INSTALL_LABEL: Partial<Record<InstallKind, string>> = {
  winget: 'Windows 공식 앱 저장소',
  scoop: 'scoop 앱 저장소',
  choco: 'choco 앱 저장소',
  'npm-cli': 'npm 저장소',
  'python-cli': '파이썬 저장소',
  'ollama-model': 'Ollama 공식 모델 목록',
  'mcp-local': 'MCP 공식 목록',
  'mcp-remote': 'MCP 공식 목록',
  'vscode-ext': 'VS Code 공식 마켓',
  'docker-image': 'Docker 공식 목록',
  'direct-download': '공식 사이트에서 직접 받기',
};

export function installLabel(c: Pick<ToolCandidate, 'installMethods'>): string {
  const m = c.installMethods[0];
  return m ? (INSTALL_LABEL[m.kind] ?? m.label) : '공식 사이트에서 직접 받기';
}

export function isPlain(s: string): boolean {
  return checkPlainKorean(s).ok;
}

function reasonParts(c: ToolCandidate): string[] {
  const parts: string[] = [];
  const kind = c.installMethods[0]?.kind;
  if (kind === 'winget') parts.push('Windows 공식 앱 저장소에 있어서 설치·삭제가 쉬워요.');
  else if (kind === 'ollama-model') parts.push('내 컴퓨터에서 바로 돌릴 수 있어요.');
  else if (kind === 'mcp-local' || kind === 'mcp-remote') parts.push('AI가 바로 쓸 수 있게 연결돼요.');
  else if (kind === 'npm-cli' || kind === 'python-cli') parts.push('한 줄로 설치하고 지울 수 있어요.');
  if (c.pricing.tier === 'free') parts.push('무료로 쓸 수 있어요.');
  else if (c.pricing.tier === 'freemium') parts.push('기본 기능은 무료로 쓸 수 있어요.');
  else if (c.pricing.tier === 'trial') parts.push('먼저 무료로 써 볼 수 있어요.');
  if (parts.length === 0 && c.trust.level === '공식') parts.push('믿을 수 있는 곳에서 받아요.');
  if (parts.length === 0 && c.pricing.tier === 'paid') parts.push('이 일에 쓸 수 있는 유료 도구예요.');
  return parts.slice(0, 2);
}

function conPart(c: ToolCandidate): string {
  if (c.maintenance.archived) return '만든 곳에서 더 이상 고치지 않아요.';
  if (c.trust.level === '주의') return c.trust.reasons[0] ?? '조심해서 써야 해요.';
  if (c.pricing.tier === 'paid') return '돈을 내야 쓸 수 있어요.';
  if (c.pricing.tier === 'unknown') return '무료인지 직접 확인해야 해요.';
  if (c.pricing.tier === 'trial') return '체험 기간이 끝나면 돈을 내야 해요.';
  const kind = c.installMethods[0]?.kind;
  if (kind === 'npm-cli' || kind === 'python-cli' || kind === 'winget')
    return '화면 없이 명령으로만 쓸 수도 있어요.';
  if (c.installMethods.length === 0) return '설치는 직접 진행해야 해요.';
  return CON_TEMPLATE;
}

export interface CandidateReasons {
  reason: string;
  con: string;
  /** 템플릿으로 바꿨는가 */
  replaced: boolean;
}

export function reasonsFor(c: ToolCandidate): CandidateReasons {
  const pros = c.pros.filter(isPlain).slice(0, 2);
  // AI가 준 문장이 검사에서 떨어지면 대체한 것으로 표시
  let replaced = pros.length < Math.min(2, c.pros.length) || (c.cons.length > 0 && !c.cons.some(isPlain));
  let reason = (pros.length ? pros : reasonParts(c)).join(' ');
  if (!reason || !isPlain(reason)) {
    reason = REASON_TEMPLATE;
    replaced = true;
  }
  let con = c.cons.find(isPlain) ?? conPart(c);
  if (!isPlain(con)) {
    con = CON_TEMPLATE;
    replaced = true;
  }
  return { reason, con, replaced };
}
