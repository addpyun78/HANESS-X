import { useMemo } from 'react';
import { diffSides, languageOf, type FileDiff } from './diff.js';
import { MonacoDiff } from './MonacoDiff.js';
import './panels.css';

const CHANGE_LABEL = { create: '생성', modify: '수정', delete: '삭제', rename: '이름 변경' } as const;

export interface DiffPanelProps {
  file?: FileDiff;
}

/** 37.1 Diff 패널 — 채팅의 파일 변경 카드에서 "Diff 열기"를 누르면 이 패널에 열린다 */
export function DiffPanel({ file }: DiffPanelProps) {
  const sides = useMemo(
    () => (file?.diff ? diffSides(file.diff, file.change) : undefined),
    [file?.diff, file?.change],
  );
  if (!file) return <p className="hx-panel-empty">파일 변경 카드에서 Diff 열기를 누르세요</p>;
  return (
    <section className="hx-diff-panel" aria-label={`Diff: ${file.path}`} data-path={file.path}>
      <header className="hx-diff-panel__head">
        <span className={`hx-change hx-change--${file.change}`}>{CHANGE_LABEL[file.change]}</span>
        <span className="hx-mono hx-diff-panel__path" title={file.path}>
          {file.fromPath ? `${file.fromPath} → ${file.path}` : file.path}
        </span>
      </header>
      {sides ? (
        <MonacoDiff {...sides} language={languageOf(file.path)} />
      ) : (
        <p className="hx-panel-empty">이 변경에는 diff 내용이 없습니다</p>
      )}
    </section>
  );
}
