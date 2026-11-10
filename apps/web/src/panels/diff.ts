/** 37.1 file_change 이벤트 → Diff 패널 모델 */

export type ChangeKind = 'create' | 'modify' | 'delete' | 'rename';

export interface FileDiff {
  path: string;
  change: ChangeKind;
  fromPath?: string;
  /** unified diff (없으면 내용 비교 불가 안내) */
  diff?: string;
  itemId?: string;
}

export interface DiffSides {
  original: string;
  modified: string;
}

/**
 * unified diff → 좌(원본)·우(수정) 텍스트.
 * 전체 파일이 없으므로 hunk 안의 줄만 복원한다(hunk 사이는 `⋯` 한 줄로 구분).
 * diff가 헤더 없는 순수 내용이면(생성 등) 그대로 수정본으로 본다.
 */
export function diffSides(diff: string, change: ChangeKind = 'modify'): DiffSides {
  const lines = diff.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  const hasHunk = lines.some((l) => l.startsWith('@@'));
  if (!hasHunk) {
    const text = lines.join('\n');
    return change === 'delete' ? { original: text, modified: '' } : { original: '', modified: text };
  }
  const original: string[] = [];
  const modified: string[] = [];
  let inHunk = false;
  let hunks = 0;
  for (const l of lines) {
    if (l.startsWith('@@')) {
      if (hunks++ > 0) {
        original.push('⋯');
        modified.push('⋯');
      }
      inHunk = true;
      continue;
    }
    if (!inHunk) continue; // diff --git / --- / +++ / index 헤더
    if (l.startsWith('\\')) continue; // \ No newline at end of file
    if (l.startsWith('+')) modified.push(l.slice(1));
    else if (l.startsWith('-')) original.push(l.slice(1));
    else {
      const body = l.startsWith(' ') ? l.slice(1) : l;
      original.push(body);
      modified.push(body);
    }
  }
  return { original: original.join('\n'), modified: modified.join('\n') };
}

const EXT_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  md: 'markdown',
  css: 'css',
  html: 'html',
  py: 'python',
  rs: 'rust',
  go: 'go',
  yaml: 'yaml',
  yml: 'yaml',
  sh: 'shell',
};

/** 경로 확장자 → Monaco 언어 id */
export function languageOf(path: string): string {
  const ext = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase();
  return (ext && EXT_LANG[ext]) || 'plaintext';
}
