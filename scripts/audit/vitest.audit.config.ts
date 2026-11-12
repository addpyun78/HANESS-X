// T-102 점검 전용 vitest 설정: 기본 설정 + 처리 안 된 오류 기록기(C1.13). 기본 설정은 그대로 둔다.
import { mergeConfig } from 'vitest/config';
import base from '../../vitest.config.js';
export default mergeConfig(base, {
  test: { setupFiles: ['./scripts/audit/unhandled-setup.ts'] },
});
