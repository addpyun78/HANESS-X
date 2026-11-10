import { addAlias, loadDefaultGlossary } from '@harness-x/checklist-ledger';
import { describe, expect, it } from 'vitest';
import { aliasKey, pathsEqualL2 } from '../src/alias.js';
import { pathsEqualL1 } from '../src/normalize.js';

const glossary = loadDefaultGlossary();

describe('25.2 L2 별칭', () => {
  it('하네스/모바일 ≡ harness/mobile (L1에서는 다름)', () => {
    expect(pathsEqualL1('하네스/모바일', 'harness/mobile')).toBe(false);
    expect(pathsEqualL2('하네스/모바일', 'harness/mobile', { glossary })).toBe(true);
    expect(aliasKey('하네스/모바일', { glossary })).toBe('harness/mobile');
  });

  it.each([
    ['하네스/모바일/로그인화면.kt', 'harness/mobile/login-screen.kt'],
    ['하네스\\모바일앱', 'harness/mobile-app'],
    ['하네스/모바일'.normalize('NFD') + '/', 'Harness/Mobile'],
    ['harness/mobile/LoginScreen.kt', 'harness/mobile/login_screen.KT'],
    ['C:\\ws\\하네스\\모바일', '/mnt/c/ws/harness/mobile'],
  ])('%s ≡ %s', (a, b) => {
    expect(pathsEqualL2(a, b, { glossary })).toBe(true);
  });

  it.each([
    ['하네스/모바일', 'ai/mobile'],
    ['하네스/모바일', 'harness/web'],
    ['harness/mobile/a.kt', 'harness/mobile/a.java'],
  ])('%s ≢ %s', (a, b) => {
    expect(pathsEqualL2(a, b, { glossary })).toBe(false);
  });

  it('사전에 별칭을 추가하면(ai ⇄ harness) L2에서 동치', () => {
    const learned = addAlias(glossary, 'harness', 'ai');
    expect(pathsEqualL2('하네스/모바일', 'ai/mobile', { glossary: learned })).toBe(true);
  });
});
