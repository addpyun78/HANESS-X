import { describe, expect, it } from 'vitest';
import { findVerbs, lintItem, type LintItem } from '../src/lint.js';

const base = (title: string): LintItem => ({
  id: '1',
  title,
  artifactId: 'art.login',
  acceptance: [{ type: 'test' }],
});
const r1 = (title: string) => lintItem(base(title)).filter((v) => v.rule === 'R1');

describe('21.1 R1 단일 동사', () => {
  it('"만들고 테스트" 거부', () => {
    const v = r1('로그인 화면 만들고 테스트');
    expect(v).toHaveLength(1);
    expect(v[0]!.detail).toMatchObject({ conjunctions: ['만들고'] });
    expect(v[0]!.detail?.verbs).toEqual(expect.arrayContaining(['테스트', '만들']));
  });

  it.each([
    '로그인 화면 작성하고 테스트 추가',
    '로그인 및 로그아웃 추가',
    'API 구현 그리고 문서화',
    '스키마 정의한 뒤 마이그레이션 적용',
    'Add login screen and write tests',
    'Implement parser then refactor lexer',
    '로그인 화면 작성, 테스트 추가',
    'Create schema; deploy server',
    '파서 고치고 린트 돌리기',
  ])('거부: %s', (title) => {
    expect(r1(title)).toHaveLength(1);
  });

  it.each([
    '로그인 화면 작성',
    '로그인 테스트 작성',
    'checklist.json 저장',
    'Add login screen',
    '상태 전이표 구현',
    '모바일 앱 빌드 스크립트',
    'glossary.json 기본값 추가',
  ])('통과: %s', (title) => {
    expect(r1(title)).toEqual([]);
  });

  it('동사 사전 감지', () => {
    expect(findVerbs('로그인 화면 작성')).toEqual(['작성']);
    expect(findVerbs('Write tests')).toEqual(['write', 'test']);
    expect(findVerbs('설정 화면 배포하기')).toEqual(['배포', '설정']);
  });
});
