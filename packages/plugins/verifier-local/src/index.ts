export * from './ollama.js';

/** 하네스 플러그인 진입점 (verifier 슬롯). 판정기 등록 API가 생기면 여기서 LocalVerifier를 등록한다 */
export function activate(ctx: { log(message: string): void }): void {
  ctx.log('verifier-local: Ollama JSON schema judge');
}
