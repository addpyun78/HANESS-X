import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import type { InstallPlan, PricingTier } from './plan.js';
import type { ToolEntry } from './registry.js';
import { toolsDir } from './registry.js';
import { InstallService, type InstallJob } from './service.js';

/**
 * T-100 P2-G.7 화면 없이 같은 흐름: 계획을 글로 보여 주고 → y/n 승인 → 실행.
 *   harness-x install <이름|주소>     찾기(또는 주소 해석) → 계획 → y/n → 설치
 *   harness-x tools list              도구 목록 (레지스트리)
 *   harness-x tools allow <도구 id>   새 도구 첫 실행을 앞으로 허락 (P2-F.6 기억 파일)
 * y 입력이 사람 승인이다 (화면의 클릭 토큰과 같은 역할 — 기록에는 cli-… 승인 id가 남는다).
 */

export interface InstallCliIo {
  input: Readable;
  output: Writable;
  /** 테스트·주입용 서비스 (없으면 harnessHome 기준으로 만들고 설치 도구를 감지한다) */
  service?: InstallService;
  home?: string;
}

export const PRICING_LABEL: Record<PricingTier, string> = {
  free: '무료',
  freemium: '무료+유료 기능',
  trial: '체험판',
  paid: '유료',
  unknown: '무료인지 확인 못 했어요',
};

const ACTION_Q: Record<InstallPlan['action'], string> = {
  install: '설치할까요?',
  uninstall: '지울까요?',
  update: '업데이트할까요?',
  rollback: '정리할까요?',
};

const HELP = `사용법:
  harness-x install <이름|주소>     계획을 보여 주고 y/n으로 설치
  harness-x tools list              설치된 도구 목록
  harness-x tools allow <도구 id>   새 도구 첫 실행을 앞으로 허락
`;

/** 계획 → 글 (웹 카드와 같은 항목) */
export function formatPlanText(p: InstallPlan): string {
  const size =
    p.sizeMB !== null
      ? `약 ${Math.round(p.sizeMB)}MB` +
        (p.etaSec !== null ? `, ${Math.max(1, Math.round(p.etaSec / 60))}분 정도` : '')
      : '아직 몰라요';
  const lines = [
    `📦 ${ACTION_Q[p.action].replace('할까요?', '해도 될까요?')}`,
    `  ${p.name}${p.version ? ` ${p.version}` : ''}  [${PRICING_LABEL[p.pricing.tier]}]`,
    `  무료인가요?    ${p.pricing.note || PRICING_LABEL[p.pricing.tier]}`,
    `  사용 조건      ${p.license.plain}`,
    `  어디서 받나요? ${p.source.publisher ? `${p.source.publisher} · ` : ''}${p.source.url || p.kind}`,
    `  크기·시간      ${size}`,
    `  관리자 권한    ${p.kind === 'wsl-apt' ? '관리자 비밀번호가 필요해요(터미널에서 직접 입력)' : p.needsAdmin ? 'Windows가 허락을 물어볼 거예요(예 누르기)' : '필요 없어요'}`,
    ...(p.changes.length ? [`  바뀌는 것      ${p.changes.join(' ')}`] : []),
    ...(p.risks.length ? [`  조심할 점      ${p.risks.join(' ')}`] : []),
    ...(p.pricing.tier === 'paid' || p.pricing.tier === 'trial'
      ? [
          `  가격 안내      하네스는 결제를 하지 않아요.${p.pricing.sourceUrl ? ` 공식 구매 페이지: ${p.pricing.sourceUrl}` : ''}`,
        ]
      : []),
    `  실행할 명령    ${p.commands.join(' && ') || '(없음)'}`,
  ];
  return lines.join('\n');
}

export function formatToolLine(t: ToolEntry): string {
  return `${t.name}  [${PRICING_LABEL[t.pricing.tier]}]  ${t.kind}  ${t.version || '-'}  ${t.id}${t.origin === 'imported' ? '  (이미 있던 도구)' : ''}`;
}

/** 줄 하나씩 읽는 질문기 (같은 입력 스트림을 여러 번 묻는다) */
function asker(io: InstallCliIo) {
  const rl = createInterface({ input: io.input, terminal: false });
  const queue: string[] = [];
  const waiting: ((l: string | undefined) => void)[] = [];
  let closed = false;
  rl.on('line', (l) => {
    const w = waiting.shift();
    if (w) w(l);
    else queue.push(l);
  });
  rl.on('close', () => {
    closed = true;
    for (const w of waiting.splice(0)) w(undefined);
  });
  return {
    ask(q: string): Promise<string | undefined> {
      io.output.write(q);
      if (queue.length) return Promise.resolve(queue.shift());
      if (closed) return Promise.resolve(undefined);
      return new Promise((res) => waiting.push(res));
    },
    close: () => rl.close(),
  };
}

const yes = (a: string | undefined) => !!a && /^(y|yes|예|네|ㅇ)$/i.test(a.trim());
const looksLikeUrl = (s: string) => /^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^(www\.|github\.com\/)/i.test(s);

export function allowedFile(home: string): string {
  return join(toolsDir(home), 'allowed.json');
}

