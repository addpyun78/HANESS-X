import { useSyncExternalStore } from 'react';

/**
 * 아주 작은 해시 라우터: `#/builder/new` → '/builder/new'.
 * 해시를 쓰므로 하네스 서버·vite 어느 쪽에서도 새로고침해도 index.html이 그대로 뜬다.
 */
export function currentRoute(loc: Pick<Location, 'hash'> = location): string {
  const h = loc.hash.replace(/^#/, '');
  return h.startsWith('/') ? h : '/';
}

export function navigate(path: string): void {
  if (currentRoute() === path) return;
  location.hash = path;
}

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

export function useRoute(): string {
  return useSyncExternalStore(
    subscribe,
    () => currentRoute(),
    () => '/',
  );
}
