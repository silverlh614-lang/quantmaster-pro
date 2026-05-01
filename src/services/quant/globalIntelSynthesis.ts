/**
 * @responsibility ADR-0153 Phase 3 globalIntel 합성 — riskOnEnvironment / cycleVerified /
 * policyAlignment 3 키 격상의 *순수 함수 SSOT*. enrichment 가 zustand store 에서 가져온
 * context 를 입력받아 #5/#1/#16 점수를 합성한다. 호출자 무관 단위 테스트 가능.
 */

import type { MacroEnvironment, MarketRegimeClassifierResult } from '../../types/macro';
import type { BearRegimeResult } from '../../types/bear';
import type { SectorEnergyResult } from '../../types/sectorEnergy';

/**
 * Phase 3 합성 입력 — useGlobalIntelStore 의 4 레이어 발췌.
 *
 * 모두 옵셔널 — 부재 시 fallback (호출자 stock.checklist 보존).
 */
export interface GlobalIntelSynthesisCtx {
  macroEnv?: MacroEnvironment | null;
  bearRegimeResult?: BearRegimeResult | null;
  marketRegimeResult?: MarketRegimeClassifierResult | null;
  sectorEnergyResult?: SectorEnergyResult | null;
}

/**
 * #5 riskOnEnvironment ← Risk-On 시장 환경 합성.
 *
 * 임계 (모두 충족 시 1):
 * - bearRegimeResult.defenseMode = false (방어 모드 아님)
 * - macroEnv.vkospi < 25 (변동성 안정)
 * - marketRegimeResult.classification ∈ ['RISK_ON_BULL', 'RISK_ON_EARLY']
 *   (RISK_OFF_CORRECTION/RISK_OFF_CRISIS 는 위험회피 — 0)
 *
 * ctx 부재 시 null 반환 (호출자 stock.checklist 보존).
 */
export function synthesizeRiskOnEnvironment(ctx: GlobalIntelSynthesisCtx): number | null {
  const { macroEnv, bearRegimeResult, marketRegimeResult } = ctx;
  // 셋 다 부재 시 합성 불가 — null fallback
  if (!macroEnv && !bearRegimeResult && !marketRegimeResult) return null;

  // bearRegimeResult.defenseMode=true 시 즉시 0 (시장 위험 회피)
  if (bearRegimeResult?.defenseMode === true) return 0;

  // macroEnv.vkospi 임계 — undefined 시 임계 미적용 (불충분 데이터)
  const vkospi = macroEnv?.vkospi;
  const vkospiOk = typeof vkospi === 'number' && Number.isFinite(vkospi) && vkospi < 25;

  // marketRegimeResult.classification 임계 — RISK_OFF_* 시 0
  const cls = marketRegimeResult?.classification;
  const regimeOk =
    cls === undefined ? true : cls === 'RISK_ON_BULL' || cls === 'RISK_ON_EARLY';

  // 데이터 부재 (vkospi 미수신) 또는 RISK_OFF → 0, 둘 다 만족 → 1
  if (!vkospiOk || !regimeOk) return 0;
  return 1;
}

/**
 * #1 cycleVerified ← 주도주 사이클 합성.
 *
 * 임계 (모두 충족 시 1):
 * - marketRegimeResult.classification ∈ ['RISK_ON_BULL', 'RISK_ON_EARLY'] (강세 사이클)
 * - sectorEnergyResult.leadingSectors.length ≥ 1 (주도 섹터 형성됨)
 *
 * ctx 부재 시 null 반환.
 */
export function synthesizeCycleVerified(ctx: GlobalIntelSynthesisCtx): number | null {
  const { marketRegimeResult, sectorEnergyResult } = ctx;
  if (!marketRegimeResult && !sectorEnergyResult) return null;

  // marketRegimeResult.classification ∈ ['RISK_ON_BULL', 'RISK_ON_EARLY']
  const cls = marketRegimeResult?.classification;
  const isRiskOn = cls === 'RISK_ON_BULL' || cls === 'RISK_ON_EARLY';
  // sectorEnergyResult.leadingSectors 1개 이상
  const hasLeader = (sectorEnergyResult?.leadingSectors?.length ?? 0) >= 1;

  if (isRiskOn && hasLeader) return 1;
  return 0;
}

/**
 * #16 policyAlignment ← 정책/매크로 부합 합성.
 *
 * 임계 (3 조건 중 ≥ 2 충족 시 1):
 * - bokRateDirection ∈ ['HOLDING', 'CUTTING'] (긴축 아님 — 자산 친화적)
 * - nominalGdpGrowth > 0 (명목 GDP 성장 중)
 * - oeciCliKorea ≥ 100 (경기 선행지수 100 이상 — 경기 확장)
 *
 * ctx.macroEnv 부재 시 null 반환.
 */
export function synthesizePolicyAlignment(ctx: GlobalIntelSynthesisCtx): number | null {
  const { macroEnv } = ctx;
  if (!macroEnv) return null;

  let pass = 0;
  // 1. bokRateDirection
  if (macroEnv.bokRateDirection === 'HOLDING' || macroEnv.bokRateDirection === 'CUTTING') pass += 1;
  // 2. nominalGdpGrowth
  if (typeof macroEnv.nominalGdpGrowth === 'number' && Number.isFinite(macroEnv.nominalGdpGrowth) && macroEnv.nominalGdpGrowth > 0) pass += 1;
  // 3. oeciCliKorea
  if (typeof macroEnv.oeciCliKorea === 'number' && Number.isFinite(macroEnv.oeciCliKorea) && macroEnv.oeciCliKorea >= 100) pass += 1;

  return pass >= 2 ? 1 : 0;
}

/**
 * 합성 결과 진단용 헬퍼 — 3 키 동시 산출.
 */
export interface GlobalIntelSynthesisResult {
  riskOnEnvironment: number | null;
  cycleVerified: number | null;
  policyAlignment: number | null;
}

export function synthesizeAllGlobalIntel(ctx: GlobalIntelSynthesisCtx): GlobalIntelSynthesisResult {
  return {
    riskOnEnvironment: synthesizeRiskOnEnvironment(ctx),
    cycleVerified: synthesizeCycleVerified(ctx),
    policyAlignment: synthesizePolicyAlignment(ctx),
  };
}
