import { describe, expect, it } from 'vitest';
import { BANNED_WORDS, checkPlainKorean } from '../src/plain-korean.js';

describe('H.6 쉬운 말 검사기', () => {
  it('금지어 40개 이상 (diff, regex, 정규화, 스키마, glossary, manifest, JSON, 해시, NFC, 커밋, 브랜치 포함)', () => {
    expect(BANNED_WORDS.length).toBeGreaterThanOrEqual(40);
    for (const w of [
      'diff',
      'regex',
      '정규화',
      '스키마',
      'glossary',
      'manifest',
      'JSON',
      '해시',
      'NFC',
      '커밋',
      '브랜치',
    ])
      expect(BANNED_WORDS).toContain(w);
  });

  const SAMPLES: [string, string, string][] = [
    ['커밋을 되돌렸어요.', 'banned-word', '한국어 금지어'],
    ['diff를 확인해 주세요.', 'banned-word', '영어 금지어 + 조사'],
    ['정규화한 결과가 서로 달라요.', 'banned-word', '정규화'],
    ['JSON 키 순서가 달라서 확인이 필요해요.', 'banned-word', 'JSON'],
    ['브랜치를 바꿔도 될까요?', 'banned-word', '브랜치'],
    ['파일을 새로 만들었다.', 'honorific', '반말 끝맺음'],
    ['폴더 위치를 확인함', 'honorific', '명사형 끝맺음'],
    [
      '계획한 폴더와 실제로 만든 폴더의 이름이 서로 다르지만 안에 든 내용은 거의 같아 보여서 확인이 필요해요.',
      'sentence-length',
      '45자 넘는 문장',
    ],
    ['The output folder is different 요.', 'english-ratio', '영어 비율'],
    ['Please check this result 해 주세요.', 'english-ratio', '영어 비율 2'],
  ];

  it.each(SAMPLES)('위반 샘플 검출: %s', (text, rule) => {
    const r = checkPlainKorean(text);
    expect(r.ok).toBe(false);
    expect(r.violations.map((v) => v.rule)).toContain(rule);
  });

  it('위반 샘플 10개 전부 검출', () => {
    expect(SAMPLES).toHaveLength(10);
    expect(SAMPLES.filter(([t]) => !checkPlainKorean(t).ok)).toHaveLength(10);
  });

  it.each([
    '계획에는 "하네스/모바일" 폴더에 만들기로 했어요. 그런데 AI가 "ai/mobile" 폴더에 만들었어요.',
    '두 이름이 같은 폴더를 뜻하는지 확실하지 않아요.',
    '안에 든 파일과 테스트 결과가 같아요.',
    'src/index.ts 파일과 apps/web 폴더를 확인했어요.',
    '이 부분은 멈춰 두고 나머지를 먼저 진행할게요.',
    '다음부터 묻지 않도록 사전에 넣을지 정해 주세요.',
    '이번 작업에서 AI에게 물어볼 수 있는 횟수를 다 썼어요. (확신 정도: 알 수 없음)',
  ])('통과: %s', (t) => {
    expect(checkPlainKorean(t)).toEqual({ ok: true, violations: [] });
  });

  it('버튼 문구(label)는 존댓말 검사를 하지 않는다', () => {
    expect(checkPlainKorean('같은 걸로 인정', { label: true }).ok).toBe(true);
    expect(checkPlainKorean('같은 걸로 인정').ok).toBe(false);
  });
});
