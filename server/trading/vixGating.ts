/**
 * vixGating.ts — VIX 임계값 연동 포지션 게이팅
 *
 * ┌─ Kelly 배율 임계값 ─────────────────────────────────────────────────────────┐
 * │  VIX < 15      → Kelly ×1.00  (정상 운용)                                  │
 * │  VIX 15~20     → Kelly ×0.70  (소폭 축소)                                  │
 * │  VIX 20~25     → Kelly ×0.50  (반축소)                                     │
 * │  VIX 25~30     → Kelly ×0.30  (대폭 축소)                                  │
 * │  VIX > 30      → 신규 진입 중단 + 50% 현금화 권고                           │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ VIX 반등 신호 ─────────────────────────────────────────────────────────────┐
 * │  VIX > 30 이후 3거래일 연속 하락 → 리스크 온 전환 권고                      │
 * │  (vixHistory 최근 4개 필요: [피크, d+1, d+2, d+3])                         │
 * └─────────────────────────────────────────────────────────────────────────────┘
 */

export interface VixGating {
  kellyMultiplier: number;  // 0.0~1.0; VIX > 30이면 0 (진입 중단)
  noNewEntry:      boolean; // VIX > 30 시 true
  reboundSignal:   boolean; // VIX 반등 신호 감지
  reason:          string;
}

/**
 * VIX 반등 신호 감지.
 * history 배열 내에서 30 초과 지점이 있고,
 * 그 이후 마지막 3개 값이 연속 하락하는지 확인한다.
 */
function checkVixRebound(history: number[]): boolean {
  if (history.length < 4) return false;

  // 30 초과 지점 찾기 (전체 이력 중)
  const peakIdx = history.findIndex(v => v > 30);
  if (peakIdx < 0) return false;

  // 피크 이후 남은 값이 3개 이상인지 확인
  const afterPeak = history.slice(peakIdx + 1);
  if (afterPeak.length < 3) return false;

  // 마지막 3개가 연속 하락하는지 확인
  const last3 = afterPeak.slice(-3);
  return last3[0] > last3[1] && last3[1] > last3[2];
}

/**
 * 현재 VIX 수준과 이력을 바탕으로 포지션 게이팅을 결정한다.
 * signalScanner.ts의 Kelly 계산 전에 호출해 레짐 배율과 교차 적용한다.
 */
export function getVixGating(
  vix: number | null | undefined,
  vixHistory: number[] = [],
): VixGating {
  const rebound = checkVixRebound(vixHistory);

  if (vix === null || vix === undefined) {
    return {
      kellyMultiplier: 1.0,
      noNewEntry:      false,
      reboundSignal:   rebound,
      reason:          'VIX 데이터 없음 — 정상 운용',
    };
  }

  // VIX 반등 신호 활성 → 노멀 복귀 허용
  if (rebound) {
    return {
      kellyMultiplier: 0.70,  // 반등 초기 단계: 보수적 재진입
      noNewEntry:      false,
      reboundSignal:   true,
      reason:          `VIX ${vix.toFixed(1)} — 반등 신호 활성 (3일 연속 하락), 보수적 재진입 허용 (Kelly ×0.70)`,
    };
  }

  if (vix > 30) {
    return {
      kellyMultiplier: 0,
      noNewEntry:      true,
      reboundSignal:   false,
      reason:          `VIX ${vix.toFixed(1)} > 30 — 신규 진입 중단, 50% 현금화 권고`,
    };
  }
  if (vix >= 25) {
    return {
      kellyMultiplier: 0.30,
      noNewEntry:      false,
      reboundSignal:   false,
      reason:          `VIX ${vix.toFixed(1)} 25~30 — Kelly ×0.30 (대폭 축소)`,
    };
  }
  if (vix >= 20) {
    return {
      kellyMultiplier: 0.50,
      noNewEntry:      false,
      reboundSignal:   false,
      reason:          `VIX ${vix.toFixed(1)} 20~25 — Kelly ×0.50 (반축소)`,
    };
  }
  if (vix >= 15) {
    return {
      kellyMultiplier: 0.70,
      noNewEntry:      false,
      reboundSignal:   false,
      reason:          `VIX ${vix.toFixed(1)} 15~20 — Kelly ×0.70 (소폭 축소)`,
    };
  }
  return {
    kellyMultiplier: 1.0,
    noNewEntry:      false,
    reboundSignal:   false,
    reason:          `VIX ${vix.toFixed(1)} < 15 — 정상 운용`,
  };
}
