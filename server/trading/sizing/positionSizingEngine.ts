/**
 * @responsibility 계좌 생애주기 기반 포지션 사이징 엔진 — 7축 통합 최종 매수금액 계산
 *
 * 7축: 신호등급 / 계좌규모 / 시장레짐 / 손절폭 / 드로우다운 / 유동성 / 포트폴리오집중도
 *
 * 외부에서 호출하는 단일 진입점: computeFinalPosition()
 * 단일 함수 300줄 규칙을 준수하기 위해 보조 함수를 분리한다.
 */

import {
  getAccountSizeTier,
  getBasePositionPct,
  type SignalGrade,
  type AccountSizeTier,
} from './accountSizeTiers.js';
import { getDrawdownMultiplier } from './drawdownAdapter.js';
import { getLossStreakMultiplier, type LossStreakState } from './coolingOffEngine.js';
import {
  getLiquidityMultiplier,
  getSectorExposureMultiplier,
  checkUniverseEligibility,
} from './liquidityAndSectorGuard.js';

// ─── 타입 ────────────────────────────────────────────────────────────────────

export interface PositionSizingInput {
  /** 계좌 총액 (원) */
  accountEquity: number;
  /** 계좌 역대 최고치 (원) — 드로우다운 계산용 */
  peakEquity: number;
  /** 신호 등급 */
  signalGrade: SignalGrade;
  /** 손절폭 (비율, 예: 0.08 = 8%) */
  stopLossPct: number;

  // ── 외부 배수 ──
  /** 레짐 배수 (기본 1.0) */
  regimeMultiplier: number;
  /** 신뢰도 배수 (기본 1.0) */
  confidenceMultiplier: number;
  /** RRR 배수 (기본 1.0) */
  rrrMultiplier: number;
  /** 상관관계 배수 (기본 1.0) */
  correlationMultiplier: number;

  // ── 드로우다운 / 냉각 ──
  lossStreakState: LossStreakState;

  // ── 유동성 ──
  /** 20일 평균 거래대금 (원) */
  avgDailyVolume20d: number;
  /** 시가총액 (원) */
  marketCap: number;
  isAdminStock: boolean;
  isInvestmentWarning: boolean;

  // ── 섹터 ──
  /** 현재 해당 섹터 포트폴리오 비중 (0~1) */
  currentSectorWeight: number;
  /** 최대 허용 섹터 비중 (기본 0.30) */
  maxSectorWeight?: number;

  // ── MICRO/SMALL/GROWTH 우선권 허용 조건 ──
  /** 레짐이 NORMAL/RECOVERY/EXPANSION 중 하나인지 */
  isNormalRegime: boolean;
  /** RRR >= 2.5 인지 */
  rrrAbove2_5: boolean;
  /** EnemyChecklist 통과 여부 */
  enemyChecklistPassed: boolean;
  /** 데이터 신뢰도 HIGH 또는 MEDIUM_HIGH 여부 */
  highDataReliability: boolean;
  /** Gate 1 전부 통과 여부 */
  gate1AllPassed: boolean;
  /** 월봉/주봉 하락 추세가 아닌지 */
  notInDowntrend: boolean;
}

export interface PositionSizingResult {
  /** 최종 매수금액 (원) */
  finalPosition: number;
  /** 계좌 대비 최종 비중 */
  finalPositionPct: number;
  /** 손절 시 예상 계좌 손실률 */
  expectedStopLossDamagePct: number;
  /** 티어 최대 허용 손절 손실률 초과 여부 */
  exceedsMaxDamage: boolean;

  // ── 각 축 배수 (디버깅/UI 표시용) ──
  tier: AccountSizeTier;
  basePct: number;
  signalBasedPosition: number;
  riskBasedPosition: number;
  maxPositionCap: number;
  drawdownMultiplier: number;
  lossStreakMultiplier: number;
  liquidityMultiplier: number;
  sectorExposureMultiplier: number;

  // ── 차단 사유 ──
  blocked: boolean;
  blockReason?: string;

  // ── 감액 사유 목록 (UI 표시) ──
  adjustmentReasons: string[];

  // ── 우선권 적용 여부 ──
  signalPriorityApplied: boolean;
}

// ─── 공개 API ────────────────────────────────────────────────────────────────

/**
 * 7축 기반 최종 매수금액을 계산한다.
 * 차단 조건이 하나라도 해당되면 finalPosition = 0, blocked = true를 반환한다.
 */
