/**
 * @responsibility 계좌 MDD 기반 포지션 비중 자동 압축 — 손실 복구 수학을 코드로 강제
 *
 * 드로우다운이 깊을수록 매수 비중을 압축한다.
 * -30% 초과 시 신규 진입을 전면 차단하여 치명적 손실을 방어한다.
 */

// ─── 타입 ────────────────────────────────────────────────────────────────────

export interface DrawdownState {
  peakEquity: number;
  currentEquity: number;
}

export interface DrawdownResult {
  multiplier: number;
  drawdownPct: number;
  blocked: boolean;
  reason?: string;
}

// ─── 임계값 상수 ─────────────────────────────────────────────────────────────

const DRAWDOWN_THRESHOLDS = [
  { pct: -0.30, multiplier: 0.0, label: '계좌 MDD -30% — 신규 진입 전면 차단' },
  { pct: -0.25, multiplier: 0.5, label: '계좌 MDD -25% — 포지션 50% 축소' },
  { pct: -0.15, multiplier: 0.7, label: '계좌 MDD -15% — 포지션 30% 축소' },
  { pct: -0.10, multiplier: 0.85, label: '계좌 MDD -10% — 포지션 15% 축소' },
] as const;

// ─── 핵심 함수 ───────────────────────────────────────────────────────────────

/**
 * 현재 드로우다운 비율로 비중 배수를 계산한다.
 *
 * @param peakEquity    계좌 역대 최고값 (원)
 * @param currentEquity 현재 계좌 평가액 (원)
 */
export function getDrawdownMultiplier(
  peakEquity: number,
  currentEquity: number,
): DrawdownResult {
  if (peakEquity <= 0) {
    return { multiplier: 1.0, drawdownPct: 0, blocked: false };
  }

  const drawdownPct = (currentEquity - peakEquity) / peakEquity; // 음수

  for (const threshold of DRAWDOWN_THRESHOLDS) {
    if (drawdownPct <= threshold.pct) {
      return {
        multiplier: threshold.multiplier,
        drawdownPct,
        blocked: threshold.multiplier === 0,
        reason: threshold.label,
      };
    }
  }

  return { multiplier: 1.0, drawdownPct, blocked: false };
}

/**
 * DrawdownState 객체를 받아 결과를 반환하는 편의 함수.
 */
export function evaluateDrawdown(state: DrawdownState): DrawdownResult {
  return getDrawdownMultiplier(state.peakEquity, state.currentEquity);
}
