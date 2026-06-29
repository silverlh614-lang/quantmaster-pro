/**
 * @responsibility ADR-0477 investor flow route builder — orchestrates prologue, provider blocks, result build.
 */

import type {
  InvestorFlowProviderId,
  InvestorFlowProviderRouteResult,
  InvestorFlowProviderRouterInput,
} from './types.js';
import {
  findFreshDataSnapshotAdr0477,
  freshDataSnapshotSampleAdr0477,
  isKisFirstRebuildModeAdr0477,
  sampleFromCacheLookupAdr0491,
} from './freshDataAdapters.js';
import {
  applyCacheBlockAdr0477,
  applyFssAndFlagsBlockAdr0477,
  applyKisBlockAdr0477,
  applyKisInvestorTrendEstimateBlockAdr0657,
  applyKrxBlockAdr0477,
  applyNaverCollectorBlockAdr0477,
  applyNaverFreshBlockAdr0477,
  applyPendingSelectionBlockAdr0477,
  applySemanticFreshBlockAdr0477,
  applySemanticNormalizationBlockAdr0477,
  createRouteAccumulatorAdr0477,
  type RoutePrologueAdr0477,
} from './routeBlocks.js';
import { buildRouteResultAdr0477 } from './routeResultBuilder.js';
import { isKisInvestorTrendEstimateShadowFallbackEnabled } from '../../gateConfig.js';

export function buildInvestorFlowProviderRouteResultAdr0477(
  input: InvestorFlowProviderRouterInput,
): InvestorFlowProviderRouteResult {
  const collectedAt = input.collectedAt ?? new Date().toISOString();
  const kisFirstMode = isKisFirstRebuildModeAdr0477();
  const providerTried: InvestorFlowProviderId[] = ['KRX_SYMBOL_INVESTOR_FLOW', 'KRX_MARKET_INVESTOR_FLOW', 'KIS_API', 'FSS_PASSIVE_ACTIVE', 'NAVER_INVESTOR_TREND', 'CACHE', 'SEMANTIC_NETBUY'];
  // ADR-0657 — flag ON 시에만 추정수급(HHPTJ04160200)을 providerTried 체인 말미에 SHADOW-only fallback 으로 편입.
  // flag OFF 면 체인 byte-identical(미인지). 체인 표시뿐 — selectedProvider 승격 금지(불변식 #7·ADR-0561).
  if (isKisInvestorTrendEstimateShadowFallbackEnabled()) {
    providerTried.push('KIS_INVESTOR_TREND_ESTIMATE');
  }
  const prologue: RoutePrologueAdr0477 = {
    collectedAt,
    kisFirstMode,
    providerTried,
    naverFreshDataSnapshot: findFreshDataSnapshotAdr0477(input.freshDataSupplyAdr0487, 'NAVER_INVESTOR_TREND'),
    freshNaver: freshDataSnapshotSampleAdr0477(input.freshDataSupplyAdr0487, 'NAVER_INVESTOR_TREND', input.code, collectedAt),
    semanticFreshDataSnapshot: findFreshDataSnapshotAdr0477(input.freshDataSupplyAdr0487, 'SEMANTIC_NETBUY'),
    freshSemantic: freshDataSnapshotSampleAdr0477(input.freshDataSupplyAdr0487, 'SEMANTIC_NETBUY', input.code, collectedAt),
    cacheLookup: input.supplySnapshotCacheLookupAdr0491,
    cacheLookupSample: sampleFromCacheLookupAdr0491(input.supplySnapshotCacheLookupAdr0491, input.code, collectedAt),
  };

  const acc = createRouteAccumulatorAdr0477(input);
  applyNaverFreshBlockAdr0477(acc, input, prologue);
  applySemanticFreshBlockAdr0477(acc, input, prologue);
  applySemanticNormalizationBlockAdr0477(acc, input, prologue);
  applyNaverCollectorBlockAdr0477(acc, input, prologue);
  applyPendingSelectionBlockAdr0477(acc);
  applyCacheBlockAdr0477(acc, input, prologue);
  applyKrxBlockAdr0477(acc, input, prologue);
  applyKisBlockAdr0477(acc, input, prologue);
  applyFssAndFlagsBlockAdr0477(acc, input, prologue);
  // ADR-0657 — KIS block 이후(일별 materialized 여부 확정 후) 호출. flag OFF 면 내부 즉시 return(byte-identical).
  applyKisInvestorTrendEstimateBlockAdr0657(acc, input, prologue);

  return buildRouteResultAdr0477(acc, input, prologue);
}
