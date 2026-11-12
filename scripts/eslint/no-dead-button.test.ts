import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — 순수 JS 규칙 모듈
import { hxPlugin } from './no-dead-button.js';

function lint(code: string, requireAction = false) {
  const linter = new Linter({ configType: 'flat' });
  return linter
    .verify(
      code,
      [
        {
          files: ['**/*.tsx'],
          languageOptions: {
            parser: tseslint.parser,
            parserOptions: { ecmaFeatures: { jsx: true } },
          },
          plugins: { hx: hxPlugin },
          rules: { 'hx/no-dead-button': ['error', { requireAction }] },
        },
      ],
      'sample.tsx',
    )
    .map((m) => m.messageId);
}

describe('T-101 0C.2 hx/no-dead-button', () => {
  it('위반 샘플 3개를 찾는다 (처리 없는 버튼 · 처리 없는 메뉴 항목 · 이유 없는 비활성 버튼)', () => {
    const bad = [
      `const A = () => <button type="button" className="x">저장</button>;`,
      `const B = () => <div role="menuitem">설정</div>;`,
      `const C = ({ busy, go }: { busy: boolean; go: () => void }) => <button type="button" disabled={busy} onClick={go}>보내기</button>;`,
    ];
    expect(bad.map((c) => lint(c))).toEqual([['noHandler'], ['noHandler'], ['disabledNoReason']]);
    // 링크인데 href·onClick 둘 다 없음
    expect(lint(`const D = () => <a className="x" role="button">열기</a>;`)).toEqual(['noHandler']);
  });

  it('정상: onClick · href · submit · 이유 있는 비활성 · 항상 비활성 + 준비 중 · 알 수 없는 펼침', () => {
    const good = [
      `const A = ({ f }: { f: () => void }) => <button type="button" onClick={f}>저장</button>;`,
      `const B = () => <a href="https://example.com">안내</a>;`,
      `const C = () => <form><button type="submit">찾기</button></form>;`,
      `const D = ({ b, f }: { b: boolean; f: () => void }) => <button type="button" disabled={b} title={b ? '먼저 내용을 적어 주세요' : undefined} onClick={f}>보내기</button>;`,
      `const E = () => <button type="button" disabled title="준비 중이에요">스킬</button>;`,
      `const F = (p: object) => <button {...p} />;`,
      `const G = () => <span role="status">상태</span>;`,
    ];
    for (const c of good) expect(lint(c)).toEqual([]);
  });

  it('requireAction: data-action 또는 {...act(id)}가 없으면 알린다', () => {
    expect(
      lint(`const A = ({ f }: { f: () => void }) => <button type="button" onClick={f}>x</button>;`, true),
    ).toEqual(['noAction']);
    expect(
      lint(
        `const A = ({ f }: { f: () => void }) => <button {...act('composer.send')} type="button" onClick={f}>x</button>;`,
        true,
      ),
    ).toEqual([]);
    expect(
      lint(
        `const A = ({ f }: { f: () => void }) => <button data-action="composer.send" type="button" onClick={f}>x</button>;`,
        true,
      ),
    ).toEqual([]);
  });
});
