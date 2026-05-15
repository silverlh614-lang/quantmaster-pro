/**
 * @responsibility PATCH-010 — Shadow/LIVE 레짐 노출 프로파일 분리 SSOT + 종목별 소액 매수 floor 보정
 *
 * 문제: R2/R3 불싸이클 Shadow 에서 STANDARD 후보의 positionPct 가 멀티플라이어 누적
 *       (R2_BULL kellyMultiplier ×0.8 × STANDARD tier ×0.6 × MTAS ×0.3~0.5 × ...) 으로
 *       0.2~0.5% 까지 축소되어 휴젤(284,000원) 같은 고가주가 1주만 매수되는 과소 사이징.
 *
 * 해결: 레짐별 per-candidate positionPct 하한(floor) 을 둔다.
 *   - SHADOW 프로파일: aggressive — R2/R3 불싸이클(exposure R5_BULL/R4_RECOVERY) floor 1.5~2.0%
 *   - LIVE 프로파일:   conservative — floor 전면 0.0% (현행 동작 100% 보존)
 *
 * 절대 규칙:
 *   1. ENV `SHADOW_BULL_EXPOSURE_FLOOR_ENABLED=true` 활성 시만 동작 (default OFF, ADR-0157 정확 비교).
 *   2. floor 는 soft shrink 뒤에 적용되는 최종 하한 — soft shrink 가 floor 아래로 깎지 못한다.
 *      hard block (SELL_ONLY/emergencyStop/R6_DEFENSE) 은 buyListLoop 진입 전 또는 bull 레짐 외이므로
 *      본 모듈이 floor 를 적용하지 않는다 (bull 레짐 외 floor 0.0).
 *   3. PROBING 티어는 의도된 소액 탐색이므로 floor 미적용.
 *   4. ENV OFF / 미적용 시 effectivePositionPct === computedPositionPct (byte-equivalent).
 */

import { mapInternalToExposureRegime, type MarketRegimeLevel } from './regimeExposurePolicy.js';
import { computeCurrentEquityExposure } from './currentEquityExposure.js';
import type { RegimeLevel } from '../../../src/types/core.js';
import type { SizingTier } from '../sizingTier.js';
import type { ServerShadowTrade } from '../../persistence/shadowTradeRepo.js';

export type ExposureProfileMode = 'SHADOW' | 'LIVE';

export interface RegimeExposureProfile {
  regime: MarketRegimeLevel;
  /** 계좌 총 목표 노출률 — 진단/UI 용 (floor 산출 입력 아님, §17 후속 PR scope) */
  accountTargetExposurePct: number;
  /** 후보 1종목 positionPct 하한 — bull 레짐 한정 (소액 매수 오류 보정) */
  candidateFloorPct: number;
}

/**
 * SHADOW 프로파일 — aggressive.
 * R2/R3 불싸이클(exposure R5_BULL/R4_RECOVERY) 에서 STANDARD 후보 floor 1.5~2.0% 보장.
 * accountTargetExposurePct 는 PATCH-010 spec "R2/R3 80~90%" 정합 (진단용).
 */
export const SHADOW_REGIME_EXPOSURE_PROFILE: Readonly<Record<MarketRegimeLevel, RegimeExposureProfile>> =
  Object.freeze({
    R6_STRONG_BULL: { regime: 'R6_STRONG_BULL', accountTargetExposurePct: 0.90, candidateFloorPct: 0.025 },
    R5_BULL: { regime: 'R5_BULL', accountTargetExposurePct: 0.85, candidateFloorPct: 0.02 },
    R4_RECOVERY: { regime: 'R4_RECOVERY', accountTargetExposurePct: 0.80, candidateFloorPct: 0.015 },
    R3_NEUTRAL: { regime: 'R3_NEUTRAL', accountTargetExposurePct: 0.45, candidateFloorPct: 0.0 },
    R2_WEAK: { regime: 'R2_WEAK', accountTargetExposurePct: 0.30, candidateFloorPct: 0.0 },
    R1_DEFENSIVE: { regime: 'R1_DEFENSIVE', accountTargetExposurePct: 0.20, candidateFloorPct: 0.0 },
    R0_CRISIS: { regime: 'R0_CRISIS', accountTargetExposurePct: 0.0, candidateFloorPct: 0.0 },
  });

