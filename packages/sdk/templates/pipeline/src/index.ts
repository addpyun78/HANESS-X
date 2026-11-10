/**
 * {{displayName}} — 파이프라인 플러그인
 * 파이프라인은 pipeline.yaml, 에이전트 메타(이름·아이콘·/명령)는 agent.yaml에 있다.
 * 하네스가 provides.pipeline을 보고 에이전트로 등록한다.
 */

export interface PluginContext {
  manifest: { id: string; version: string };
  log(message: string): void;
}

export const PIPELINE_ID = '{{id}}';
export const PIPELINE_FILE = 'pipeline.yaml';

export function activate(ctx: PluginContext): void {
  ctx.log(`pipeline ${PIPELINE_ID} available as /${PIPELINE_ID}`);
}

export function deactivate(): void {}
