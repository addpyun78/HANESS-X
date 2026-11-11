// B.4 샘플 비교기 플러그인: 앞뒤 공백을 지우고 대소문자를 무시해 비교한다
const norm = (v) => String(v).trim().toLowerCase();

export const comparators = [
  {
    kind: 'case-insensitive',
    normalize: (v) => norm(v),
    equals(a, b) {
      return norm(a) === norm(b)
        ? { verdict: 'equal', level: 'normalize', confidence: 1, reason: '대소문자 무시 일치' }
        : { verdict: 'uncertain', level: 'normalize', confidence: 0, reason: '대소문자 무시해도 다름' };
    },
  },
];

export function activate() {}
