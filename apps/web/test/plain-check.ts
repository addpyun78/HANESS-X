// H.6 쉬운 말 검사기 (@harness-x/approvals) — 패키지 index는 Node 전용 모듈(glossary 파일 경로)을 함께 싣기 때문에
// jsdom 테스트에서는 의존 없는 plain-korean 모듈만 직접 불러온다.
export {
  checkPlainKorean,
  checkPlainAll,
} from '../../../packages/plugins-core/approvals/src/plain-korean.js';
