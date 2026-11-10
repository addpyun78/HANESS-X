export * from './client.js';

/** 하네스 플러그인 진입점 (verifier 슬롯). 판정기 등록 API가 생기면 여기서 JevClient를 등록한다 */
export function activate(ctx: { log(message: string): void }): void {
  ctx.log('verifier-jev: model jev-1.13.0');
}
