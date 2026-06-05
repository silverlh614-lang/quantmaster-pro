/**
 * @responsibility R3 Violation Streak Increment Skip + Countability SSOT — ADR-0412/0419 통합
 *
 * ADR-0412 §3 — 데이터 오염 / 비거래일 / blocked-day 시 streak +1 차단.
 * ADR-0419 — SELL_ONLY / VolumeClock closed / 매크로 게이트 시 SHADOW_ONLY pre-scan 자체 차단.
 *
 * 사용자 명시 절대 원칙:
 *   - 데이터 오염 상태에서 R3 streak hard block 누적 금지 (절대 원칙 #5).
 *   - 휴장일/장외/volumeClock 비허용 GATE1_PASS_ZERO 시스템 결함 누적 금지 (절대 원칙 #6).
 *   - SELL_ONLY / VolumeClock closed / R6 / VIX / FOMC / 데이터 빈곤 시 SHADOW_ONLY 트리거 금지 (ADR-0419).
 *
 * 외부 의존성: 0 (KIS/Yahoo/외부 API 호출 0건).
 *
 * 호출자:
 *   - scanDiagnostics.persistScanResults — streak +1 평가 (ADR-0412)
 *   - signalScanner/preflight — SHADOW_ONLY pre-scan countability 평가 (ADR-0419)
 */

import type { FrozenQuoteDataQuality } from './frozenQuoteDetector.js';

/**
 * Skip reason union — `streakIncrementAllowed=false` 시 운영자 추적용 라벨.
 *
 * ADR-0412 (5종) + ADR-0419 (6종 신규) — 총 11종.
 *
 * 우선순위 (한 컨텍스트에 다중 조건 충족 시 첫 매칭 채택):
 *   1. KRX_NON_TRADING_DAY        (ADR-0412, 휴장일·주말)
 *   2. VOLUME_CLOCK_CLOSED        (ADR-0412, 점심·장외 시간대)
 *   3. EMERGENCY_STOP             (ADR-0419, 운영자 비상정지)
 *   4. MANUAL_BLOCK_NEW_BUY       (ADR-0419, /unblock_buy 가드)
 *   5. SELL_ONLY_MODE             (ADR-0412, 매크로 매도전용 모드)
 *   6. R6_DEFENSE_REGIME          (ADR-0419, 블랙스완 방어)
 *   7. VIX_BLOCK                  (ADR-0419, VIX 게이팅)
 *   8. FOMC_BLOCK                 (ADR-0419, FOMC 게이팅)
 *   9. BLOCKED_DAY_SCAN           (ADR-0412, bear / 그 외 거시 게이트 — fallback)
 *  10. DATA_STARVED_SCAN          (ADR-0419, MTAS/DART 결손)
 *  11. FROZEN_QUOTE_STALE         (ADR-0412, 입력 데이터 오염)
 */
