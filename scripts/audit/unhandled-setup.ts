// T-102 C1.13 테스트 설정에서만 켜는 기록기: unhandledRejection·uncaughtException을 파일로 남긴다
// (원래 동작은 바꾸지 않는다 — 기존 리스너가 없으면 vitest가 하던 대로 보고됨)
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
const out = process.env.HX_AUDIT_UNHANDLED;
if (out) {
  mkdirSync(dirname(out), { recursive: true });
  const rec = (kind: string) => (err: unknown) => {
    const e = err as { name?: string; message?: string; stack?: string };
    appendFileSync(
      out,
      JSON.stringify({
        kind,
        ts: new Date().toISOString(),
        name: e?.name ?? typeof err,
        message: String(e?.message ?? err).slice(0, 300),
        stack: String(e?.stack ?? '')
          .split('\n')
          .slice(0, 6)
          .join('\n'),
        testPath:
          (globalThis as { __vitest_worker__?: { filepath?: string } }).__vitest_worker__?.filepath ?? null,
      }) + '\n',
    );
  };
  process.on('unhandledRejection', rec('unhandledRejection'));
  process.on('uncaughtExceptionMonitor', rec('uncaughtException'));
}
