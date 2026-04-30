/**
 * @responsibility 빈스캔 원인 7값 코드화 SSOT — 매수 0건 시 시장 문제 vs 시스템 문제 자동 분류
 *
 * ADR-0119 (PR-A): 사용자 진단 *"매수 없음 = 보수적 작동" 이 아니라 "설명 못함 = 장애와
 * 정상 구분 불가"* 직접 반영. ADR-0118 의 진단 추정 분기 (텔레그램 메시지 String 분기)
 * 를 union 타입 SSOT 로 격상.
 *
 * 본 PR-A 는 현재 ScanCounters 카운터 기반 *최소 가능한 분류*. PR-B 에서
 * gate0/1/2/3 통과 수 분리 시 NO_LEADERSHIP 분류 자동 활성.
 */

import type { ScanSummary } from './scanDiagnostics.js';

/**
 * EMPTY_SCAN_REASON 7값 union — 사용자 9번 §5 설계.
 * UNKNOWN 은 분류 불가 fallback (회귀 테스트가 시나리오별 UNKNOWN 발생을 검증).
 */
export type EmptyScanReason =
  | 'MARKET_WEAK'        // 레짐 Risk-Off / R6_DEFENSE / Bear Defense / VIX 게이팅 / FOMC DAY
  | 'NO_LEADERSHIP'      // Gate1 통과 > 0 && Gate2 통과 = 0 (PR-B gate1/2 카운터 분리 후 활성)
  | 'NO_TIMING'          // Pre-breakout 미발동 다수 (50%+)
  | 'TOO_STRICT'         // Gate 재검증 미달 다수 (50%+) — 임계 과도
  | 'DATA_INVALID'       // DATA_HOLD + Corporate Action 30%+ — sanity 위반 다수
  | 'PIPELINE_ERROR'     // candidates 0 — 스캔 자체 망가짐 / universe 발굴 실패
  | 'ORDER_BLOCKED'      // 비상정지 / AUTO_TRADE_ENABLED=false / sellOnly / watchlist 비어있음 / 사이징 차단
  | 'UNKNOWN';           // 분류 불가 — 회귀 테스트가 자동 fail 트리거

/** 분류 임계 SSOT — ENV 우회 미설계 (운영 데이터 누적 후 PR-B 에서 ENV 도입 검토). */
export const EMPTY_SCAN_CLASSIFIER_THRESHOLDS = {
  /** dataHold + corpAction 비율 ≥ 30% 시 DATA_INVALID */
  DATA_INVALID_RATIO: 0.3,
  /** gateFail 비율 ≥ 50% 시 TOO_STRICT */
  TOO_STRICT_RATIO: 0.5,
  /** preBreakout 비율 ≥ 50% 시 NO_TIMING */
  NO_TIMING_RATIO: 0.5,
} as const;

/**
 * ScanSummary → EmptyScanReason 분류 SSOT.
 *
 * 우선순위 (위에서 아래로 평가, 첫 매칭 반환):
 * 1. entries > 0 → null (분류 안 함, 매수 발생)
 * 2. candidates === 0 → PIPELINE_ERROR (스캔 후보 0)
 * 3. macro 차단 → MARKET_WEAK (R6_DEFENSE / Bear / MHS<30 / VIX 게이팅 / FOMC DAY)
 * 4. order 차단 → ORDER_BLOCKED (emergencyStop / !autoTrade / sellOnly / watchlistEmpty / sizingBlocked)
 * 5. dataHold + corpAction ≥ 30% → DATA_INVALID
 * 6. gate1Pass>0 && gate2Pass=0 → NO_LEADERSHIP (ADR-0120 PR-B 활성)
 * 7. gate2Pass>0 && gate3Pass=0 → NO_TIMING (ADR-0120 PR-B 활성)
 * 8. gate3Pass>0 && lastTriggerPass=0 → NO_TIMING (ADR-0120 PR-B 활성)
 * 9. gateFail ≥ 50% → TOO_STRICT
 * 10. preBreakout ≥ 50% → NO_TIMING
 * 11. 그 외 → UNKNOWN
 *
 * @returns null = 분류 대상 아님 (entries > 0) / EmptyScanReason = 분류 결과
 */