export type StreakSkipReason =
  | 'KRX_NON_TRADING_DAY'
  | 'VOLUME_CLOCK_CLOSED'
  | 'EMERGENCY_STOP'
  | 'MANUAL_BLOCK_NEW_BUY'
  | 'SELL_ONLY_MODE'
  | 'R6_DEFENSE_REGIME'
  | 'VIX_BLOCK'
  | 'FOMC_BLOCK'
  | 'BLOCKED_DAY_SCAN'
  | 'DATA_STARVED_SCAN'
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
  /** 운영자 비상정지 (getEmergencyStop()) — ADR-0419 */
  emergencyStop?: boolean;
  /** UI 수동 가드 — getManualBlockNewBuy() */
  manualBlockNewBuy: boolean;
  /** UI 수동 가드 — getManualManageOnly() */
  manualManageOnly: boolean;
  /** SELL_ONLY 모드 (점심·장 마감 직전 등 macroGateState.sellOnlyMode 영속) */
  sellOnlyMode: boolean;
  /** macroGateState.regime 그대로 — 'R6_DEFENSE' / 'R5_CAUTION' 등 */
  regime: string;
  /** macroGateState.bearDefenseMode */
  bearDefenseMode: boolean;
  /** macroGateState.vixGatingActive */
  vixGatingActive: boolean;
  /** FOMC DAY block 활성 — getFomcProximity().noNewEntry */
  fomcBlockActive: boolean;
  /** 데이터 빈곤 스캔 (isDataStarvedScan()) — ADR-0419 */
  dataStarvedScan?: boolean;
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
 * Streak +1 허용 여부 SSOT — 우선순위 결정 트리 (ADR-0412 §3 + ADR-0419 확장).
 *
 * 외부 부작용 0 — 영속 무관 read-only.
 *
 * 평가 우선순위 (위에서 아래로 첫 매칭 채택):
 *   1. !isKrxTradingDay → KRX_NON_TRADING_DAY
 *   2. !volumeClockAllowsEntry → VOLUME_CLOCK_CLOSED
 *   3. emergencyStop → EMERGENCY_STOP
 *   4. manualBlockNewBuy || manualManageOnly → MANUAL_BLOCK_NEW_BUY
 *   5. sellOnlyMode → SELL_ONLY_MODE
 *   6. regime === 'R6_DEFENSE' → R6_DEFENSE_REGIME
 *   7. vixGatingActive → VIX_BLOCK
 *   8. fomcBlockActive → FOMC_BLOCK
 *   9. bearDefenseMode → BLOCKED_DAY_SCAN
 *  10. dataStarvedScan → DATA_STARVED_SCAN
 *  11. frozenQuoteDataQuality === 'STALE' → FROZEN_QUOTE_STALE
 *  12. 그 외 → allowed=true
 *
 * SUSPECT 는 보수적 — STALE 만 skip (절대 원칙 #5 "데이터 오염" 의 명확한 임계).
 */
export function evaluateStreakIncrementAllowed(
  ctx: StreakSkipContext,
): StreakSkipDecision {
  // #1 KRX 비거래일 (ADR-0412)
  if (!ctx.isKrxTradingDay) {
    return { allowed: false, skipReason: 'KRX_NON_TRADING_DAY' };
  }
  // #2 VolumeClock CLOSED — 점심·장외 시간대 (ADR-0412)
  if (!ctx.volumeClockAllowsEntry) {
    return { allowed: false, skipReason: 'VOLUME_CLOCK_CLOSED' };
  }
  // #3 운영자 비상정지 (ADR-0419)
  if (ctx.emergencyStop) {
    return { allowed: false, skipReason: 'EMERGENCY_STOP' };
  }
  // #4 UI 수동 가드 (ADR-0419)
  if (ctx.manualBlockNewBuy || ctx.manualManageOnly) {
    return { allowed: false, skipReason: 'MANUAL_BLOCK_NEW_BUY' };
  }
  // #5 SELL_ONLY 모드 — 매크로 매도전용 (ADR-0412)
  if (ctx.sellOnlyMode) {
    return { allowed: false, skipReason: 'SELL_ONLY_MODE' };
  }
  // #6 R6 블랙스완 방어 레짐 (ADR-0419)
  if (ctx.regime === 'R6_DEFENSE') {
    return { allowed: false, skipReason: 'R6_DEFENSE_REGIME' };
  }
  // #7 VIX 게이팅 (ADR-0419)
  if (ctx.vixGatingActive) {
    return { allowed: false, skipReason: 'VIX_BLOCK' };
  }
  // #8 FOMC 게이팅 (ADR-0419)
  if (ctx.fomcBlockActive) {
    return { allowed: false, skipReason: 'FOMC_BLOCK' };
  }
  // #9 bear / 그 외 거시 게이트 fallback (ADR-0412)
  if (ctx.bearDefenseMode) {
    return { allowed: false, skipReason: 'BLOCKED_DAY_SCAN' };
  }
  // #10 데이터 빈곤 스캔 (ADR-0419)
  if (ctx.dataStarvedScan) {
    return { allowed: false, skipReason: 'DATA_STARVED_SCAN' };
  }
  if (ctx.frozenQuoteDataQuality === 'STALE') {
    return { allowed: false, skipReason: 'FROZEN_QUOTE_STALE' };
  }
  return { allowed: true };
}

/**
 * ADR-0419 — R3 SHADOW_ONLY pre-scan 발화 가능 여부 SSOT.
 *
 * 사용자 명시: streak hard block latch 격상은 *정상 거래일에 GATE1_PASS_ZERO 가 누적될 때만* 의미가 있다.
 * 휴장일·SELL_ONLY·R6·VIX·FOMC·데이터 빈곤·VolumeClock closed 시점의 GATE1_PASS_ZERO 는 시스템 결함이 아니므로
 * SHADOW_ONLY pre-scan 자체를 trigger 하지 않아야 한다.
 *
 * `evaluateStreakIncrementAllowed` 와 동일 우선순위 결정 트리 — 두 함수가 같은 결정을 내리는 것이 목표.
 * 호출자(preflight) 가 streak count 증가 여부와 SHADOW_ONLY trigger 여부 모두 본 함수로 판정.
 *
 * 반환:
 *   - `countable=true` : 정상 스캔 — SHADOW_ONLY pre-scan 평가 진행 가능.
 *   - `countable=false` : 비정상 컨텍스트 — pre-scan trigger 영구 차단 (skipReason 으로 운영자 추적).
 *
 * 외부 부작용 0.
 */
export function evaluateR3CountableScan(ctx: StreakSkipContext): {
  countable: boolean;
  skipReason?: StreakSkipReason;
} {
  const decision = evaluateStreakIncrementAllowed(ctx);
  if (decision.allowed) {
    return { countable: true };
  }
  return { countable: false, skipReason: decision.skipReason };
}
