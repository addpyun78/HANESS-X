/**
 * jsdom에는 레이아웃이 없으므로(모든 크기 0) 가상 스크롤 테스트용으로 크기를 흉내 낸다.
 * - .hx-chat__scroll: clientWidth/clientHeight = 뷰포트
 * - .hx-chat__row: offsetHeight = 행 높이
 */
export function mockChatLayout(
  opts: { viewport?: { width: number; height: number }; rowHeight?: number } = {},
) {
  const vp = opts.viewport ?? { width: 800, height: 600 };
  const row = opts.rowHeight ?? 40;
  const proto = HTMLElement.prototype;
  const saved = (['clientWidth', 'clientHeight', 'offsetHeight', 'offsetWidth', 'scrollHeight'] as const).map(
    (k) => [k, Object.getOwnPropertyDescriptor(proto, k)] as const,
  );
  const def = (k: string, f: (el: HTMLElement) => number) =>
    Object.defineProperty(proto, k, {
      configurable: true,
      get(this: HTMLElement) {
        return f(this);
      },
    });
  const isScroll = (el: HTMLElement) => el.classList.contains('hx-chat__scroll');
  const isRow = (el: HTMLElement) => el.classList.contains('hx-chat__row');
  def('clientWidth', (el) => (isScroll(el) ? vp.width : 0));
  def('clientHeight', (el) => (isScroll(el) ? vp.height : 0));
  def('offsetWidth', (el) => (isScroll(el) || isRow(el) ? vp.width : 0));
  def('offsetHeight', (el) => (isRow(el) ? row : isScroll(el) ? vp.height : 0));
  const contentH = (el: HTMLElement) =>
    parseFloat((el.firstElementChild as HTMLElement | null)?.style.height ?? '') || 0;
  def('scrollHeight', (el) => (isScroll(el) ? Math.max(contentH(el), vp.height) : 0));
  // scrollTop 저장 + scrollTo → scroll 이벤트
  const tops = new WeakMap<HTMLElement, number>();
  const savedTop = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
  const savedScrollTo = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTo');
  Object.defineProperty(proto, 'scrollTop', {
    configurable: true,
    get(this: HTMLElement) {
      return tops.get(this) ?? 0;
    },
    set(this: HTMLElement, v: number) {
      tops.set(this, v);
    },
  });
  Object.defineProperty(proto, 'scrollTo', {
    configurable: true,
    value(this: HTMLElement, o: ScrollToOptions) {
      if (o?.top === undefined) return;
      const max = Math.max(0, this.scrollHeight - this.clientHeight);
      const top = Math.min(max, Math.max(0, o.top));
      if (top === (tops.get(this) ?? 0)) return;
      tops.set(this, top);
      // 브라우저처럼 scroll 이벤트는 비동기로
      setTimeout(() => this.dispatchEvent(new Event('scroll')), 0);
    },
  });
  return () => {
    delete (proto as unknown as Record<string, unknown>).scrollTop;
    delete (proto as unknown as Record<string, unknown>).scrollTo;
    if (savedTop) Object.defineProperty(Element.prototype, 'scrollTop', savedTop);
    if (savedScrollTo) Object.defineProperty(Element.prototype, 'scrollTo', savedScrollTo);
    for (const [k, d] of saved) {
      if (d) Object.defineProperty(proto, k, d);
      else delete (proto as unknown as Record<string, unknown>)[k];
    }
  };
}
