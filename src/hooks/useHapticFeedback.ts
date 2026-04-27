// @responsibility useHapticFeedback React hook
/**
 * useHapticFeedback — Vibration API 를 얇게 래핑한 햅틱 헬퍼.
 *
 *  - 지원하지 않는 브라우저·데스크톱에서는 no-op 으로 안전하게 떨어진다.
 *  - `prefers-reduced-motion: reduce` 시 자동 무음 (접근성).
 *  - 세 단계 프리셋: light (10ms) / medium (25ms) / heavy (50ms).
 */
import { useCallback } from 'react';

export type HapticPattern = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';

const PATTERNS: Record<HapticPattern, number | number[]> = {
  light: 10,
  medium: 25,
  heavy: 50,
  success: [15, 40, 15],
  warning: [30, 50, 30],
  error: [50, 80, 50],
};

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function vibrate(pattern: number | number[]): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  if (prefersReducedMotion()) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // 사용자 제스처 없이 호출되는 등 제한된 컨텍스트에서는 조용히 무시.
  }
}

export function useHapticFeedback() {
  return useCallback((pattern: HapticPattern = 'light'): void => {
    vibrate(PATTERNS[pattern]);
  }, []);
}

/** 컴포넌트 외부(이벤트 핸들러) 에서도 사용 가능한 직접 호출 헬퍼. */
export function haptic(pattern: HapticPattern = 'light'): void {
  vibrate(PATTERNS[pattern]);
}