/**
 * LIVE 프로파일 — conservative.
 * candidateFloorPct 전면 0.0 → LIVE 경로는 현행 사이징 100% 보존.
 * accountTargetExposurePct 는 ADR-0166 REGIME_EXPOSURE_POLICIES 와 정합 (진단용).
 */
export const LIVE_REGIME_EXPOSURE_PROFILE: Readonly<Record<MarketRegimeLevel, RegimeExposureProfile>> =
  Object.freeze({
    R6_STRONG_BULL: { regime: 'R6_STRONG_BULL', accountTargetExposurePct: 0.85, candidateFloorPct: 0.0 },
    R5_BULL: { regime: 'R5_BULL', accountTargetExposurePct: 0.75, candidateFloorPct: 0.0 },
    R4_RECOVERY: { regime: 'R4_RECOVERY', accountTargetExposurePct: 0.60, candidateFloorPct: 0.0 },
    R3_NEUTRAL: { regime: 'R3_NEUTRAL', accountTargetExposurePct: 0.45, candidateFloorPct: 0.0 },
    R2_WEAK: { regime: 'R2_WEAK', accountTargetExposurePct: 0.30, candidateFloorPct: 0.0 },
    R1_DEFENSIVE: { regime: 'R1_DEFENSIVE', accountTargetExposurePct: 0.20, candidateFloorPct: 0.0 },
    R0_CRISIS: { regime: 'R0_CRISIS', accountTargetExposurePct: 0.0, candidateFloorPct: 0.0 },
  });

/** ENV 우회 SSOT — default OFF, ADR-0157 정확 비교. */
export function isShadowBullExposureFloorEnabled(): boolean {
  return process.env.SHADOW_BULL_EXPOSURE_FLOOR_ENABLED === 'true';
}

/** 모드별 레짐 노출 프로파일 조회 SSOT. */
export function getRegimeExposureProfile(
  mode: ExposureProfileMode,
  regime: RegimeLevel,
): RegimeExposureProfile {
  const exposureRegime = mapInternalToExposureRegime(regime);
  return mode === 'SHADOW'
    ? SHADOW_REGIME_EXPOSURE_PROFILE[exposureRegime]
    : LIVE_REGIME_EXPOSURE_PROFILE[exposureRegime];
}

export interface CandidateFloorInput {
  /** 종목 단위 Shadow 모드 (buyListLoop stockShadowMode) */
  shadowMode: boolean;
  /** 내부 레짐 (RegimeLevel — exposure 레짐으로 자동 매핑) */
  regime: RegimeLevel;
  /** 사이징 티어 (PROBING 은 의도된 소액 탐색 → floor 미적용) */
  tier: SizingTier;
  /** 멀티플라이어 누적 후 산출된 positionPct */
  computedPositionPct: number;
}

export interface CandidateFloorResult {
  /** floor 적용 여부 — false 면 effectivePositionPct === computedPositionPct */
  applied: boolean;
  /** SHADOW vs LIVE 프로파일 */
  mode: ExposureProfileMode;
  /** 매핑된 exposure 레짐 */
  exposureRegime: MarketRegimeLevel;
  /** 해당 모드/레짐 floor (적용 안 돼도 진단용으로 노출) */
  floorPct: number;
  /** Math.max(computedPositionPct, floorPct) — 미적용 시 computedPositionPct 그대로 */
  effectivePositionPct: number;
  /** 미적용 사유 (진단 로그용) */
  skipReason?:
    | 'ENV_DISABLED'
    | 'NO_FLOOR'
    | 'PROBING_TIER_EXCLUDED'
    | 'ALREADY_ABOVE_FLOOR'
    | 'INVALID_POSITION_PCT';
}

