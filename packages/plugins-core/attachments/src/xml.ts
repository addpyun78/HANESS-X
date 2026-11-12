/** 아주 작은 XML 도우미 (오피스·HWPX 글 뽑기용 — 완전한 XML 파서가 아님) */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXmlText(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#')
      return String.fromCodePoint(
        e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10),
      );
    return ENTITIES[e] ?? m;
  });
}

/** <prefix:tag ...>안쪽</prefix:tag> 전부 (중첩 없는 태그용) */
export function innerAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
  return [...xml.matchAll(re)].map((m) => m[1]!);
}

/** 태그 안 글자만 이어 붙이기 (예: w:t, a:t, hp:t) */
export function textOf(xml: string, textTag: string): string {
  return innerAll(xml, textTag)
    .map((t) => decodeXmlText(t.replace(/<[^>]+>/g, '')))
    .join('');
}

export function attr(tagXml: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tagXml);
  return m ? decodeXmlText(m[1]!) : undefined;
}

/** 블록 단위 나누기: 여는 태그 위치들로 잘라 <tag>…</tag> 블록 (중첩 허용, 같은 태그 깊이 계산) */
export function blocks(xml: string, tag: string): string[] {
  const out: string[] = [];
  const open = new RegExp(`<${tag}(?=[\\s>/])`, 'g');
  const close = `</${tag}>`;
  let m: RegExpExecArray | null;
  while ((m = open.exec(xml))) {
    const start = m.index;
    const selfClose = xml.indexOf('>', start);
    if (xml[selfClose - 1] === '/') {
      out.push(xml.slice(start, selfClose + 1));
      continue;
    }
    let depth = 1;
    let i = selfClose + 1;
    const inner = new RegExp(`<${tag}(?=[\\s>/])|</${tag}>`, 'g');
    inner.lastIndex = i;
    let n: RegExpExecArray | null;
    while (depth > 0 && (n = inner.exec(xml))) {
      if (n[0] === close) depth--;
      else if (xml[xml.indexOf('>', n.index) - 1] !== '/') depth++;
      i = n.index + n[0].length;
    }
    out.push(xml.slice(start, i));
    open.lastIndex = i;
  }
  return out;
}