/** P2-F.6 기억 파일에 추가 (permission-gate ToolFirstRunGate와 같은 형식) */
export function allowTool(home: string, toolId: string): string[] {
  const f = allowedFile(home);
  let allowed: string[] = [];
  if (existsSync(f))
    try {
      allowed = (JSON.parse(readFileSync(f, 'utf8')) as { allowed?: string[] }).allowed ?? [];
    } catch {
      allowed = [];
    }
  const next = [...new Set([...allowed, toolId])].sort();
  mkdirSync(dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ version: 1, allowed: next }, null, 2) + '\n');
  renameSync(tmp, f);
  return next;
}

async function pickPlan(svc: InstallService, what: string, out: Writable): Promise<InstallPlan | undefined> {
  let cand;
  if (looksLikeUrl(what)) {
    const r = await svc.resolve(what);
    if (r.failure || !r.candidates.length) {
      out.write(
        `이 주소에서 설치 방법을 찾지 못했어요.\n  이유: ${r.failure ?? '설치할 수 있는 것을 찾지 못했어요.'}\n  주소를 열어 직접 확인해 주세요: ${what}\n`,
      );
      return undefined;
    }
    if (r.candidates.length > 1) {
      out.write('설치 방법 후보:\n');
      r.candidates.forEach((c, i) =>
        out.write(`  ${i + 1}) ${c.label} (${c.kind})${c === r.recommended ? ' ⭐ 추천' : ''}\n`),
      );
      if (r.reason) out.write(`  추천 이유: ${r.reason}\n`);
    }
    cand = r.recommended ?? r.candidates[0];
  } else {
    const r = await svc.search(what);
    if (!r.candidates.length) {
      out.write(`"${what}"을(를) 찾지 못했어요. 이름을 확인하거나 주소로 설치해 보세요.\n`);
      return undefined;
    }
    cand = r.candidates[0];
  }
  const p = await svc.plan({ kind: cand!.kind, target: cand!.target });
  if ('unavailable' in p) {
    out.write(`${p.missing.join(', ')}이(가) 없어서 이 방법으로는 설치할 수 없어요.\n`);
    if (p.bootstrap)
      out.write(`먼저 ${p.bootstrap.name}을(를) 설치해 주세요: harness-x install ${p.bootstrap.target}\n`);
    return undefined;
  }
  return p;
}

export async function installCli(argv: string[], io: InstallCliIo): Promise<number> {
  const out = io.output;
  const [cmd, sub, ...rest] = argv;
  if (!cmd || cmd === '-h' || cmd === '--help' || (cmd === 'install' && !sub) || (cmd === 'tools' && !sub)) {
    out.write(HELP);
    return cmd ? 1 : 0;
  }
  let svc = io.service;
  if (!svc) {
    svc = new InstallService(io.home ? { home: io.home } : {});
    if (cmd === 'install') await svc.detect();
  }

  if (cmd === 'tools') {
    if (sub === 'list') {
      const { tools } = svc.tools();
      if (!tools.length)
        out.write('아직 설치한 도구가 없어요. harness-x install <이름>으로 설치해 보세요.\n');
      else
        out.write(
          `도구 ${tools.length}개 (${svc.registry.file})\n${tools.map((t) => `  ${formatToolLine(t)}`).join('\n')}\n`,
        );
      return 0;
    }
    if (sub === 'allow' && rest[0]) {
      if (!svc.registry.get(rest[0])) {
        out.write(`도구 목록에 없는 id예요: ${rest[0]}\n`);
        return 1;
      }
      allowTool(svc.home, rest[0]);
      out.write(`앞으로 ${rest[0]}은(는) 묻지 않고 실행해요.\n`);
      return 0;
    }
    out.write(HELP);
    return 1;
  }

  if (cmd !== 'install') {
    out.write(HELP);
    return 1;
  }
  const q = asker(io);
  try {
    const plan = await pickPlan(svc, [sub, ...rest].join(' '), out);
    if (!plan) return 1;
    out.write(formatPlanText(plan) + '\n');
    if (plan.pricing.tier === 'unknown' && !yes(await q.ask('무료인지 직접 확인했어요? (y/n) '))) {
      out.write('무료인지 확인한 뒤에 다시 해 주세요. 아무것도 설치하지 않았어요.\n');
      return 1;
    }
    if (!yes(await q.ask(`${ACTION_Q[plan.action]} (y/n) `))) {
      out.write('취소했어요. 아무것도 설치하지 않았어요.\n');
      return 1;
    }
    const off = svc.onOutput((ev) => out.write(ev.data));
    let job: InstallJob;
    try {
      job = await svc.execute(plan.id, { gestureId: `cli-${randomUUID()}` }).done;
    } finally {
      off();
    }
    const ok = job.status === 'installed' || job.status === 'removed' || job.status === 'waiting-user';
    out.write(
      ok
        ? `${job.message ?? '끝났어요.'}\n`
        : `${job.failure?.title ?? '설치하지 못했어요.'} ${job.failure?.message ?? job.message ?? ''}\n`,
    );
    return ok ? 0 : 1;
  } finally {
    q.close();
  }
}
