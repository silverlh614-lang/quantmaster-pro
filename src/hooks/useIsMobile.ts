// @responsibility 뷰포트가 모바일(Tailwind sm 미만, <640px)인지 반응형 감지 — 리사이즈/회전 추적.
import { useEffect, useState } from 'react';

const MOBILE_QUERY = '(max-width: 639px)';

/** sm 브레이크포인트(640px) 미만이면 true. 초기값은 SSR 안전(window 부재 시 false). */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(MOBILE_QUERY).matches : false,
  );
  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return isMobile;
}