export function computeFinalPosition(
  input: PositionSizingInput,
): PositionSizingResult {
  const tier = getAccountSizeTier(input.accountEquity);
  const reasons: string[] = [];

  // ── 1. Universe 기준 확인 ───────────────────────────────────────────────
  const universe = checkUniverseEligibility({
    tierName: tier.name,
    marketCap: input.marketCap,
    avgDailyVolume20d: input.avgDailyVolume20d,
    isAdminStock: input.isAdminStock,
    isInvestmentWarning: input.isInvestmentWarning,
  });
  if (!universe.eligible) {
    return buildBlocked(tier, input, universe.reason ?? 'Universe 기준 미달');
  }

  // ── 2. 드로우다운 배수 ──────────────────────────────────────────────────
  const ddResult = getDrawdownMultiplier(input.peakEquity, input.accountEquity);
  if (ddResult.blocked) {
    return buildBlocked(tier, input, ddResult.reason ?? '드로우다운 차단');
  }
  if (ddResult.reason) reasons.push(ddResult.reason);

  // ── 3. 연속 손절 배수 ───────────────────────────────────────────────────
  const lossResult = getLossStreakMultiplier(input.lossStreakState);
  if (lossResult.blocked) {
    return buildBlocked(tier, input, lossResult.reason ?? '연속 손절 차단');
  }
  if (lossResult.reason) reasons.push(lossResult.reason);

  // ── 4. 유동성 배수 ──────────────────────────────────────────────────────
  // 예상 매수금액 추정 (기본 비중 × 계좌): 실제 계산 전 근사값
  const basePct = getBasePositionPct(tier, input.signalGrade);
  const approxAmount = input.accountEquity * basePct;
  const liqResult = getLiquidityMultiplier(
    tier.name,
    approxAmount,
    input.avgDailyVolume20d,
  );
  if (liqResult.reason) reasons.push(liqResult.reason);

  // ── 5. 섹터 감쇄 배수 ───────────────────────────────────────────────────
  const sectorResult = getSectorExposureMultiplier(
    input.currentSectorWeight,
    input.maxSectorWeight ?? 0.30,
  );
  if (sectorResult.blocked) {
    return buildBlocked(tier, input, sectorResult.reason ?? '섹터 집중도 초과');
  }
  if (sectorResult.reason) reasons.push(sectorResult.reason);

  // ── 6. 배수 중복 방지 규칙 ──────────────────────────────────────────────
  // 레짐 위험과 드로우다운 위험은 더 큰 감점 하나만 적용
  // 상관관계 위험과 섹터 집중 위험도 더 큰 감점 하나만 적용
  const effectiveLiquiditySectorMultiplier = Math.min(
    liqResult.multiplier,
    sectorResult.multiplier,
  );

  // ── 7. Signal-Based Position ─────────────────────────────────────────────
  const signalBasedPosition =
    input.accountEquity
    * basePct
    * input.regimeMultiplier
    * input.confidenceMultiplier
    * input.rrrMultiplier
    * input.correlationMultiplier
    * ddResult.multiplier
    * lossResult.multiplier
    * effectiveLiquiditySectorMultiplier;

  // ── 8. Risk-Based Position ───────────────────────────────────────────────
  const riskBasedPosition =
    input.stopLossPct > 0
      ? (input.accountEquity * tier.riskPerTradePct) / input.stopLossPct
      : signalBasedPosition;

  // ── 9. Max Position Cap ──────────────────────────────────────────────────
  const maxPositionCap = input.accountEquity * tier.maxPositionPct;

  // ── 10. MICRO/SMALL/GROWTH 신호 우선권 ──────────────────────────────────
  const canApplySignalPriority = canUseSignalPriority(input, tier);
  let rawPosition: number;
  let signalPriorityApplied = false;

  if (canApplySignalPriority && signalBasedPosition > riskBasedPosition) {
    rawPosition = Math.min(signalBasedPosition, maxPositionCap);
    signalPriorityApplied = true;
    reasons.push('소액 계좌 신호 우선권 적용');
  } else {
    rawPosition = Math.min(signalBasedPosition, riskBasedPosition, maxPositionCap);
  }

  // ── 11. 손절 손실률 안전망 ───────────────────────────────────────────────
  const expectedDamagePct =
    input.stopLossPct > 0 && input.accountEquity > 0
      ? (rawPosition * input.stopLossPct) / input.accountEquity
      : 0;

  let finalPosition = rawPosition;
  const exceedsMaxDamage = expectedDamagePct > tier.maxStopLossDamagePct;

  if (exceedsMaxDamage) {
    finalPosition =
      (input.accountEquity * tier.maxStopLossDamagePct) / input.stopLossPct;
    reasons.push(
      `손절 손실률 ${(expectedDamagePct * 100).toFixed(2)}% > 허용 ${(tier.maxStopLossDamagePct * 100).toFixed(1)}% — 포지션 감액`,
    );
  }

  finalPosition = Math.max(0, Math.round(finalPosition));

  const finalPositionPct =
    input.accountEquity > 0 ? finalPosition / input.accountEquity : 0;
  const finalExpectedDamage =
    input.stopLossPct > 0 && input.accountEquity > 0
      ? (finalPosition * input.stopLossPct) / input.accountEquity
      : 0;

  return {
    finalPosition,
    finalPositionPct,
    expectedStopLossDamagePct: finalExpectedDamage,
    exceedsMaxDamage,
    tier,
    basePct,
    signalBasedPosition: Math.round(signalBasedPosition),
    riskBasedPosition: Math.round(riskBasedPosition),
    maxPositionCap: Math.round(maxPositionCap),
    drawdownMultiplier: ddResult.multiplier,
    lossStreakMultiplier: lossResult.multiplier,
    liquidityMultiplier: liqResult.multiplier,
    sectorExposureMultiplier: sectorResult.multiplier,
    blocked: false,
    adjustmentReasons: reasons,
    signalPriorityApplied,
  };
}

