/**
 * Server-Sent Events 파서 (text/event-stream)
 * 청크 경계가 줄·UTF-8 문자 중간에 걸려도 올바르게 이어 붙인다.
 */

export interface SseMessage {
  event?: string;
  data: string;
  id?: string;
}

export async function* parseSse(
  body: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>,
): AsyncGenerator<SseMessage> {
  const decoder = new TextDecoder();
  let buf = '';
  let data: string[] = [];
  let event: string | undefined;
  let id: string | undefined;

  const flush = (): SseMessage | undefined => {
    if (!data.length) {
      event = undefined;
      return undefined;
    }
    const msg: SseMessage = { data: data.join('\n') };
    if (event !== undefined) msg.event = event;
    if (id !== undefined) msg.id = id;
    data = [];
    event = undefined;
    return msg;
  };

  const line = (l: string): SseMessage | undefined => {
    if (l === '') return flush();
    if (l.startsWith(':')) return undefined;
    const i = l.indexOf(':');
    const field = i < 0 ? l : l.slice(0, i);
    let value = i < 0 ? '' : l.slice(i + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') data.push(value);
    else if (field === 'event') event = value;
    else if (field === 'id') id = value;
    return undefined;
  };

  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.search(/\r\n|\r|\n/)) >= 0) {
      // \r 이 청크 끝이면 다음 \n 을 기다린다
      if (buf[nl] === '\r' && nl === buf.length - 1) break;
      const l = buf.slice(0, nl);
      buf = buf.slice(nl + (buf.startsWith('\r\n', nl) ? 2 : 1));
      const m = line(l);
      if (m) yield m;
    }
  }
  buf += decoder.decode();
  if (buf) {
    const m = line(buf.replace(/\r$/, ''));
    if (m) yield m;
  }
  const last = flush();
  if (last) yield last;
}
