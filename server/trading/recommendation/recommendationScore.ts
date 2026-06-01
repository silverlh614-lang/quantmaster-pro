/**
 * @responsibility recommendation 전용 점수 계산 read-model: 9가산 2감산 → 0~100 clamp + tier — GateScore 역류 0, 주문 생성 금지, executionImpact NONE.
 *
 * ADR-0549 PR-2: scoreRecommendationCandidate 는 GateScore 와 별도 척도(RECOMMENDATION_SCORE_SEPARATED_FROM_GATE_SCORE).
 * gateScore 는 입력 참조만, Gate1 live score 를 절대 mutate 하지 않는다. 입력 부재 → 0 가산,
 * 감산(staleData/providerUncertainty)으로 흡수. providerUncertaintyPenalty 는 bearish 변환 아님(불변식#6).
 */

import type { CandidateSnapshot } from '../signalScanner/entryFilterDecomposition/types.js';
import type {
  MarketRallyLens,
  RecommendationScore,
  RecommendationScoreBreakdown,
  RecommendationTier,
} from './recommendationTypes.js';

/**
 * scoreRecommendationCandidate 입력. 전부 read-only materialized 값 — 새 provider 호출 0건.
 */
export interface RecommendationScoreInput {
  /** per-symbol scan 산출물 (read-only). gateScore 는 참조만 — 역류 금지. */
  snapshot: CandidateSnapshot;
  /** PR-1 buildMarketRallyLens 산출물 (market-level). */
  rallyLens: MarketRallyLens;
  /** ScanSummary.providerIssue (불변식#6 — bearish 변환 아님). */
  providerIssue?: boolean;
}

