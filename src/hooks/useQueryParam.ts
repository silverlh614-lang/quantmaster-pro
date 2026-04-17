import { useCallback, useEffect, useState } from 'react';

/**
 * URL 쿼리 파라미터와 컴포넌트 state 를 양방향 동기화하는 훅.
 *
 * 이 프로젝트는 라우터 라이브러리를 사용하지 않으므로 브라우저 기본
 * History API (replaceState / popstate) 로 최소 구현한다.
 *
 * - 초기값은 URL 에서 읽으며, 값이 없으면 defaultValue 를 사용.
 * - allowed 를 지정하면 허용된 리터럴 값만 수용 (타입 안전 + 유효성 검증).
 * - set 은 pushState 가 아닌 replaceState 를 사용해 뒤로가기 기록에
 *   탭 전환이 누적되지 않도록 한다.
 * - 다른 창·다른 코드가 쿼리를 변경하는 경우(popstate)도 반영한다.
 */
export function useQueryParam<T extends string>(
  key: string,
  defaultValue: T,
  allowed?: readonly T[],
): [T, (next: T) => void] {
  const read = useCallback((): T => {
    if (typeof window === 'undefined') return defaultValue;
    const raw = new URLSearchParams(window.location.search).get(key);
    if (raw === null) return defaultValue;
    if (allowed && !allowed.includes(raw as T)) return defaultValue;
    return raw as T;
  }, [key, defaultValue, allowed]);

  const [value, setValue] = useState<T>(read);

  // popstate (뒤로/앞으로) 로 URL 이 바뀌면 state 도 재동기화.
  useEffect(() => {
    const onPop = () => setValue(read());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [read]);

  const update = useCallback((next: T) => {
    setValue(next);
    const url = new URL(window.location.href);
    if (next === defaultValue) {
      url.searchParams.delete(key);
    } else {
      url.searchParams.set(key, next);
    }
    // hash·pathname 은 그대로 두고 쿼리만 교체. replaceState 로 history 오염 방지.
    const newUrl = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(window.history.state, '', newUrl);
  }, [key, defaultValue]);

  return [value, update];
}
