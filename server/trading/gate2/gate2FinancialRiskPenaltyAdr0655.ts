// @responsibility ADR-0655 Gate2 FUNDAMENTAL_QUALITY 재무위험 순수 평가 — ICR<1/부채>200% trigger→scoreCap(30/15), 결손 graceful, entryHardBlock=false·marketSignal=false·executionImpact=NONE.

/**
 * gate2FinancialRiskPenaltyAdr0655.ts — Gate2 재무 위험종목 선별 순수 평가 함수 (ADR-0655).
 *
 * 입력: gate2ConfluenceScore.buildFundamentalAxis 가 이미 resolve 한 두 임계 metric
 *       (interestCoverageRatio = DART 잔존 ICR, debtRatio = KIS stability-ratio lblt_rate L1).
 *       신규 fetch 0 — 외부 호출/네트워크 없음(순수 함수).
 *
 * 출력: Gate2FinancialRiskAssessment — riskLevel·triggers·scoreCap(상한)·evidence trace.
 *       buildFundamentalAxis 가 flag ON 시에만 scoreCap 을 Math.min 으로 산출 score 에 적용.
 *
 * 불변식 #6 보존(literal 강제):
 *   - entryHardBlock=false (점수 cap 만, 하드차단 0).
 *   - marketSignal=false / executionImpact='NONE' (재무 위험/결손 ≠ bearish market signal).
 *   - 임계 입력 null → 해당 trigger graceful skip (페널티 미적용 — 결손 ≠ 위험).
 *
 * flag SSOT = gateConfig.isGate2FinancialRiskPenaltyEnabled() (호출자 측 gate). 본 모듈은 flag 미참조.
 */

import {
  GATE2_DEBT_RATIO_EXCESS_THRESHOLD,
  GATE2_ICR_DISTRESS_THRESHOLD,
  GATE2_RISK_CRITICAL_SCORE_CAP,
  GATE2_RISK_ELEVATED_SCORE_CAP,
  type Gate2FinancialRiskAssessment,
  type Gate2FinancialRiskInput,
  type Gate2FinancialRiskTrigger,
  type Gate2RiskInputAvailability,
} from './gate2FinancialRiskTypes.js';

function availability(value: number | null): Gate2RiskInputAvailability {
  return value == null ? 'MISSING' : 'PRESENT';
}

/**
 * 재무 위험 평가 (ADR-0655). 순수 함수 — 입력 두 metric 만 판정.
 *
 * trigger 평가 (각 입력 null → 해당 trigger graceful skip):
 *   - ICR_BELOW_1       : icr != null && icr < GATE2_ICR_DISTRESS_THRESHOLD(=1)
 *   - DEBT_RATIO_EXCESS : debtRatio != null && debtRatio > GATE2_DEBT_RATIO_EXCESS_THRESHOLD(=200)
 *
 * riskLevel / scoreCap:
 *   - trigger 0개 → NONE     / scoreCap=null  (cap 미적용 — byte-identical)
 *   - trigger 1개 → ELEVATED / scoreCap=30
 *   - trigger 2개 → CRITICAL / scoreCap=15
 */
export function assessGate2FinancialRisk(input: Gate2FinancialRiskInput): Gate2FinancialRiskAssessment {
  const { interestCoverageRatio: icr, debtRatio } = input;
  const icrAvailability = availability(icr);
  const debtRatioAvailability = availability(debtRatio);

  const triggers: Gate2FinancialRiskTrigger[] = [];
  if (icr != null && icr < GATE2_ICR_DISTRESS_THRESHOLD) triggers.push('ICR_BELOW_1');
  if (debtRatio != null && debtRatio > GATE2_DEBT_RATIO_EXCESS_THRESHOLD) triggers.push('DEBT_RATIO_EXCESS');

  const riskLevel = triggers.length >= 2 ? 'CRITICAL' : triggers.length === 1 ? 'ELEVATED' : 'NONE';
  const scoreCap = riskLevel === 'CRITICAL'
    ? GATE2_RISK_CRITICAL_SCORE_CAP
    : riskLevel === 'ELEVATED'
      ? GATE2_RISK_ELEVATED_SCORE_CAP
      : null;

  const evidence: string[] = [
    `gate2FinancialRisk=${riskLevel}`,
    `riskTriggers=[${triggers.join(',')}]`,
    `riskIcr=${icr == null ? 'null' : icr}`,
    `riskDebtRatio=${debtRatio == null ? 'null' : debtRatio}`,
    `riskScoreCap=${scoreCap == null ? 'null' : scoreCap}`,
  ];

  return {
    riskLevel,
    triggers,
    scoreCap,
    icrAvailability,
    debtRatioAvailability,
    evidence,
    // 불변식 #6 — literal 강제 (재무 위험은 점수 cap 만; bearish/실행 영향 0).
    entryHardBlock: false,
    marketSignal: false,
    executionImpact: 'NONE',
  };
}