function isFiniteNumber(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function clamp(min: number, max: number, v: number): number {
  return Math.max(min, Math.min(max, v));
}

function tierOf(total: number): RecommendationTier {
  if (total >= 80) return 'STRONG_WATCH';
  if (total >= 60) return 'WATCH';
  if (total >= 40) return 'SOFT_WATCH';
  if (total >= 20) return 'OBSERVE';
  return 'LOW_PRIORITY';
}

/** providerHealth 안전 추출 (supplyProviderHealth.providerHealth). */
function readProviderHealth(s: CandidateSnapshot): string | undefined {
  return (s.supplyProviderHealth as { providerHealth?: string } | undefined)?.providerHealth;
}

/** 9 가산 항목 산출 (부재 → 0). 가중치/clamp 경계 그대로. */
function computeAdditiveComponents(
  s: CandidateSnapshot,
  lens: MarketRallyLens,
): Pick<
  RecommendationScoreBreakdown,
  | 'kospiRallyAlignment'
  | 'institutionInflow'
  | 'foreignInflow'
  | 'indexSyncStrength'
  | 'accumulationPattern'
  | 'preBreakoutProximity'
  | 'largeCapRebound'
  | 'relativeStrength'
  | 'volumeExpansion'
> {
  // 1. kospiRallyAlignment — 지수 급등 동조도 (rallyLens.enabled + kospiReturnPct)
  let kospiRallyAlignment = 0;
  if (lens.enabled && isFiniteNumber(lens.kospiReturnPct) && lens.kospiReturnPct > 0) {
    kospiRallyAlignment = clamp(0, 15, lens.kospiReturnPct * 5);
  }

  // 2. institutionInflow — 기관 순매수 동조
  let institutionInflow = 0;
  const inst = lens.investorFlow.marketInstitutionNetBuyApprox;
  if (isFiniteNumber(inst) && inst > 0) institutionInflow = 8;

  // 3. foreignInflow — 외국인 순매수 동조
  let foreignInflow = 0;
  const foreign = lens.investorFlow.foreignNetBuy5d;
  if (isFiniteNumber(foreign) && foreign > 0) foreignInflow = 8;

  // 4. indexSyncStrength — 지수-종목 동기화 (marketRelativeReturn/kospiRelativeReturn > 0)
  let indexSyncStrength = 0;
  const rel = isFiniteNumber(s.marketRelativeReturn)
    ? s.marketRelativeReturn
    : isFiniteNumber(s.kospiRelativeReturn)
      ? s.kospiRelativeReturn
      : null;
  if (rel !== null && rel > 0) indexSyncStrength = clamp(0, 12, rel * 3);

  // 5. accumulationPattern — 매집 (supply BULLISH)
  let accumulationPattern = 0;
  if (s.supplyConfluenceState === 'BULLISH') accumulationPattern = 10;

  // 6. preBreakoutProximity — 돌파 근접 (breakoutScore/vcpScore)
  let preBreakoutProximity = 0;
  const breakout = isFiniteNumber(s.breakoutScore)
    ? s.breakoutScore
    : isFiniteNumber(s.vcpScore)
      ? s.vcpScore
      : null;
  if (breakout !== null && breakout > 0) preBreakoutProximity = clamp(0, 12, breakout / 10);

  // 7. largeCapRebound — 대형주 반등 (return5d > 0)
  let largeCapRebound = 0;
  if (isFiniteNumber(s.return5d) && s.return5d > 0) largeCapRebound = 8;

  // 8. relativeStrength — RS (relativeStrengthScore / rsRankPct)
  let relativeStrength = 0;
  if (isFiniteNumber(s.relativeStrengthScore) && s.relativeStrengthScore > 0) {
    relativeStrength = clamp(0, 12, s.relativeStrengthScore / 5);
  } else if (isFiniteNumber(s.rsRankPct) && s.rsRankPct > 50) {
    relativeStrength = clamp(0, 12, (s.rsRankPct - 50) / 5);
  }

  // 9. volumeExpansion — 거래량 확대 (volumeRatio > 1)
  let volumeExpansion = 0;
  if (isFiniteNumber(s.volumeRatio) && s.volumeRatio > 1) {
    volumeExpansion = clamp(0, 10, (s.volumeRatio - 1) * 5);
  }

  return {
    kospiRallyAlignment,
    institutionInflow,
    foreignInflow,
    indexSyncStrength,
    accumulationPattern,
    preBreakoutProximity,
    largeCapRebound,
    relativeStrength,
    volumeExpansion,
  };
}

/** 2 감산 항목 산출 (음수). bearish 변환 아님(불변식#6) — 단순 점수 차감. */
function computePenalties(
  s: CandidateSnapshot,
  providerIssue: boolean,
): Pick<RecommendationScoreBreakdown, 'staleDataPenalty' | 'providerUncertaintyPenalty'> {
  const providerHealth = readProviderHealth(s);

  // staleDataPenalty — 데이터 신선도 결손
  let staleDataPenalty = 0;
  if (s.priceDataFresh === false || providerHealth === 'STALE') {
    staleDataPenalty = -10;
  }

  // providerUncertaintyPenalty — providerIssue / UNKNOWN / MISSING (bearish 변환 아님)
  let providerUncertaintyPenalty = 0;
  if (
    providerIssue ||
    s.supplyConfluenceState === 'UNKNOWN' ||
    s.supplyConfluenceState === 'UNAVAILABLE' ||
    providerHealth === 'MISSING'
  ) {
    providerUncertaintyPenalty = -8;
  }

  return { staleDataPenalty, providerUncertaintyPenalty };
}

/** breakdown 11항목 단순 합 (가산 9 + 감산 2). 합산식 그대로 보존. */
function sumBreakdown(b: RecommendationScoreBreakdown): number {
  return (
    b.kospiRallyAlignment +
    b.institutionInflow +
    b.foreignInflow +
    b.indexSyncStrength +
    b.accumulationPattern +
    b.preBreakoutProximity +
    b.largeCapRebound +
    b.relativeStrength +
    b.volumeExpansion +
    b.staleDataPenalty +
    b.providerUncertaintyPenalty
  );
}

/**
 * recommendation 점수 산출. GateScore 역류 0 — gateScore 입력은 참조만, mutate 0건.
 * 입력 부재 항목은 0 가산. 데이터 결손/providerIssue 는 감산으로 흡수(bearish 변환 아님).
 */
export function scoreRecommendationCandidate(input: RecommendationScoreInput): RecommendationScore {
  const s = input.snapshot;
  const lens = input.rallyLens;
  const providerIssue = input.providerIssue === true;

  const additive = computeAdditiveComponents(s, lens);
  const penalties = computePenalties(s, providerIssue);

  const breakdown: RecommendationScoreBreakdown = {
    ...additive,
    ...penalties,
  };

  const total = clamp(0, 100, sumBreakdown(breakdown));

  return {
    total,
    tier: tierOf(total),
    breakdown,
    executionImpact: 'NONE',
  };
}
