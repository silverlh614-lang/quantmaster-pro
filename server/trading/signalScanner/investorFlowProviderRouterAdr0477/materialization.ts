/**
 * @responsibility ADR-0503 investor flow materialization helpers.
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
import type {
  ActualInvestorFlowCarryAdr0477,
  InvestorFlowFlatRowForGateAdr0513,
  InvestorFlowMaterializedCandidateAdr0503,
  InvestorFlowMaterializedSourceKindAdr0503,
  InvestorFlowProviderId,
  InvestorFlowProviderStatus,
  SemanticNetBuySample,
} from './types.js';
import { providerIdFromMaterializationAdr0477 } from './primitives.js';

export function normalizedInvestorRowFromSemanticAdr0477(row: SanitizedInvestorFlowSemanticRow | null | undefined): Record<string, unknown> | null {
  if (!row) return null;
  const normalized: Record<string, unknown> = {
    symbol: row.symbol,
    provider: row.provider,
    providerScope: row.providerScope,
  };
  if (row.foreignNetBuy !== null) normalized.foreignNetBuy = row.foreignNetBuy;
  if (row.institutionalNetBuy !== null) normalized.institutionNetBuy = row.institutionalNetBuy;
  if (row.individualNetBuy !== null) normalized.individualNetBuy = row.individualNetBuy;
  if (row.netBuyAmount !== null) normalized.netBuyAmount = row.netBuyAmount;
  if (row.netBuyVolume !== null) normalized.netBuyVolume = row.netBuyVolume;
  return normalized;
}

export function buildInvestorFlowFlatRowForGate(
  semanticRow: SanitizedInvestorFlowSemanticRow | null | undefined,
): InvestorFlowFlatRowForGateAdr0513 | null {
  if (semanticRow == null) return null;
  const toNumber = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };
  const row = semanticRow as SanitizedInvestorFlowSemanticRow & { institutionNetBuy?: unknown; programNetBuy?: unknown };
  const foreignNetBuy = toNumber(row.foreignNetBuy);
  const institutionNetBuy = toNumber(row.institutionNetBuy ?? row.institutionalNetBuy);
  const programNetBuy = toNumber(row.programNetBuy);
  if (foreignNetBuy == null && institutionNetBuy == null) return null;
  return { foreignNetBuy, institutionNetBuy, programNetBuy, _source: 'ROUTER_EXTRACTED' };
}

export function supplyRowKeysAdr0477(row: unknown): string[] {
  return row && typeof row === 'object' && !Array.isArray(row) ? Object.keys(row as Record<string, unknown>) : [];
}

export function supplyNumericKeysAdr0477(row: unknown): string[] {
  return row && typeof row === 'object' && !Array.isArray(row)
    ? Object.entries(row as Record<string, unknown>)
      .filter(([, value]) => normalizeNumberLikeInvestorFlowValue(value) !== null)
      .map(([key]) => key)
    : [];
}

export interface InvestorFlowDiagnosticUsableCandidateAdr0504 {
  provider: InvestorFlowProviderId;
  status: InvestorFlowProviderStatus;
  reason: string;
  source: 'FRESH_DATA_AGGREGATE' | 'CACHE_LOOKUP' | 'MATERIALIZED_SHADOW';
}

function collectInvestorFlowMaterializedCandidates(
  materializationDiagnostics: Partial<Record<InvestorSampleProviderNameAdr0502, InvestorSampleDiagnosticsAdr0502>>,
  samplesByProvider: Partial<Record<InvestorFlowProviderId, SemanticNetBuySample>>,
  actualRowCarryByProvider: Partial<Record<InvestorFlowProviderId, ActualInvestorFlowCarryAdr0477>> = {},
): InvestorFlowMaterializedCandidateAdr0503[] {
  // ADR-0542 — KIS-first 명시 재정렬. KIS investor-trade-by-stock-daily(FHPTJ04160001, L1)이
  // 사실상 1차 공급원이며(KRX OTP 구조적 차단 시 자동 선택) 표시 fallbackChain 과도 정합한다.
  // 정합 범위(quality-guard 검증): kisFirstMode=true(ADR-0503, KRX 차단 운영상태)에서는 KRX 가
  // rank 필터에서 탈락하므로 priority 무관·byte-equivalent. kisFirstMode=false(KRX 정상) 且
  // KIS·KRX 동시 materialized 케이스에서는 본 재정렬로 KIS 가 우선 선택된다 — 의도된 KIS-first
  // 동작이며(양쪽 L1, SHADOW_ONLY, executionImpact=NONE, live 무영향) 표시·귀속 라벨만 바뀐다.
  const priority: Record<string, number> = {
    KIS_API: 1,
    KRX_SYMBOL_INVESTOR_FLOW: 2,
    KRX_INVESTOR_FLOW: 3,
    KRX_MARKET_INVESTOR_FLOW: 4,
    FSS_PASSIVE_ACTIVE: 5,
    NAVER_INVESTOR_TREND: 6,
    CACHE: 7,
    SEMANTIC_NETBUY: 8,
  };
  const sourceKind: Record<string, InvestorFlowMaterializedSourceKindAdr0503> = {
    KIS_API: 'KIS_SYMBOL_INVESTOR_FLOW',
    KRX_SYMBOL_INVESTOR_FLOW: 'KRX_SYMBOL_INVESTOR_FLOW',
    KRX_MARKET_INVESTOR_FLOW: 'KRX_MARKET_INVESTOR_FLOW',
    KRX_INVESTOR_FLOW: 'KRX_PREVIOUS_TRADING_DATE',
    NAVER_INVESTOR_TREND: 'NAVER_PREVIOUS_TRADING_DATE',
    FSS_PASSIVE_ACTIVE: 'FSS_STALE_DIAGNOSTIC',
    CACHE: 'CACHE_SANITIZED_SNAPSHOT',
    SEMANTIC_NETBUY: 'SEMANTIC_DERIVED',
  };
  return Object.values(materializationDiagnostics).map((diag) => {
    const provider = providerIdFromMaterializationAdr0477(diag.providerName);
    const sample = samplesByProvider[provider];
    const actualCarry = actualRowCarryByProvider[provider];
    const freshness: InvestorFlowMaterializedCandidateAdr0503['freshness'] =
      sample?.status === 'STALE' || sample?.status === 'CACHE_STALE_HIT' ? 'STALE'
        : sample?.status === 'VERIFIED' || sample?.status === 'PARTIAL' || sample?.status === 'CACHE_HIT' ? 'FRESH'
          : diag.staleReason ? 'STALE'
            : diag.sampleMaterialized ? 'UNKNOWN' : 'MISSING';
    const candidateUsableForRouter = provider === 'SEMANTIC_NETBUY' ? false : diag.usableForRouter;
    return {
      provider,
      sourceKind: sourceKind[provider] ?? 'SEMANTIC_DERIVED',
      sourceDate: sample?.sourceDate ?? diag.dateCoverage,
      rawCount: diag.rawCount,
      normalizedCount: diag.normalizedCount,
      materializedCount: diag.materializedCount,
      sampleMaterialized: diag.sampleMaterialized,
      usableForRouter: candidateUsableForRouter,
      usableForShadow: diag.sampleMaterialized,
      confidence: sample?.confidence ?? (diag.confidenceLevel === 'VERIFIED' ? 'HIGH' : diag.confidenceLevel === 'PARTIAL' ? 'MEDIUM' : diag.confidenceLevel === 'LOW' || diag.confidenceLevel === 'DEGRADED' ? 'LOW' : 'NONE'),
      freshness,
      blockedReason: diag.blockedReason,
      placeholderDetected: diag.placeholderDetected,
      inputSourceKind: diag.inputSourceKind,
      selectedPriority: priority[provider] ?? 99,
      selectionReason: `${provider} materialized=${diag.sampleMaterialized} usableForRouter=${candidateUsableForRouter} rawCount=${diag.rawCount} normalizedCount=${diag.normalizedCount} materializedCount=${diag.materializedCount} blockedReason=${provider === 'SEMANTIC_NETBUY' && diag.sampleMaterialized ? 'NO_REAL_INPUT_SOURCE' : diag.blockedReason}`,
      ...(actualCarry ? {
        actualInvestorFlowRows: actualCarry.actualInvestorFlowRows,
        actualInvestorFlowRowCount: actualCarry.actualInvestorFlowRowCount,
        actualInvestorFlowRowSourcePath: actualCarry.actualInvestorFlowRowSourcePath,
        actualInvestorFlowFieldKeys: actualCarry.actualInvestorFlowFieldKeys,
        actualInvestorFlowNumericKeys: actualCarry.actualInvestorFlowNumericKeys,
        actualInvestorFlowNumericStringKeys: actualCarry.actualInvestorFlowNumericStringKeys,
        actualInvestorFlowCarried: actualCarry.actualInvestorFlowCarried,
        actualInvestorRow: actualCarry.actualInvestorRow,
        normalizedInvestorRow: actualCarry.normalizedInvestorRow,
        semanticInvestorRow: actualCarry.semanticInvestorRow,
        supplySemanticRow: actualCarry.supplySemanticRow,
        actualRowAvailable: actualCarry.actualRowAvailable,
        normalizedRowAvailable: actualCarry.normalizedRowAvailable,
        semanticRowAvailable: actualCarry.semanticRowAvailable,
        rowCarryPath: actualCarry.rowCarryPath,
        diagnosticActualInvestorRow: actualCarry.diagnosticActualInvestorRow,
        selectedProviderActualInvestorRow: actualCarry.selectedProviderActualInvestorRow,
        actualInvestorRowProvider: actualCarry.actualInvestorRowProvider,
        actualInvestorRowUseScope: actualCarry.actualInvestorRowUseScope,
        investorRowMaterializationClass: actualCarry.investorRowMaterializationClass,
        diagnosticActualInvestorRowFromNormalized: actualCarry.diagnosticActualInvestorRowFromNormalized,
      } : {}),
    };
  });
}

function rankInvestorFlowMaterializedCandidates(
  candidates: readonly InvestorFlowMaterializedCandidateAdr0503[],
): InvestorFlowMaterializedCandidateAdr0503[] {
  return [...candidates]
    .filter((candidate) => candidate.sampleMaterialized && candidate.usableForRouter && !candidate.placeholderDetected)
    .sort((a, b) => a.selectedPriority - b.selectedPriority || b.materializedCount - a.materializedCount);
}

export function buildInvestorFlowMultiSourceMaterialization(
  materializationDiagnostics: Partial<Record<InvestorSampleProviderNameAdr0502, InvestorSampleDiagnosticsAdr0502>>,
  samplesByProvider: Partial<Record<InvestorFlowProviderId, SemanticNetBuySample>>,
  actualRowCarryByProvider: Partial<Record<InvestorFlowProviderId, ActualInvestorFlowCarryAdr0477>> = {},
): {
  candidates: InvestorFlowMaterializedCandidateAdr0503[];
  rankedCandidates: InvestorFlowMaterializedCandidateAdr0503[];
  selectedCandidate: InvestorFlowMaterializedCandidateAdr0503 | null;
  noMaterializedCandidateReason: string | null;
} {
  const candidates = collectInvestorFlowMaterializedCandidates(materializationDiagnostics, samplesByProvider, actualRowCarryByProvider);
  const rankedCandidates = rankInvestorFlowMaterializedCandidates(candidates);
  const selectedCandidate = rankedCandidates[0] ?? null;
  return {
    candidates,
    rankedCandidates,
    selectedCandidate,
    noMaterializedCandidateReason: selectedCandidate ? null : candidates.length === 0
      ? 'NO_PROVIDER_DIAGNOSTICS'
      : candidates.map((candidate) => `${candidate.provider}:${candidate.blockedReason}:materialized=${candidate.materializedCount}`).join('|'),
  };
}
