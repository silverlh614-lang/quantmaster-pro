/**
 * @responsibility ENV-gated read-model: CandidateSnapshot[] 을 LIVE/SEARCH/INDEX_RALLY lane 으로 분류 — 재계산 0, 주문 생성 금지, executionImpact NONE.
 *
 * ADR-0549 PR-2: buildGate1LaneResult 는 자동매매 트리와 분리된 추천/관측 read-model.
 * liveHardPass 는 gate1Passed && minSignalScorePassed 미러식 1줄만 (LIVE_HARD_PASS_BYTE_IDENTICAL,
 * gate1DryRunObservationLedgerAdr0476.ts:500 동일 식). requiredScore=70 thresholdMinus5/regimeAware
 * 절대 미사용. ENV OFF / rallyLens.enabled=false → enabled:false. providerIssue 비변환(불변식#6).
 */

import { LEGACY_GATE1_REQUIRED_SCORE } from '../gateConfig.js';
import type { CandidateSnapshot } from '../signalScanner/entryFilterDecomposition/types.js';
import { isMarketRallyLensEnabled } from './marketRallyLens.js';
import type {
  Gate1LaneLabel,
  Gate1LaneResult,
  Gate1SymbolLaneResult,
  MarketRallyLens,
} from './recommendationTypes.js';

/**
 * buildGate1LaneResult 입력. 전부 이미 materialize 된 scan 산출물 — 새 provider 호출 0건.
 */
export interface Gate1LaneResultInput {
  /** scan 종료 후 read-only 소비. ScanSummary.candidatePool?.candidateSnapshots 등. */
  candidateSnapshots: CandidateSnapshot[];
  /** PR-1 buildMarketRallyLens 산출물 (market-level). */
  rallyLens: MarketRallyLens;
  /** ScanSummary.providerIssue (불변식#6 — bullish/bearish 비변환). */
  providerIssue?: boolean;
  /** macro/sellOnly 가 DATA_HOLD/HOLD 상태면 INDEX_RALLY lane false. */
  dataHold?: boolean;
  /** scan 과 공유하는 snapshotId (불변식#3). */
  snapshotId?: string;
  /** 평가 시각 (ISO). 미지정 시 호출 시점. */
  asOf?: string;
}

