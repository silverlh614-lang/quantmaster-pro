/**
 * @responsibility ADR-0477 semantic source adapter helpers.
 */

import type { NaverInvestorTrendCollectorResult } from '../naverInvestorTrendCollectorAdr0481.js';
import type { SemanticNetBuyNormalizationReportAdr0482, SemanticNetBuyProvider, SemanticNetBuySampleAdr0482, SemanticNetBuyStatus } from '../semanticNetBuyNormalizerAdr0482.js';
import type { FreshDataSupplyReportAdr0487, FreshDataSnapshotAdr0487 } from '../freshDataSupplyLayerAdr0487.js';
import type { SupplySnapshotCacheLookupAdr0491 } from '../supplySnapshotStoreReplayAdr0491.js';
import { normalizeInvestorFlowSnapshotKeyAdr0491, normalizeInvestorFlowSourceKeyAdr0491 as normalizeInvestorFlowSourceKeySharedAdr0491 } from '../investorFlowSnapshotKeyNormalizerAdr0491.js';
import {
  buildInvestorSampleDiagnosticsAdr0502,
  formatInvestorSampleDiagnosticsAdr0502,
  type InvestorSampleDiagnosticsAdr0502,
  type InvestorSampleProviderNameAdr0502,
} from '../investorSampleMaterializationAdr0502.js';
import { buildSanitizedInvestorFlowSemanticRow, hasActualInvestorNumericRow, normalizeNumberLikeInvestorFlowValue, unwrapInvestorFlowRows, type SanitizedInvestorFlowSemanticRow } from '../../../supply/investorFlowSemanticAvailability.js';
import type { InvestorFlowProviderId, InvestorFlowProviderStatus, SemanticNetBuySample } from './types.js';
import {
  confidenceForStatus,
  deriveSignal,
  mapSemanticNetBuyStatusAdr0482ToAdr0477,
  normalizeStatus,
  stringOrNull,
  valueFromAliases,
} from './primitives.js';

export type InvestorFlowSource = 'NAVER_INVESTOR_TREND' | 'SEMANTIC_NETBUY' | 'CACHE' | 'KRX_INVESTOR_FLOW' | 'KRX_SYMBOL_INVESTOR_FLOW' | 'KRX_MARKET_INVESTOR_FLOW' | 'KIS_API';

const INVESTOR_FLOW_SOURCE_ALIASES: Record<string, InvestorFlowSource> = {
  NAVER: 'NAVER_INVESTOR_TREND',
  NAVER_INVESTOR_TREND: 'NAVER_INVESTOR_TREND',
  SEMANTIC_NETBUY: 'SEMANTIC_NETBUY',
  SEMANTICNETBUY: 'SEMANTIC_NETBUY',
  'SEMANTIC NETBUY': 'SEMANTIC_NETBUY',
  CACHE: 'CACHE',
  KRX: 'KRX_INVESTOR_FLOW',
  KRX_INVESTOR_FLOW: 'KRX_INVESTOR_FLOW',
  KRX_SYMBOL_INVESTOR_FLOW: 'KRX_SYMBOL_INVESTOR_FLOW',
  KRX_MARKET_INVESTOR_FLOW: 'KRX_MARKET_INVESTOR_FLOW',
  KIS: 'KIS_API',
  KIS_API: 'KIS_API',
};

export function normalizeInvestorFlowSourceKey(input: string): InvestorFlowSource | 'UNKNOWN' {
  return normalizeInvestorFlowSourceKeySharedAdr0491(input) as InvestorFlowSource | 'UNKNOWN';
}

export function providerFromSemanticAdr0482(provider: SemanticNetBuyProvider): InvestorFlowProviderId {
  const normalized = normalizeInvestorFlowSourceKey(provider);
  if (normalized !== 'UNKNOWN') return normalized;
  if (provider === 'FSS' || provider === 'MANUAL' || provider === 'UNKNOWN') return provider;
  return 'UNKNOWN';
}

export function semanticNetBuyDiagnosticCandidate(report: SemanticNetBuyNormalizationReportAdr0482): SemanticNetBuySampleAdr0482 | null {
  return [...report.samples]
    .filter((sample) => (sample.status === 'VERIFIED' || sample.status === 'PARTIAL' || sample.status === 'STALE') && sample.confidence !== 'NONE')
    .sort((a, b) => {
      const confidenceScore = (value: SemanticNetBuySampleAdr0482['confidence']) => value === 'HIGH' ? 4 : value === 'MEDIUM' ? 3 : value === 'LOW' ? 2 : 0;
      const statusScore = (value: SemanticNetBuySampleAdr0482['status']) => value === 'VERIFIED' ? 4 : value === 'PARTIAL' ? 3 : value === 'STALE' ? 1 : 0;
      return (statusScore(b.status) + confidenceScore(b.confidence)) - (statusScore(a.status) + confidenceScore(a.confidence));
    })[0] ?? null;
}

export function semanticNetBuyFreshCandidate(report: SemanticNetBuyNormalizationReportAdr0482): SemanticNetBuySampleAdr0482 | null {
  const selected = report.selectedSample;
  if (!selected) return null;
  return selected.status === 'VERIFIED' || selected.status === 'PARTIAL' ? selected : null;
}

export function sampleFromSemanticAdr0482(sample: SemanticNetBuySampleAdr0482): SemanticNetBuySample {
  return {
    code: sample.code,
    source: providerFromSemanticAdr0482(sample.provider),
    sourceDate: sample.sourceDate,
    collectedAt: sample.collectedAt,
    foreignNetBuy: sample.foreignNetBuy,
    institutionNetBuy: sample.institutionNetBuy,
    programNetBuy: sample.programNetBuy,
    confidence: sample.confidence,
    status: mapSemanticNetBuyStatusAdr0482ToAdr0477(sample.status),
    signal: sample.signal,
    diagnostics: sample.diagnostics,
  };
}

export function mapNaverAdr0481StatusToAdr0477(status: NaverInvestorTrendCollectorResult['status']): InvestorFlowProviderStatus {
  switch (status) {
    case 'DATA_AVAILABLE':
      return 'VERIFIED';
    case 'WIRED':
      return 'DATA_UNAVAILABLE';
    case 'PARTIAL':
      return 'PARTIAL';
    case 'STALE':
      return 'STALE';
    case 'EMPTY':
      return 'EMPTY';
    case 'PARSE_ERROR':
      return 'PARSE_ERROR';
    case 'PROVIDER_ERROR':
      return 'PROVIDER_ERROR';
    case 'NON_TRADING_DAY':
      return 'NON_TRADING_DAY';
    case 'DISABLED':
    case 'DATA_UNAVAILABLE':
      return 'DATA_UNAVAILABLE';
    default:
      return 'DATA_UNAVAILABLE';
  }
}