// ─── 내부 유틸리티 ───────────────────────────────────────────────────────────

/** MICRO/SMALL/GROWTH 티어에서 신호 우선권 허용 조건을 평가한다. */
function canUseSignalPriority(
  input: PositionSizingInput,
  tier: AccountSizeTier,
): boolean {
  if (!['MICRO', 'SMALL', 'GROWTH'].includes(tier.name)) return false;
  if (input.signalGrade === 'BUY') return false; // STRONG_BUY 이상만 허용
  return (
    input.isNormalRegime &&
    input.rrrAbove2_5 &&
    input.enemyChecklistPassed &&
    input.highDataReliability &&
    input.gate1AllPassed &&
    input.notInDowntrend
  );
}

/** 차단 결과 객체 빌더 */
function buildBlocked(
  tier: AccountSizeTier,
  input: PositionSizingInput,
  blockReason: string,
): PositionSizingResult {
  return {
    finalPosition: 0,
    finalPositionPct: 0,
    expectedStopLossDamagePct: 0,
    exceedsMaxDamage: false,
    tier,
    basePct: getBasePositionPct(tier, input.signalGrade),
    signalBasedPosition: 0,
    riskBasedPosition: 0,
    maxPositionCap: 0,
    drawdownMultiplier: 0,
    lossStreakMultiplier: 0,
    liquidityMultiplier: 0,
    sectorExposureMultiplier: 0,
    blocked: true,
    blockReason,
    adjustmentReasons: [blockReason],
    signalPriorityApplied: false,
  };
}

// ─── UI 출력 포맷터 ──────────────────────────────────────────────────────────

/**
 * 포지션 사이징 결과를 Telegram 메시지 형식으로 포맷한다.
 */
export function formatSizingResult(
  result: PositionSizingResult,
  input: PositionSizingInput,
  stockName: string,
): string {
  const { tier, finalPosition, finalPositionPct } = result;

  if (result.blocked) {
    return (
      `🚫 <b>매수 차단 — ${stockName}</b>\n` +
      `사유: ${result.blockReason}\n` +
      `계좌 티어: ${tier.name} / ${input.accountEquity.toLocaleString()}원`
    );
  }

  const lines = [
    `📊 <b>포지션 사이징 — ${stockName}</b>`,
    `계좌 총액: ${input.accountEquity.toLocaleString()}원`,
    `계좌 티어: ${tier.name}`,
    `신호 등급: ${input.signalGrade}`,
    `기본 비중: ${(result.basePct * 100).toFixed(0)}%`,
    `최종 매수금액: ${finalPosition.toLocaleString()}원`,
    `최종 계좌 비중: ${(finalPositionPct * 100).toFixed(1)}%`,
    `손절폭: ${(input.stopLossPct * 100).toFixed(1)}%`,
    `손절 시 예상 계좌 손실: ${(result.expectedStopLossDamagePct * 100).toFixed(2)}%`,
    `허용 최대 손절 손실: ${(tier.maxStopLossDamagePct * 100).toFixed(1)}%`,
    `권장 보유 종목: ${tier.targetHoldingsMin}~${tier.targetHoldingsMax}개`,
  ];

  if (result.adjustmentReasons.length > 0) {
    lines.push(`\n⚙️ 감액 사유:`);
    result.adjustmentReasons.forEach((r) => lines.push(`  • ${r}`));
  }

  if (result.signalPriorityApplied) {
    lines.push(`✅ 소액 계좌 신호 우선권 적용됨`);
  }

  return lines.join('\n');
}