export function classifyEmptyScanReason(summary: ScanSummary | null): EmptyScanReason | null {
  if (!summary) return null;

  // 1. 매수 발생 → 분류 대상 아님
  if (summary.entries > 0) return null;

  // 2. PIPELINE_ERROR — 스캔 후보 0 (universe 발굴 실패 또는 워치리스트 비어있음과 macro 미수집)
  if (summary.candidates === 0) {
    // macroGateState 미설정이면 진단 데이터 부족 → PIPELINE_ERROR
    // macroGateState 설정 + watchlistEmpty=true 면 ORDER_BLOCKED 우선 (4 단계)
    if (!summary.macroGateState) return 'PIPELINE_ERROR';
    if (summary.macroGateState.watchlistEmpty) return 'ORDER_BLOCKED';
    return 'PIPELINE_ERROR';
  }

  const mg = summary.macroGateState;
  const wd = summary.waitDistribution;

  // 3. MARKET_WEAK — 거시 차단 (regime / bear defense / VIX / FOMC DAY)
  if (mg) {
    if (mg.regime === 'R6_DEFENSE') return 'MARKET_WEAK';
    if (mg.bearDefenseMode) return 'MARKET_WEAK';
    if (mg.mhsBelow30) return 'MARKET_WEAK';
    if (mg.vixGatingActive) return 'MARKET_WEAK';
    if (mg.fomcPhase === 'DAY') return 'MARKET_WEAK';
  }

  // 4. ORDER_BLOCKED — 시스템 차단
  if (mg) {
    if (mg.emergencyStop) return 'ORDER_BLOCKED';
    if (!mg.autoTradeEnabled) return 'ORDER_BLOCKED';
    if (mg.sellOnlyMode) return 'ORDER_BLOCKED';
    if (mg.watchlistEmpty) return 'ORDER_BLOCKED';
  }
  // 사이징 차단 다수 → ORDER_BLOCKED (Kelly budget canEnterNew=false 또는 DATA_QUARANTINE)
  if (wd && wd.sizingBlocked > 0 && wd.sizingBlocked >= summary.candidates) {
    return 'ORDER_BLOCKED';
  }

  // 5. DATA_INVALID — dataHold + corpAction 30%+
  if (wd && summary.candidates > 0) {
    const dataInvalidCount = wd.dataHold + wd.corpAction;
    const dataInvalidRatio = dataInvalidCount / summary.candidates;
    if (dataInvalidRatio >= EMPTY_SCAN_CLASSIFIER_THRESHOLDS.DATA_INVALID_RATIO) {
      return 'DATA_INVALID';
    }
  }

  // 6~8. ADR-0120 (PR-B): GatePassDistribution 기반 정밀 분류
  const gpd = summary.gatePassDistribution;
  if (gpd) {
    // 6. NO_LEADERSHIP — Gate 1 통과는 있으나 Gate 2 통과 0 (생존했으나 성장주 부재)
    if (gpd.gate1Pass > 0 && gpd.gate2Pass === 0) {
      return 'NO_LEADERSHIP';
    }
    // 7. NO_TIMING — Gate 2 통과는 있으나 Gate 3 통과 0 (성장은 있으나 타이밍 부재)
    if (gpd.gate2Pass > 0 && gpd.gate3Pass === 0) {
      return 'NO_TIMING';
    }
    // 8. NO_TIMING — Gate 3 통과는 있으나 lastTrigger 미발동 (정밀 타이밍은 있으나 트리거 부재)
    if (gpd.gate3Pass > 0 && gpd.lastTriggerPass === 0) {
      return 'NO_TIMING';
    }
  }

  // 9. TOO_STRICT — gateFail 50%+ (사용자 R3 시나리오의 가장 유력한 가설)
  if (wd && summary.candidates > 0) {
    const gateFailRatio = wd.gateFail / summary.candidates;
    if (gateFailRatio >= EMPTY_SCAN_CLASSIFIER_THRESHOLDS.TOO_STRICT_RATIO) {
      return 'TOO_STRICT';
    }
  }

  // 10. NO_TIMING — preBreakout 50%+
  if (wd && summary.candidates > 0) {
    const preBreakoutRatio = wd.preBreakout / summary.candidates;
    if (preBreakoutRatio >= EMPTY_SCAN_CLASSIFIER_THRESHOLDS.NO_TIMING_RATIO) {
      return 'NO_TIMING';
    }
  }

  // 11. 분류 불가 fallback
  return 'UNKNOWN';
}

/**
 * EmptyScanReason → 한국어 라벨 + 설명 SSOT.
 * formatScanBlockersMessage 의 추정 원인 분기에 사용.
 */
export function describeEmptyScanReason(reason: EmptyScanReason): { label: string; advice: string } {
  switch (reason) {
    case 'MARKET_WEAK':
      return {
        label: '시장 약세 (정상 차단)',
        advice: '레짐/매크로 게이트 활성 — Kelly 축소 또는 매수 중단. 시장 회복 대기.',
      };
    case 'NO_LEADERSHIP':
      return {
        label: '주도 섹터 부재 (정상 대기)',
        advice: 'Gate 1 생존 통과 ≥ 1 / Gate 2 성장 통과 = 0 — 시장은 안정이나 주도주 부재.',
      };
    case 'NO_TIMING':
      return {
        label: '진입 타이밍 미발동 (정상 대기)',
        advice: 'Pre-breakout 미도달 다수 — 후보는 있으나 진입 트리거 미충족. 다음 사이클 재시도.',
      };
    case 'TOO_STRICT':
      return {
        label: 'Gate 임계 과도 (시스템 점검 필요)',
        advice: 'Gate 재검증 미달 50%+ — minGate 임계 또는 sectorBoost 검토. EXECUTION_RELAXATION_ENABLED 시도 권장.',
      };
    case 'DATA_INVALID':
      return {
        label: '데이터 오염 (시스템 점검 필요)',
        advice: 'sanity 위반 30%+ — Yahoo stale base 또는 corporate action 의심. /health 점검 + KIS canonicalPrice wiring 검토 (PR-B).',
      };
    case 'PIPELINE_ERROR':
      return {
        label: '파이프라인 장애 (시스템 점검 필요)',
        advice: '스캔 후보 0개 — universe 발굴 실패 또는 워치리스트 비어있음. autoPopulateWatchlist 상태 점검.',
      };
    case 'ORDER_BLOCKED':
      return {
        label: '주문 경로 차단 (운영자 결정)',
        advice: '비상정지 / AUTO_TRADE_ENABLED=false / SELL_ONLY 시간대 / 워치리스트 0 / 사이징 한도 도달.',
      };
    case 'UNKNOWN':
      return {
        label: '분류 불가 (점검 권장)',
        advice: '명백한 차단 게이트 부재 + 분류 임계 미충족 — 종목별 진입 조건 정밀 점검.',
      };
  }
}
