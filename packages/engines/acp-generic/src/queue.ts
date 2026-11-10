/** 밀어 넣기(push) → 비동기 반복(pull) 큐. close() 후 남은 항목을 다 내보내고 끝난다 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly buf: T[] = [];
  private closed = false;
  private wake: (() => void) | undefined;

  push(v: T): void {
    if (this.closed) return;
    this.buf.push(v);
    this.notify();
  }

  close(): void {
    this.closed = true;
    this.notify();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  private notify(): void {
    const w = this.wake;
    this.wake = undefined;
    w?.();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    for (;;) {
      const next = this.buf.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      if (this.closed) return;
      await new Promise<void>((r) => (this.wake = r));
    }
  }
}
