// @responsibility usePolledFetch React hook
/**
 * usePolledFetch — "초기 1회 로드 + 장중·가시 상태일 때만 주기 폴링" 패턴을
 *                  재사용 가능한 primitive 로 추상화한 훅.
 *
 * 자동매매 대시보드의 거의 모든 위젯이 동일한 폴링 규칙을 쓰므로, 각 위젯이
 * setInterval · visibilitychange 리스너를 중복 구현하지 않도록 통합한다.
 */

import { useEffect, useRef } from 'react';
import { isMarketOpen } from '../utils/marketTime';

export interface PolledFetchOptions {
  /** 폴링 주기 (ms). 기본 60_000. */
  intervalMs?: number;
  /**
   * true 면 장외/휴일/백그라운드에서도 폴링을 계속한다.
   * 기본 false — 장중 + 문서 visible 일 때만 tick 시 재호출.
   */
  alwaysPoll?: boolean;
  /** 초기 1회 로드 스킵 여부. 기본 false (즉시 1회 실행). */
  skipInitial?: boolean;
}

/**
 * `fetcher` 는 매 호출 시 최신 클로저가 쓰이도록 ref 로 고정한다.
 * 호출부는 의존성 배열을 걱정할 필요 없이 일반 함수를 넘기면 된다.
 */
export function usePolledFetch(
  fetcher: () => void | Promise<void>,
  opts: PolledFetchOptions = {},
): void {
  const { intervalMs = 60_000, alwaysPoll = false, skipInitial = false } = opts;

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    const run = () => {
      try { void fetcherRef.current(); } catch { /* swallow — 각 fetcher 가 자체 에러 처리 */ }
    };

    if (!skipInitial) run();

    const tick = () => {
      if (alwaysPoll) { run(); return; }
      if (document.visibilityState !== 'visible') return;
      if (!isMarketOpen()) return;
      run();
    };
    const interval = setInterval(tick, intervalMs);

    const onVisibility = () => {
      if (alwaysPoll) {
        if (document.visibilityState === 'visible') run();
        return;
      }
      if (document.visibilityState === 'visible' && isMarketOpen()) run();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs, alwaysPoll, skipInitial]);
}
