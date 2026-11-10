import { lazy, Suspense } from 'react';
import { App } from './App.js';
import { useRoute } from './router.js';

// 빌더(React Flow)는 무거우므로 따로 나눠 싣는다
const BuilderPage = lazy(() => import('./builder/BuilderPage.js').then((m) => ({ default: m.BuilderPage })));

/** 라우트: / → 메인(컨셉 A), /builder/* → 에이전트 만들기(컨셉 C) */
export function Routes() {
  const route = useRoute();
  if (route.startsWith('/builder'))
    return (
      <Suspense fallback={<p className="hx-builder__loading">빌더를 여는 중…</p>}>
        <BuilderPage route={route} />
      </Suspense>
    );
  return <App />;
}
