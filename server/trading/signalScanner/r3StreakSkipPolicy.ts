/**
 * @responsibility R3 Violation Streak Increment Skip 정책 SSOT — Holiday-Aware
 *
 * ADR-0412 §3 — 데이터 오염 / 비거래일 / blocked-day 시 streak +1 차단.
 *
 * 사용자 명시 절대 원칙:
 *   - 데이터 오염 상태에서 R3 streak hard block 누적 금지 (절대 원칙 #5).
 *   - 휴장일/장외/volumeClock 비허용 GATE1_PASS_ZERO 시스템 결함 누적 금지 (절대 원칙 #6).
 *
 * 외부 의존성: 0 (KIS/Yahoo/외부 API 호출 0건).
 *
 * 호출자: scanDiagnostics.persistScanResults — state machine 진입 직전 평가.
 */

import type { FrozenQuoteDataQuality } from './frozenQuoteDetector.js';

/**
 * Skip reason union — `streakIncrementAllowed=false` 시 운영자 추적용 라벨.
 *
 * 우선순위 (한 컨텍스트에 다중 조건 충족 시 첫 매칭 채택):
 *   1. KRX_NON_TRADING_DAY
 *   2. VOLUME_CLOCK_CLOSED
 *   3. SELL_ONLY_MODE
 *   4. BLOCKED_DAY_SCAN
 *   5. FROZEN_QUOTE_STALE
 */
export type StreakSkipReason =
  | 'KRX_NON_TRADING_DAY'
  | 'VOLUME_CLOCK_CLOSED'
  | 'SELL_ONLY_MODE'
  | 'BLOCKED_DAY_SCAN'
  | 'FROZEN_QUOTE_STALE';

/**
 * 호출자 측에서 합성하는 컨텍스트 — preflight 의 macroGateState + frozenQuote 평가 결과.
 *
 * 모든 필드 의무 — 호출자가 미리 채워서 전달. 평가 함수 자체는 외부 의존성 0.
 */
export interface StreakSkipContext {
  /** KST 일자 (`YYYY-MM-DD`) — 진단·영속 추적용 */
  todayKstDate: string;
  /** KRX 거래일 여부 (`isKrxTradingDay(todayKstDate)` 결과) */
  isKrxTradingDay: boolean;
  /** volumeClock 진입 허용 여부 — false 시 점심·장외 시간대 */
  volumeClockAllowsEntry: boolean;
  /** SELL_ONLY 모드 (점심·장 마감 직전 등 macroGateState.sellOnlyMode 영속) */
  sellOnlyMode: boolean;
  /** UI 수동 가드 — getManualBlockNewBuy() */
  manualBlockNewBuy: boolean;
  /** UI 수동 가드 — getManualManageOnly() */
  manualManageOnly: boolean;
  /** macroGateState.regime 그대로 — 'R6_DEFENSE' / 'R5_CAUTION' 등 */
  regime: string;
  /** macroGateState.bearDefenseMode */
  bearDefenseMode: boolean;
  /** macroGateState.vixGatingActive */
  vixGatingActive: boolean;
  /** FOMC DAY block 활성 — getFomcProximity().noNewEntry */
  fomcBlockActive: boolean;
  /** FrozenQuoteDetector 결과 dataQuality */
  frozenQuoteDataQuality: FrozenQuoteDataQuality;
}

/**
 * Skip 평가 결과.
 *
 * `allowed=true` 시 호출자가 `updateR3ViolationStreak` 정상 호출.
 * `allowed=false` 시 호출자가 streak 갱신 skip (영속 무영향 + 24h decay 보존).
 */
export interface StreakSkipDecision {
  allowed: boolean;
  skipReason?: StreakSkipReason;
}

/**
 * Streak +1 허용 여부 SSOT — 우선순위 결정 트리 (ADR-0412 §3).
 *
 * 외부 부작용 0 — 영속 무관 read-only.
 *
 * 평가 우선순위 (위에서 아래로 첫 매칭 채택):
 *   1. !isKrxTradingDay → KRX_NON_TRADING_DAY
 *   2. !volumeClockAllowsEntry → VOLUME_CLOCK_CLOSED
 *   3. sellOnlyMode || manualBlockNewBuy || manualManageOnly → SELL_ONLY_MODE
 *   4. regime === 'R6_DEFENSE' || bearDefenseMode || vixGatingActive || fomcBlockActive → BLOCKED_DAY_SCAN
 *   5. frozenQuoteDataQuality === 'STALE' → FROZEN_QUOTE_STALE
 *   6. 그 외 → allowed=true
 *
 * SUSPECT 는 보수적 — STALE 만 skip (절대 원칙 #5 "데이터 오염" 의 명확한 임계).
 */
export function evaluateStreakIncrementAllowed(
  ctx: StreakSkipContext,
): StreakSkipDecision {
  if (!ctx.isKrxTradingDay) {
    return { allowed: false, skipReason: 'KRX_NON_TRADING_DAY' };
  }
  if (!ctx.volumeClockAllowsEntry) {
    return { allowed: false, skipReason: 'VOLUME_CLOCK_CLOSED' };
  }
  if (ctx.sellOnlyMode || ctx.manualBlockNewBuy || ctx.manualManageOnly) {
    return { allowed: false, skipReason: 'SELL_ONLY_MODE' };
  }
  if (
    ctx.regime === 'R6_DEFENSE' ||
    ctx.bearDefenseMode ||
    ctx.vixGatingActive ||
    ctx.fomcBlockActive
  ) {
    return { allowed: false, skipReason: 'BLOCKED_DAY_SCAN' };
  }
  if (ctx.frozenQuoteDataQuality === 'STALE') {
    return { allowed: false, skipReason: 'FROZEN_QUOTE_STALE' };
  }
  return { allowed: true };
}
