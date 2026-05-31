// @responsibility 무거운 자식을 모달 오픈 애니메이션 이후로 지연 마운트 — 첫 페인트 부담 감소.
/**
 * children 을 delay(ms) 후 + 다음 애니메이션 프레임에 마운트한다. 모달 오픈 시 무거운 차트
 * (lightweight-charts/recharts)가 동기 마운트돼 열림이 끊기던 문제를 완화 — 헤더/점수는 즉시,
 * 차트는 애니메이션 직후 채워진다. 그 전엔 placeholder(스켈레톤) 노출.
 */
import { useEffect, useState, type ReactNode } from 'react';

export function DeferredMount({
  children,
  placeholder = null,
  delay = 220,
}: {
  children: ReactNode;
  placeholder?: ReactNode;
  delay?: number;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let raf = 0;
    const timer = setTimeout(() => {
      raf = requestAnimationFrame(() => setReady(true));
    }, delay);
    return () => {
      clearTimeout(timer);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [delay]);
  return <>{ready ? children : placeholder}</>;
}
