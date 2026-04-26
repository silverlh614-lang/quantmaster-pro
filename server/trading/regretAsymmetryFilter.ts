// @responsibility regretAsymmetryFilter 매매 엔진 모듈
/**
 * regretAsymmetryFilter.ts — Regret Asymmetry Filter (후회 비대칭 필터)
 *
 * "놓친 기회보다 잘못된 진입이 더 나쁘다" 원칙의 코드화.
 *
 * FOMO(기회 손실 공포)로 인한 단기 급등 종목 추격 매수를 시스템 차원에서 차단한다.
 *
 * ┌─ 쿨다운 진입 조건 ────────────────────────────────────────────────────────────┐
 * │  Gate 1~3 통과 후 직전 5거래일 상승률 > +15%                                 │
 * │  → cooldown_48h 상태로 진입 보류 (48시간 후 기술적 재평가)                   │
 * └───────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ 쿨다운 해제 조건 ────────────────────────────────────────────────────────────┐
 * │  현재가가 쿨다운 시점 고점(recentHigh) 대비 -5% ~ -8% 되돌림                 │
 * │  → 기술적 조정 완료 신호로 판단, 쿨다운 해제                                 │
 * └───────────────────────────────────────────────────────────────────────────────┘
 */

/** 5거래일 급등 임계값 (%) */
export const FOMO_SURGE_THRESHOLD_PCT = 15;

/** 쿨다운 지속 시간 (ms) — 48시간 */
export const COOLDOWN_DURATION_MS = 48 * 60 * 60 * 1000;

/** 되돌림 해제 하한 (%) — 고점 대비 최소 -5% 하락 */
export const PULLBACK_RELEASE_MIN_PCT = 5;

/** 되돌림 해제 상한 (%) — 고점 대비 최대 -8% 하락까지만 유효 (그 이하는 과도한 하락) */
export const PULLBACK_RELEASE_MAX_PCT = 8;

export interface RegretAsymmetryResult {
  /** 현재 쿨다운 상태 여부 */
  isCooldown: boolean;
  /** 쿨다운 사유 */
  reason: string;
  /** 쿨다운 종료 시각 (ISO) — 쿨다운 중일 때만 설정 */
  cooldownUntil?: string;
  /** 고점 기록 (쿨다운 진입 시 현재가) */
  recentHigh?: number;
}

/**
 * 워치리스트 등록 시점에 5거래일 급등 여부를 평가하여 쿨다운 여부를 결정한다.
 *
 * @param return5d - 직전 5거래일 수익률 (%)
 * @param currentPrice - 현재가 (쿨다운 진입 시 고점 기록용)
 * @param now - 현재 시각 (테스트 주입용, 기본값: new Date())
 */
export function evaluateRegretAsymmetry(
  return5d: number,
  currentPrice: number,
  now: Date = new Date(),
): RegretAsymmetryResult {
  if (return5d > FOMO_SURGE_THRESHOLD_PCT) {
    const cooldownUntil = new Date(now.getTime() + COOLDOWN_DURATION_MS).toISOString();
    return {
      isCooldown:    true,
      reason:        `직전 5거래일 +${return5d.toFixed(1)}% 급등 — FOMO 추격 차단, 48h 쿨다운 (고점 ${currentPrice.toLocaleString()}원)`,
      cooldownUntil,
      recentHigh:    currentPrice,
    };
  }
  return {
    isCooldown: false,
    reason:     `직전 5거래일 +${return5d.toFixed(1)}% — 급등 미해당, 쿨다운 없음`,
  };
}

/**
 * 스캔 시점에 쿨다운 종목의 해제 여부를 평가한다.
 *
 * 쿨다운 해제 조건:
 *   1. 쿨다운 기간(48h) 경과, 또는
 *   2. 현재가가 고점(recentHigh) 대비 -5% ~ -8% 구간에 진입
 *      (기술적 조정 완료 → 지지 확인 캔들 대기 신호)
 *
 * @param cooldownUntil - 쿨다운 종료 시각 (ISO)
 * @param recentHigh - 쿨다운 진입 시 기록한 고점
 * @param currentPrice - 현재가
 * @param now - 현재 시각 (테스트 주입용, 기본값: new Date())
 * @returns true = 쿨다운 해제됨, false = 쿨다운 유지
 */
export function checkCooldownRelease(
  cooldownUntil: string,
  recentHigh: number,
  currentPrice: number,
  now: Date = new Date(),
): boolean {
  // 조건 1: 48시간 경과 → 자동 해제
  if (now >= new Date(cooldownUntil)) return true;

  // 조건 2: 고점 대비 -5% ~ -8% 되돌림 확인
  if (recentHigh > 0) {
    const pullbackPct = ((recentHigh - currentPrice) / recentHigh) * 100;
    if (pullbackPct >= PULLBACK_RELEASE_MIN_PCT && pullbackPct <= PULLBACK_RELEASE_MAX_PCT) {
      return true;
    }
  }

  return false;
}