function isFiniteNumber(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function disabledLaneResult(asOf: string, snapshotId?: string): Gate1LaneResult {
  return {
    enabled: false,
    symbols: [],
    liveHardPassCount: 0,
    searchRecommendationPassCount: 0,
    indexRallyWatchPassCount: 0,
    buySignal: false,
    executionImpact: 'NONE',
    recommendationOnly: true,
    snapshotId,
    asOf,
  };
}

/**
 * SEARCH 보조: supply ∈ {ACCUMULATING, BULLISH}. confluenceState 는 BULLISH 만,
 * ACCUMULATING 은 본 구조에 없음 → BULLISH 매칭. UNKNOWN/UNAVAILABLE → false (비변환).
 */
function supplyBullish(s: CandidateSnapshot): boolean {
  return s.supplyConfluenceState === 'BULLISH';
}

/**
 * SEARCH 보조: priceMomentum > 0. 직접 명칭 부재 → proxy return5d→return20d→marketRelativeReturn.
 * gate1DryRunObservationLedgerAdr0476.ts:499 와 동일 proxy 우선순위.
 */
function priceMomentumPositive(s: CandidateSnapshot): boolean {
  const m = isFiniteNumber(s.return5d)
    ? s.return5d
    : isFiniteNumber(s.return20d)
      ? s.return20d
      : isFiniteNumber(s.marketRelativeReturn)
        ? s.marketRelativeReturn
        : null;
  return m !== null && m > 0;
}

/** SEARCH 보조: RS > 0. relativeStrengthScore null 빈번 → rsRankPct(>50 = RS>0) proxy. */
function relativeStrengthPositive(s: CandidateSnapshot): boolean {
  if (isFiniteNumber(s.relativeStrengthScore)) return s.relativeStrengthScore > 0;
  if (isFiniteNumber(s.rsRankPct)) return s.rsRankPct > 50;
  return false;
}

/** SEARCH 보조: sectorEnergy VERIFIED. enum 부재 → 문자열 'VERIFIED'|'LEADING' 매핑. */
function sectorEnergyVerified(s: CandidateSnapshot): boolean {
  return s.sectorEnergyState === 'VERIFIED' || s.sectorEnergyState === 'LEADING';
}

/** liquidity OK: volumeLiquidityPassed === true. 부재 → false (미충족). */
function liquidityOk(s: CandidateSnapshot): boolean {
  return s.volumeLiquidityPassed === true;
}

/** liquidity not hard-fail: volumeLiquidityPassed !== false (undefined 는 not-fail 허용 — watch lane 관대). */
function liquidityNotHardFail(s: CandidateSnapshot): boolean {
  return s.volumeLiquidityPassed !== false;
}

/** quoteFresh: priceDataFresh === true (per-symbol quoteFreshness 명칭 부재 → proxy). */
function quoteFresh(s: CandidateSnapshot): boolean {
  return s.priceDataFresh === true;
}

/** sourceHealth ∈ {VERIFIED, FRESH}: 'FRESH' 리터럴 없음 → providerHealth/confluenceState VERIFIED 만. */
function sourceHealthVerified(s: CandidateSnapshot): boolean {
  if (s.supplyProviderHealth && (s.supplyProviderHealth as { providerHealth?: string }).providerHealth === 'VERIFIED') {
    return true;
  }
  return s.supplyConfluenceState === 'BULLISH' || s.supplyConfluenceState === 'NEUTRAL';
}

/**
 * LIVE_HARD_PASS 미러식 1줄. gate1DryRunObservationLedgerAdr0476.ts:500 동일 boolean 식
 * (LIVE_HARD_PASS_BYTE_IDENTICAL). 헬퍼로 분리해도 식 자체는 글자단위 보존.
 */
function mirrorLiveHardPass(s: CandidateSnapshot): boolean {
  return s.gate1Passed === true && s.minSignalScorePassed === true;
}

/** SEARCH 보조조건 입력 부재 가시화 degrade 라벨 수집 (부재=미충족=false, 비변환). */
function collectSearchDegradeReasons(s: CandidateSnapshot): string[] {
  const reasons: string[] = [];
  if (!isFiniteNumber(s.return5d) && !isFiniteNumber(s.return20d) && !isFiniteNumber(s.marketRelativeReturn)) {
    reasons.push('PRICE_MOMENTUM_NOT_AVAILABLE');
  }
  if (!isFiniteNumber(s.relativeStrengthScore) && !isFiniteNumber(s.rsRankPct)) {
    reasons.push('RS_NOT_AVAILABLE');
  }
  if (
    s.supplyConfluenceState === undefined ||
    s.supplyConfluenceState === 'UNKNOWN' ||
    s.supplyConfluenceState === 'UNAVAILABLE'
  ) {
    reasons.push('SUPPLY_NOT_AVAILABLE');
  }
  if (s.sectorEnergyState === undefined) {
    reasons.push('SECTOR_ENERGY_NOT_AVAILABLE');
  }
  if (s.volumeLiquidityPassed === undefined) {
    reasons.push('LIQUIDITY_NOT_AVAILABLE');
  }
  return reasons;
}

/**
 * SEARCH_RECOMMENDATION_PASS (C 규칙, degrade-safe OR). 임계 50/45/40 그대로.
 * degrade 라벨은 호출 측 degradeReasons 에 합류.
 */
function evaluateSearchLane(
  s: CandidateSnapshot,
  rallyLens: MarketRallyLens,
  finalScore: number,
): { pass: boolean; reasons: string[] } {
  const supplyB = supplyBullish(s);
  const momentum = priceMomentumPositive(s);
  const rs = relativeStrengthPositive(s);
  const sector = sectorEnergyVerified(s);
  const liq = liquidityOk(s);
  const reasons = collectSearchDegradeReasons(s);

  const pass =
    finalScore >= 50 ||
    (finalScore >= 45 && (supplyB || momentum || rs || sector)) ||
    (finalScore >= 40 && rallyLens.enabled && liq);

  return { pass, reasons };
}

/**
 * INDEX_RALLY_WATCH_PASS (D 규칙, 차단 경로). providerIssue/dataHold 차단 + finalScore>=40
 * + fresh + health + liqNotFail 조건 그대로. degrade 라벨은 호출 측에 합류.
 */
function evaluateIndexRallyLane(
  s: CandidateSnapshot,
  rallyLens: MarketRallyLens,
  finalScore: number,
  providerIssue: boolean,
  dataHold: boolean,
): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (!rallyLens.enabled) {
    return { pass: false, reasons };
  }
  if (providerIssue) {
    // 불변식#6 — provider 장애는 market signal 이 아니다 (bullish/bearish 변환 금지).
    reasons.push('RALLY_UNKNOWN_PROVIDER_ISSUE');
    return { pass: false, reasons };
  }
  if (dataHold) {
    reasons.push('DATA_HOLD');
    return { pass: false, reasons };
  }

  const fresh = quoteFresh(s);
  const health = sourceHealthVerified(s);
  const liqNotFail = liquidityNotHardFail(s);

  if (!fresh) reasons.push('QUOTE_FRESHNESS_NOT_AVAILABLE');
  if (!health) reasons.push('SOURCE_HEALTH_NOT_AVAILABLE');

  const pass = finalScore >= 40 && fresh && health && liqNotFail;
  return { pass, reasons };
}

