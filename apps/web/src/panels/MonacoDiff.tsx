import { useEffect, useRef, useState } from 'react';
import type { DiffSides } from './diff.js';

export interface MonacoDiffProps extends DiffSides {
  language: string;
}

type MonacoApi = typeof import('monaco-editor');

let monacoPromise: Promise<MonacoApi> | undefined;
/** monaco-editor 번들은 크므로 Diff를 처음 열 때만 불러온다 (CDN 사용 안 함, 로컬 번들) */
function loadMonaco(): Promise<MonacoApi> {
  monacoPromise ??= import('monaco-editor');
  return monacoPromise;
}

function currentTheme(): 'vs' | 'vs-dark' {
  const forced = document.documentElement.dataset.theme;
  if (forced === 'dark') return 'vs-dark';
  if (forced === 'light') return 'vs';
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'vs-dark' : 'vs';
}

/** Monaco diff 편집기 (읽기 전용, 좌: 원본 / 우: 수정) */
export function MonacoDiff({ original, modified, language }: MonacoDiffProps) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    loadMonaco()
      .then((monaco) => {
        if (disposed || !host.current) return;
        const editor = monaco.editor.createDiffEditor(host.current, {
          readOnly: true,
          automaticLayout: true,
          renderSideBySide: true,
          minimap: { enabled: false },
          theme: currentTheme(),
        });
        const a = monaco.editor.createModel(original, language);
        const b = monaco.editor.createModel(modified, language);
        editor.setModel({ original: a, modified: b });
        cleanup = () => {
          editor.dispose();
          a.dispose();
          b.dispose();
        };
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [original, modified, language]);

  if (error) return <p role="alert">Diff 편집기를 불러오지 못했습니다: {error}</p>;
  return <div ref={host} className="hx-diff-editor" data-testid="monaco-diff" />;
}