/**
 * 후보 positionPct 하한 결정 SSOT.
 *
 * 결정 트리:
 *   1. ENV OFF → applied=false / skipReason='ENV_DISABLED'
 *   2. floorPct <= 0 (bull 레짐 외 또는 LIVE 프로파일) → applied=false / skipReason='NO_FLOOR'
 *   3. tier === 'PROBING' → applied=false / skipReason='PROBING_TIER_EXCLUDED'
 *   4. positionPct 비유한값 → applied=false / skipReason='INVALID_POSITION_PCT' (안전 fallback)
 *   5. positionPct >= floorPct → applied=false / skipReason='ALREADY_ABOVE_FLOOR'
 *   6. 그 외 → applied=true / effectivePositionPct = floorPct
 */
export function resolveCandidatePositionFloor(input: CandidateFloorInput): CandidateFloorResult {
  const mode: ExposureProfileMode = input.shadowMode ? 'SHADOW' : 'LIVE';
  const profile = getRegimeExposureProfile(mode, input.regime);
  const floorPct = profile.candidateFloorPct;
  const base: Omit<CandidateFloorResult, 'applied' | 'effectivePositionPct' | 'skipReason'> = {
    mode,
    exposureRegime: profile.regime,
    floorPct,
  };

  if (!isShadowBullExposureFloorEnabled()) {
    return { ...base, applied: false, effectivePositionPct: input.computedPositionPct, skipReason: 'ENV_DISABLED' };
  }
  if (floorPct <= 0) {
    return { ...base, applied: false, effectivePositionPct: input.computedPositionPct, skipReason: 'NO_FLOOR' };
  }
  if (input.tier === 'PROBING') {
    return {
      ...base,
      applied: false,
      effectivePositionPct: input.computedPositionPct,
      skipReason: 'PROBING_TIER_EXCLUDED',
    };
  }
  if (!Number.isFinite(input.computedPositionPct)) {
    return {
      ...base,
      applied: false,
      effectivePositionPct: input.computedPositionPct,
      skipReason: 'INVALID_POSITION_PCT',
    };
  }
  if (input.computedPositionPct >= floorPct) {
    return {
      ...base,
      applied: false,
      effectivePositionPct: input.computedPositionPct,
      skipReason: 'ALREADY_ABOVE_FLOOR',
    };
  }
  return { ...base, applied: true, effectivePositionPct: floorPct };
}

/**
 * `[AutoTrade/ShadowBullFloor]` 진단 로그 포맷 SSOT — 4 진입 경로 공용.
 *
 * `pathLabel` 미전달 시 메인 buyList 경로 (byte-equivalent),
 * 전달 시 PRE_BREAKOUT_FOLLOWTHROUGH / PRE_BREAKOUT_30PCT / INTRADAY 경로 구분.
 */
export function formatShadowBullFloorLog(
  result: CandidateFloorResult,
  ctx: { stockName: string; stockCode: string; computedPositionPct: number; pathLabel?: string },
): string {
  const path = ctx.pathLabel ? `${ctx.pathLabel} ` : '';
  return (
    `[AutoTrade/ShadowBullFloor] ${ctx.stockName}(${ctx.stockCode}) ${path}positionPct ` +
    `${(ctx.computedPositionPct * 100).toFixed(2)}% → ${(result.effectivePositionPct * 100).toFixed(2)}% ` +
    `(floor ${(result.floorPct * 100).toFixed(1)}%, ${result.mode}/${result.exposureRegime})`
  );
}

// ─── §17 계좌 총 노출 갭 진단 SSOT (diagnostic only — 사이징 경로 미연결) ──────