/** liveHardPass/searchPass/indexRallyPass → lane 라벨 배열 (없으면 NO_LANE). */
function collectLaneLabels(
  liveHardPass: boolean,
  searchRecommendationPass: boolean,
  indexRallyWatchPass: boolean,
): Gate1LaneLabel[] {
  const laneLabels: Gate1LaneLabel[] = [];
  if (liveHardPass) laneLabels.push('LIVE_HARD_PASS');
  if (searchRecommendationPass) laneLabels.push('SEARCH_RECOMMENDATION_PASS');
  if (indexRallyWatchPass) laneLabels.push('INDEX_RALLY_WATCH_PASS');
  if (laneLabels.length === 0) laneLabels.push('NO_LANE');
  return laneLabels;
}

function evaluateSymbol(
  s: CandidateSnapshot,
  rallyLens: MarketRallyLens,
  providerIssue: boolean,
  dataHold: boolean,
): Gate1SymbolLaneResult {
  const degradeReasons: string[] = [];

  // ── requiredScore: read-only, override/완화 금지 ──
  const requiredScore = s.minSignalRequiredScore ?? LEGACY_GATE1_REQUIRED_SCORE;

  // ── LIVE_HARD_PASS: 미러식 1줄 (헬퍼 위임, 식 글자단위 보존) ──
  const liveHardPass = mirrorLiveHardPass(s);

  // ── finalScore: read-only (= gateScore). 부재 → 전 lane false ──
  const finalScore = isFiniteNumber(s.gateScore) ? s.gateScore : null;
  const scoreGap = finalScore !== null ? finalScore - requiredScore : null;

  if (finalScore === null) {
    degradeReasons.push('FINAL_SCORE_NOT_AVAILABLE');
  }

  // ── SEARCH_RECOMMENDATION_PASS (C 규칙, degrade-safe OR) ──
  let searchRecommendationPass = false;
  if (finalScore !== null) {
    const search = evaluateSearchLane(s, rallyLens, finalScore);
    degradeReasons.push(...search.reasons);
    searchRecommendationPass = search.pass;
  }

  // ── INDEX_RALLY_WATCH_PASS (D 규칙, 차단 경로) ──
  let indexRallyWatchPass = false;
  if (finalScore !== null) {
    const indexRally = evaluateIndexRallyLane(s, rallyLens, finalScore, providerIssue, dataHold);
    degradeReasons.push(...indexRally.reasons);
    indexRallyWatchPass = indexRally.pass;
  }

  // ── lane 라벨 집계 ──
  const laneLabels = collectLaneLabels(liveHardPass, searchRecommendationPass, indexRallyWatchPass);

  return {
    symbol: s.symbol,
    finalScore,
    requiredScore,
    scoreGap,
    liveHardPass,
    searchRecommendationPass,
    indexRallyWatchPass,
    laneLabels,
    degradeReasons,
  };
}

/**
 * Gate1 lane-split read-model 산출. 새 provider 호출 0건 — materialized read만.
 *
 * - ENV OFF(미설정 포함) 또는 rallyLens.enabled===false → enabled:false (lane 전부 비활성).
 * - 활성 시 CandidateSnapshot[] 순회: LIVE_HARD_PASS(미러식) / SEARCH(C) / INDEX_RALLY(D) 산출.
 * - buySignal:false · executionImpact:'NONE' · recommendationOnly:true 리터럴 고정.
 * - Gate1 평가 파이프라인/score/required 0줄 변경 (LIVE_HARD_PASS_BYTE_IDENTICAL).
 */
export function buildGate1LaneResult(input: Gate1LaneResultInput): Gate1LaneResult {
  const asOf = input.asOf ?? new Date().toISOString();

  if (!isMarketRallyLensEnabled() || input.rallyLens.enabled === false) {
    return disabledLaneResult(asOf, input.snapshotId);
  }

  const providerIssue = input.providerIssue === true;
  const dataHold = input.dataHold === true;

  const symbols = input.candidateSnapshots.map((s) =>
    evaluateSymbol(s, input.rallyLens, providerIssue, dataHold),
  );

  let liveHardPassCount = 0;
  let searchRecommendationPassCount = 0;
  let indexRallyWatchPassCount = 0;
  for (const r of symbols) {
    if (r.liveHardPass) liveHardPassCount += 1;
    if (r.searchRecommendationPass) searchRecommendationPassCount += 1;
    if (r.indexRallyWatchPass) indexRallyWatchPassCount += 1;
  }

  return {
    enabled: true,
    symbols,
    liveHardPassCount,
    searchRecommendationPassCount,
    indexRallyWatchPassCount,
    buySignal: false,
    executionImpact: 'NONE',
    recommendationOnly: true,
    snapshotId: input.snapshotId,
    asOf,
  };
}
