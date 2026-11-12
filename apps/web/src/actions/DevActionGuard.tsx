import { useEffect, useState } from 'react';
import { act, isActionId } from './registry.js';

/** 등록되지 않은 action을 찾는다 (없으면 undefined) */
export function unregisteredAction(target: EventTarget | null): string | undefined {
  const el = target instanceof Element ? target.closest('[data-action]') : null;
  const id = el?.getAttribute('data-action');
  return id && !isActionId(id) ? id : undefined;
}

/**
 * T-101 0C.3 개발 모드 경고: 레지스트리(registry.ts)에 없는 data-action이 눌리면
 * 콘솔 오류 + 화면 아래 빨간 개발 배너. main.tsx에서 개발 모드(import.meta.env.DEV)일 때만 붙인다.
 */
export function DevActionGuard() {
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const id = unregisteredAction(e.target);
      if (!id) return;
      console.error(
        `[HARNESS-X 개발 경고] 레지스트리에 없는 동작 "${id}"이 눌렸어요. apps/web/src/actions/registry.ts의 ACTIONS에 등록하세요.`,
      );
      setIds((xs) => (xs.includes(id) ? xs : [...xs, id]));
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);
  if (ids.length === 0) return null;
  return (
    <div
      role="alert"
      data-testid="dev-action-banner"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 2147483647,
        background: '#c62828',
        color: '#fff',
        padding: '8px 12px',
        font: '13px/1.4 sans-serif',
        display: 'flex',
        gap: 12,
        alignItems: 'center',
      }}
    >
      <span>
        개발 경고: 등록되지 않은 동작 {ids.map((x) => `"${x}"`).join(', ')}이 눌렸어요. registry.ts에
        등록하세요.
      </span>
      <button
        {...act('dev.dismiss-banner')}
        type="button"
        style={{ marginLeft: 'auto' }}
        onClick={() => setIds([])}
      >
        닫기
      </button>
    </div>
  );
}
