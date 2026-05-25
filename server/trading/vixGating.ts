// @responsibility vixGating 매매 엔진 모듈 — VIX 게이팅 제거됨 (stub only)

export interface VixGating {
  kellyMultiplier: number;
  noNewEntry:      boolean;
  reboundSignal:   boolean;
  reason:          string;
}

/**
 * VIX 게이팅이 제거되었습니다. 항상 정상 운용(no-block)을 반환합니다.
 */
export function getVixGating(
  _vix?: number | null,
  _vixHistory?: number[],
): VixGating {
  return {
    kellyMultiplier: 1.0,
    noNewEntry:      false,
    reboundSignal:   false,
    reason:          'VIX_GATING_REMOVED',
  };
}