export interface AccountExposureGapInput {
  /** SHADOW vs LIVE 프로파일 */
  shadowMode: boolean;
  /** 내부 레짐 (RegimeLevel — exposure 레짐으로 자동 매핑) */
  regime: RegimeLevel;
  /** 계좌 총 평가액 (KRW) */
  accountTotalEquity: number;
  /** 활성 trade 영속 (ctx.shadows) — computeCurrentEquityExposure 위임 */
  shadows: ServerShadowTrade[];
  /** 옵셔널 시가 매핑 — 부재 시 보유원가 평가 */
  currentPriceMap?: Map<string, number>;
}

export interface AccountExposureGapResult {
  mode: ExposureProfileMode;
  exposureRegime: MarketRegimeLevel;
  /** accountTargetExposurePct — 레짐별 목표 노출률 */
  targetExposurePct: number;
  /** 현재 활성 trade 평가금액 합산 (computeCurrentEquityExposure) */
  currentExposureAmount: number;
  /** currentExposureAmount / accountTotalEquity (accountTotalEquity ≤ 0 시 0) */
  currentExposurePct: number;
  /** accountTotalEquity × targetExposurePct */
  targetExposureAmount: number;
  /** targetExposureAmount - currentExposureAmount (음수 = over-exposed) */
  exposureGapAmount: number;
  /** currentExposurePct < targetExposurePct */
  underExposed: boolean;
  /** 합산에 포함된 활성 trade 수 */
  activeTradeCount: number;
  /** 진단 전용 마커 — 실제 사이징 경로 입력 아님 (§17 portfolio fill wiring 후속 PR scope) */
  diagnosticOnly: true;
}

/**
 * §17 계좌 총 노출 갭 진단 SSOT.
 *
 * 레짐별 accountTargetExposurePct 와 현재 활성 trade 평가금액 합산(computeCurrentEquityExposure)을
 * 비교해 "계좌가 목표 노출률 대비 얼마나 비어 있는가" 를 산출한다.
 *
 * 절대 규칙:
 *   - 진단 전용 (`diagnosticOnly: true` literal) — 실제 order quantity 를 바꾸지 않는다 (LIVE 매매 본체 0줄 변경).
 *   - portfolio fill 사이징 경로 wiring 은 후속 PR scope (verbatim §17 spec 의무).
 *   - accountTotalEquity 비유한값/≤0 시 currentExposurePct=0 / underExposed=true 보수적 fallback.
 */
export function resolveAccountExposureGap(input: AccountExposureGapInput): AccountExposureGapResult {
  const mode: ExposureProfileMode = input.shadowMode ? 'SHADOW' : 'LIVE';
  const profile = getRegimeExposureProfile(mode, input.regime);
  const targetExposurePct = profile.accountTargetExposurePct;

  const exposure = computeCurrentEquityExposure({
    shadows: input.shadows,
    currentPriceMap: input.currentPriceMap,
  });
  const currentExposureAmount = exposure.totalAmount;

  const accountTotalEquity =
    Number.isFinite(input.accountTotalEquity) && input.accountTotalEquity > 0
      ? input.accountTotalEquity
      : 0;

  const currentExposurePct = accountTotalEquity > 0 ? currentExposureAmount / accountTotalEquity : 0;
  const targetExposureAmount = accountTotalEquity * targetExposurePct;
  const exposureGapAmount = targetExposureAmount - currentExposureAmount;
  const underExposed = currentExposurePct < targetExposurePct;

  return {
    mode,
    exposureRegime: profile.regime,
    targetExposurePct,
    currentExposureAmount,
    currentExposurePct,
    targetExposureAmount,
    exposureGapAmount,
    underExposed,
    activeTradeCount: exposure.activeTradeCount,
    diagnosticOnly: true,
  };
}

// ─── minNotional 보정 진단 SSOT (diagnostic only — 사이징 경로 미연결) ─────────

