/**
 * @responsibility ADR-0657 pure normalizer — KIS estimate(HHPTJ04160200) → SHADOW-only fallback sample. No fetch/store/now.
 */

import type {
  InvestorFlowProviderRouterInput,
  SemanticNetBuySample,
  SemanticSupplySignal,
} from './types.js';

/**
 * supplyPack 이 이미 수집한 추정수급 형상(kisOfficialSupplyPack.investorFlowEstimate, 라인 68-74).
 * 본 모듈은 신규 KIS 호출을 하지 않는다 — 수집된 값만 SHADOW sample 로 변환(불변식 #9·providerImpact=NONE).
 */
export interface KisInvestorTrendEstimateInputAdr0657 {
  foreignNetBuyEstimate?: number;
  institutionalNetBuyEstimate?: number;
  individualNetBuyEstimate?: number;
  confidence?: 'ESTIMATED' | 'MISSING';
  useScope?: 'ADVISORY' | 'SHADOW_ONLY' | 'DIAGNOSTIC_ONLY';
  sourceDate?: string | null;
}

/**
 * 라우터 input 에 additive·optional 로 실릴 수 있는 추정수급 캐리어. types.ts(계약 확정) 는 import 만 하므로
 * 본 모듈이 input 확장 형상을 소유한다 — flag OFF/미공급 시 unset → byte-identical.
 */
export type InvestorFlowRouterInputWithEstimateAdr0657 = InvestorFlowProviderRouterInput & {
  kisInvestorTrendEstimateAdr0657?: KisInvestorTrendEstimateInputAdr0657 | null;
};

export function readKisInvestorTrendEstimateInputAdr0657(
  input: InvestorFlowProviderRouterInput,
): KisInvestorTrendEstimateInputAdr0657 | null {
  const estimate = (input as InvestorFlowRouterInputWithEstimateAdr0657).kisInvestorTrendEstimateAdr0657;
  return estimate ?? null;
}

function finiteNumberOrNull(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * 추정수급 가용 여부. estimate 미가용(null·confidence MISSING·세 필드 전무) = false → 호출부 graceful null.
 * 추정 결손은 bearish 가 아니다(불변식 #6) — 호출부는 UNKNOWN 을 보존한다.
 */
export function isKisInvestorTrendEstimateMaterializedAdr0657(
  estimate: KisInvestorTrendEstimateInputAdr0657 | null | undefined,
): boolean {
  if (!estimate) return false;
  if (estimate.confidence === 'MISSING') return false;
  return (
    finiteNumberOrNull(estimate.foreignNetBuyEstimate) !== null ||
    finiteNumberOrNull(estimate.institutionalNetBuyEstimate) !== null ||
    finiteNumberOrNull(estimate.individualNetBuyEstimate) !== null
  );
}

/**
 * 순수 변환: 추정수급 → SHADOW-only SemanticNetBuySample.
 * - confidence='LOW' 고정(추정 grade — 불변식 #7: live/gate-score 진입 금지).
 * - status='OBSERVING'(shadow 관측 표본 · selectedProvider 후보 아님).
 * - signal 은 결손이면 UNKNOWN 보존(불변식 #6: 추정 결손 ≠ bearish). 가용 시에도 저신뢰라 NEUTRAL/UNKNOWN 만.
 * estimate 미가용 시 null 반환(graceful).
 */
export function buildKisInvestorTrendEstimateShadowSampleAdr0657(
  estimate: KisInvestorTrendEstimateInputAdr0657 | null | undefined,
  opts: { code: string; collectedAt: string },
): SemanticNetBuySample | null {
  if (!isKisInvestorTrendEstimateMaterializedAdr0657(estimate)) return null;
  const foreignNetBuy = finiteNumberOrNull(estimate?.foreignNetBuyEstimate);
  const institutionNetBuy = finiteNumberOrNull(estimate?.institutionalNetBuyEstimate);
  const individualNetBuy = finiteNumberOrNull(estimate?.individualNetBuyEstimate);
  // estimate grade — 저신뢰이므로 BULLISH/BEARISH 로 단정하지 않는다(불변식 #6). 결손은 UNKNOWN.
  const signal: SemanticSupplySignal = 'UNKNOWN';
  return {
    code: opts.code,
    source: 'KIS_INVESTOR_TREND_ESTIMATE',
    sourceDate: estimate?.sourceDate ?? null,
    collectedAt: opts.collectedAt,
    foreignNetBuy,
    institutionNetBuy,
    programNetBuy: individualNetBuy,
    confidence: 'LOW',
    status: 'OBSERVING',
    signal,
    diagnostics: [
      'source=KIS_INVESTOR_TREND_ESTIMATE',
      'useScope=SHADOW_ONLY_ESTIMATE',
      'confidence=LOW',
      'useForLive=false; useForGate=false; useForShadow=true; executionImpact=NONE',
      'ADR-0657 KIS estimate(HHPTJ04160200) SHADOW-only fallback; selectedProvider unchanged; ADR-0561 daily>estimate.',
      'estimate grade is not bearish; UNKNOWN preserved (invariant #6).',
    ],
  };
}
