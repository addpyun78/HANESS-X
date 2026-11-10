import { useMediaQuery } from './useMediaQuery.js';

/** 모바일 뷰포트: 좁은 화면 + 터치(굵은 포인터). 좁은 데스크톱 창은 해당하지 않는다 */
export const MOBILE_QUERY = '(max-width: 767.98px) and (pointer: coarse)';

const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile/i;

/**
 * 35.6 모바일(브라우저)·Tauri 모바일: 네이티브 폴더 대화상자가 없으므로 + 는 최근 프로젝트 목록만 연다.
 * (Tauri 모바일 웹뷰도 UA에 Android/iPhone이 들어 있다)
 */
export function useIsMobile(): boolean {
  const viewport = useMediaQuery(MOBILE_QUERY);
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  return viewport || MOBILE_UA.test(ua);
}
