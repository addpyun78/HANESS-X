export * from './messages.js';
export * from './zip.js';
export * from './detect.js';
export * from './limits.js';
export * from './store.js';

export function activate(ctx: { log(message: string): void }): void {
  ctx.log('attachments: 입력창 첨부 준비');
}