/** floor division 후 최소 매수 주식 수 — 고가주 0주 silent 드롭 보정 목표. */
export const MIN_CANDIDATE_SHARES = 1;

/**
 * 단일 1주가 계좌 총액의 이 비율을 초과하면 minNotional 보정 미적용.
 * (초고가 1주가 그 자체로 과도한 종목 집중을 만드는 것 차단)
 */
export const MIN_NOTIONAL_PRICE_CEILING_RATIO = 0.05;

export interface MinNotionalSharesInput {
  /** 종목 가격 (KRW) */
  price: number;
  /** positionPct × accountTotalEquity (또는 orderableCash) 기준 예산 (KRW) */
  budgetAmount: number;
  /** 계좌 총 평가액 — 1주 ceiling 검증용 (옵셔널, 미전달 시 ceiling 검증 생략) */
  accountTotalEquity?: number;
}

export interface MinNotionalSharesResult {
  /** Math.floor(budgetAmount / price) */
  rawShares: number;
  /** minNotional 보정 적용 권고 여부 (true 면 effectiveShares=1 권고) */
  minNotionalApplied: boolean;
  /** rawShares 또는 보정된 1 (진단 권고값 — 실제 주문 수량 아님) */
  effectiveShares: number;
  /** 미적용 사유 */
  skipReason?: 'ALREADY_ABOVE_MIN' | 'PRICE_OVER_CEILING' | 'INVALID_INPUT';
}

/**
 * minNotional 보정 진단 SSOT.
 *
 * 근본 결함: `Math.floor(budgetAmount / price)` 가 고가주 + 소액 예산에서 0 을 반환 →
 *           legacyQuantity < 1 → 후보가 silent 드롭. 본 SSOT 는 "1주는 살 수 있었는가" 를 진단한다.
 *
 * 결정 트리:
 *   1. price/budgetAmount 비유한값 또는 ≤ 0 → INVALID_INPUT
 *   2. rawShares >= MIN_CANDIDATE_SHARES → ALREADY_ABOVE_MIN (보정 불필요)
 *   3. accountTotalEquity 전달 + price > accountTotalEquity × ceiling → PRICE_OVER_CEILING
 *      (초고가 1주가 과도한 집중 — 강제 매수 차단)
 *   4. 그 외 (rawShares < 1, price ≤ ceiling) → minNotionalApplied=true / effectiveShares=1
 *
 * 절대 규칙:
 *   - 진단 전용 — 실제 주문 수량을 바꾸지 않는다 (LIVE 매매 본체 0줄 변경).
 *   - 사이징 경로 wiring 은 후속 PR scope (verbatim spec 의무).
 */
export function resolveMinNotionalShares(input: MinNotionalSharesInput): MinNotionalSharesResult {
  const { price, budgetAmount, accountTotalEquity } = input;

  if (!Number.isFinite(price) || !Number.isFinite(budgetAmount) || price <= 0 || budgetAmount <= 0) {
    return { rawShares: 0, minNotionalApplied: false, effectiveShares: 0, skipReason: 'INVALID_INPUT' };
  }

  const rawShares = Math.floor(budgetAmount / price);
  if (rawShares >= MIN_CANDIDATE_SHARES) {
    return { rawShares, minNotionalApplied: false, effectiveShares: rawShares, skipReason: 'ALREADY_ABOVE_MIN' };
  }

  // rawShares < 1 → budgetAmount < price → minNotional 보정 후보. ceiling 검증.
  if (
    accountTotalEquity != null &&
    Number.isFinite(accountTotalEquity) &&
    accountTotalEquity > 0 &&
    price > accountTotalEquity * MIN_NOTIONAL_PRICE_CEILING_RATIO
  ) {
    return { rawShares, minNotionalApplied: false, effectiveShares: rawShares, skipReason: 'PRICE_OVER_CEILING' };
  }

  return { rawShares, minNotionalApplied: true, effectiveShares: MIN_CANDIDATE_SHARES };
}
