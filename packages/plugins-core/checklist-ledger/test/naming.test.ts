import { describe, expect, it } from 'vitest';
import { parseGlossary } from '../src/glossary.js';
import { canonicalizeSegment, splitWords, toCanonicalPath } from '../src/naming.js';

const g = parseGlossary({
  version: 1,
  terms: [
    { canonical: 'harness', aliases: ['하네스'] },
    { canonical: 'mobile', aliases: ['모바일'] },
    { canonical: 'agent', aliases: ['에이전트'] },
    { canonical: 'screen', aliases: ['화면'] },
    { canonical: 'login', aliases: ['로그인'] },
    { canonical: 'app', aliases: ['앱'] },
    { canonical: 'server', aliases: ['서버'] },
  ],
});

describe('22.2 이름 정책: 표시 이름 → 정식 경로', () => {
  it('하네스/모바일 → harness/mobile', () => {
    expect(toCanonicalPath('하네스/모바일', g)).toEqual({
      path: 'harness/mobile',
      partial: 'harness/mobile',
      unknown: [],
    });
  });

  it.each([
    ['하네스\\모바일', 'harness/mobile', 'dir'],
    ['하네스/모바일/', 'harness/mobile', 'dir'],
    ['모바일 앱', 'mobile-app', 'dir'],
    ['모바일앱', 'mobile-app', 'dir'],
    ['로그인 화면.kt', 'login-screen.kt', 'file'],
    ['하네스/모바일/LoginScreen.KT', 'harness/mobile/login-screen.kt', 'file'],
    ['MCP 서버', 'mcp-server', 'dir'],
    ['API서버', 'api-server', 'dir'],
    ['agent_builder', 'agent-builder', 'dir'],
    ['에이전트 Builder v2', 'agent-builder-v2', 'dir'],
    ['하네스/모바일'.normalize('NFD'), 'harness/mobile', 'dir'],
  ] as const)('%s → %s', (display, path, kind) => {
    expect(toCanonicalPath(display, g, { kind }).path).toBe(path);
  });

  it('glossary가 영문 직역보다 우선 (Agent → agent, 에이전트 → agent)', () => {
    expect(toCanonicalPath('Agent/에이전트', g).path).toBe('agent/agent');
  });

  it('미등록 한글 단어는 unknown, path는 null', () => {
    const r = toCanonicalPath('하네스/결제 화면/장바구니', g);
    expect(r.path).toBeNull();
    expect(r.unknown).toEqual(['결제', '장바구니']);
    expect(r.partial).toBe('harness/결제-screen/장바구니');
  });

  it('overrides로 영문 이름 확정', () => {
    expect(toCanonicalPath('하네스/결제 화면', g, { overrides: { 결제: 'Payment' } }).path).toBe(
      'harness/payment-screen',
    );
  });

  it('단어 분리·조각 변환', () => {
    expect(splitWords('LoginScreen_v2-모바일앱')).toEqual(['Login', 'Screen', 'v2', '모바일앱']);
    expect(canonicalizeSegment('모바일앱', g)).toEqual({ value: 'mobile-app', unknown: [] });
  });
});
