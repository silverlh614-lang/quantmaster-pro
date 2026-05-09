// @responsibility ADR-0484 supply coverage recovery observation; SHADOW_ONLY before/after diagnostics only.
import fs from 'fs';
import path from 'path';
import { DATA_DIR, ensureDataDir } from '../../persistence/paths.js';
import type { Gate1DryRunObservationRow, Gate1DryRunObservationSummary } from './gate1DryRunObservationLedgerAdr0476.js';
import type { InvestorFlowProviderRouteResult, SemanticSupplySignal } from './investorFlowProviderRouterAdr0477.js';
import type { NaverInvestorTrendCollectorResult } from './naverInvestorTrendCollectorAdr0481.js';
import type { OperatorActionQueueReport, OperatorActionRootCause } from './operatorActionRouterAdr0480.js';
import type { ScanSummary } from './scanDiagnostics.js';
import type { SemanticNetBuyNormalizationReportAdr0482 } from './semanticNetBuyNormalizerAdr0482.js';
import type { SupplySourceFreshnessReportAdr0483 } from './supplySourceFreshnessAdr0483.js';
import type { InvestorFlowSampleAcquisitionReportAdr0489 } from './investorFlowSampleAcquisitionAdr0489.js';

export type SupplyCoverageRecoveryStatus = 'IMPROVING' | 'STABLE' | 'DEGRADED' | 'INSUFFICIENT_DATA' | 'OBSERVING' | 'UNKNOWN';
export type SupplyCoverageMetricTrend = 'UP' | 'DOWN' | 'FLAT' | 'UNKNOWN';
export type SupplyRecoveryObservationWindow = 'CURRENT_SCAN' | 'LAST_3_SCANS' | 'LAST_5_SCANS' | 'LAST_10_SCANS';

export interface SupplyCoverageSnapshotAdr0484 {
  scanId: string | null;
  timestamp: string;
  universeCount: number | null;
  candidateCount: number | null;
  investorFlow: {
    selectedProvider: string | null;
    selectedProviderNoneCount: number;
    dataUnavailableCount: number;
    unknownSignalCount: number;
    bullishSignalCount: number;
    bearishSignalCount: number;
    neutralSignalCount: number;
    coverageAvailable: number;
    coverageTotal: number;
    coverageRatio: number;
  };
  providerHealth: {
    naverNotWiredCount: number;
    naverDataAvailableCount: number;
    naverDataUnavailableCount: number;
    cacheEmptyCount: number;
    kisProviderMismatchCount: number;
    providerErrorCount: number;
  };
  semanticNetBuy: {
    sampleAvailableCount: number;
    selectedSampleCount: number;
    missingSampleCount: number;
    parseErrorCount: number;
    unitIssueCount: number;
  };
  freshness: {
    staleSourceCount: number;
    freshSourceCount: number;
    oldestSourceAgeTradingDays: number | null;
    refreshRecommendedCount: number;
  };
  operatorActions: {
    p0Count: number;
    p1Count: number;
    p2Count: number;
    p3Count: number;
    investorFlowProviderUnwiredOpen: boolean;
    semanticNetBuyMissingOpen: boolean;
    supplySourceRefreshRecommendedOpen: boolean;
  };
  gateDiagnostics: {
    gate1NearMissCount: number;
    dataBlockedNearMissCount: number;
    positiveSourceCandidateCount: number;
    dryRunObservationRows: number;
  };
}

export interface SupplyCoverageRecoveryDeltaAdr0484 {
  baseline: SupplyCoverageSnapshotAdr0484 | null;
  current: SupplyCoverageSnapshotAdr0484;
  coverageRatioDelta: number | null;
  selectedProviderNoneDelta: number | null;
  dataUnavailableDelta: number | null;
  naverNotWiredDelta: number | null;
  semanticSampleAvailableDelta: number | null;
  staleSourceDelta: number | null;
  p1ActionDelta: number | null;
  gate1NearMissDelta: number | null;
  trend: SupplyCoverageMetricTrend;
  status: SupplyCoverageRecoveryStatus;
  diagnostics: string[];
}

export interface SupplyCoverageRecoveryObservationReportAdr0484 {
  generatedAt: string;
  window: SupplyRecoveryObservationWindow;
  snapshots: SupplyCoverageSnapshotAdr0484[];
  current: SupplyCoverageSnapshotAdr0484 | null;
  baseline: SupplyCoverageSnapshotAdr0484 | null;
  delta: SupplyCoverageRecoveryDeltaAdr0484 | null;
  status: SupplyCoverageRecoveryStatus;
  topImprovedMetrics: string[];
  topRemainingBlockers: string[];
  recommendedNextAction: string[];
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: 'SHADOW_ONLY';
  operatorApprovalRequired: true;
  diagnostics: string[];
}

export interface BuildSupplyCoverageSnapshotInputAdr0484 {
  scanId?: string | null;
  timestamp?: string;
  universeCount?: number | null;
  candidateCount?: number | null;
  scanSummary?: ScanSummary | null;
  investorFlowProviderRouterAdr0477?: InvestorFlowProviderRouteResult | null;
  naverInvestorTrendAdr0481?: NaverInvestorTrendCollectorResult | null;
  semanticNetBuyNormalizationAdr0482?: SemanticNetBuyNormalizationReportAdr0482 | null;
  supplySourceFreshnessAdr0483?: SupplySourceFreshnessReportAdr0483 | null;
  operatorActionQueueAdr0480?: OperatorActionQueueReport | null;
  gate1DryRunObservationLedgerAdr0476?: Gate1DryRunObservationSummary | null;
  gate1DryRunObservationRowsAdr0476?: readonly Gate1DryRunObservationRow[] | null;
  investorFlowSampleAcquisitionAdr0489?: InvestorFlowSampleAcquisitionReportAdr0489 | null;
  positiveSourceCandidateCount?: number | null;
}

export interface BuildSupplyCoverageRecoveryObservationReportInputAdr0484 extends BuildSupplyCoverageSnapshotInputAdr0484 {
  currentSnapshot?: SupplyCoverageSnapshotAdr0484 | null;
  baselineSnapshot?: SupplyCoverageSnapshotAdr0484 | null;
  priorSnapshots?: readonly SupplyCoverageSnapshotAdr0484[] | null;
  window?: SupplyRecoveryObservationWindow;
  persist?: boolean;
  persistenceFile?: string;
}

const POLICY = {
  executionImpact: 'NONE' as const,
  liveExecutionAllowed: false as const,
  policyPromotionMode: 'SHADOW_ONLY' as const,
  operatorApprovalRequired: true as const,
};

export const SUPPLY_COVERAGE_RECOVERY_OBSERVATIONS_FILE_ADR0484 = path.join(DATA_DIR, 'supply-coverage-recovery-observations.json');
export const SUPPLY_COVERAGE_RECOVERY_MAX_SNAPSHOTS_ADR0484 = 10;

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function ratio(available: number, total: number): number {
  return total > 0 ? Math.round((available / total) * 100) / 100 : 0;
}

function signalCounts(signal?: SemanticSupplySignal | string | null): Pick<SupplyCoverageSnapshotAdr0484['investorFlow'], 'unknownSignalCount' | 'bullishSignalCount' | 'bearishSignalCount' | 'neutralSignalCount'> {
  return {
    unknownSignalCount: signal === 'UNKNOWN' || !signal ? 1 : 0,
    bullishSignalCount: signal === 'BULLISH' ? 1 : 0,
    bearishSignalCount: signal === 'BEARISH' ? 1 : 0,
    neutralSignalCount: signal === 'NEUTRAL' ? 1 : 0,
  };
}

function actionRootOpen(report: OperatorActionQueueReport | null | undefined, root: OperatorActionRootCause): boolean {
  return (report?.allActions ?? []).some((action) => action.rootCause === root && action.status !== 'RESOLVED');
}

export function buildSupplyCoverageSnapshotAdr0484(input: BuildSupplyCoverageSnapshotInputAdr0484 = {}): SupplyCoverageSnapshotAdr0484 {
  const diagnostics: string[] = [];
  const router = input.investorFlowProviderRouterAdr0477 ?? input.scanSummary?.investorFlowProviderRouter ?? null;
  const naver = input.naverInvestorTrendAdr0481 ?? null;
  const semantic = input.semanticNetBuyNormalizationAdr0482 ?? null;
  const freshness = input.supplySourceFreshnessAdr0483 ?? null;
  const probe = input.investorFlowSampleAcquisitionAdr0489 ?? input.scanSummary?.investorFlowSampleAcquisitionAdr0489 ?? null;
  const actions = input.operatorActionQueueAdr0480 ?? null;
  const ledger = input.gate1DryRunObservationLedgerAdr0476 ?? input.scanSummary?.gate1DryRunObservationLedger ?? null;
  const ledgerRows = input.gate1DryRunObservationRowsAdr0476 ?? [];
  if (!router) diagnostics.push('ADR-0477 investor-flow provider router input missing; counts defaulted safely.');
  if (!semantic) diagnostics.push('ADR-0482 semantic net-buy input missing; semantic availability defaults to missing.');
  if (!freshness) diagnostics.push('ADR-0483 source freshness input missing; freshness counts defaulted safely.');

  const selectedProvider = probe?.selectedProvider && probe.selectedProvider !== 'NONE' ? probe.selectedProvider : (router?.selectedProvider ?? null);
  const coverageAvailable = Math.max(num(router?.coverage.available), probe ? Math.round(probe.coverageRatio * 4) : 0);
  const coverageTotal = Math.max(num(router?.coverage.total), probe ? 4 : 0);
  const signals = signalCounts(router?.signal ?? semantic?.signal ?? naver?.signal ?? 'UNKNOWN');
  const naverStatus = naver?.status ?? router?.providerStatuses?.NAVER;
  const naverAvailable = naverStatus === 'VERIFIED' || naverStatus === 'PARTIAL' || naverStatus === 'STALE';
  const semanticSamples = semantic?.samples ?? [];
  const semanticAvailable = semanticSamples.filter((sample) => sample.status === 'VERIFIED' || sample.status === 'PARTIAL').length + (probe?.sampleAcquired ? 1 : 0);
  const rows = freshness?.rows ?? [];
  const gateNearMiss = num(input.scanSummary?.gateScoreCandidateBuckets?.totalNearMissLike) + ledgerRows.filter((row) => row.dryRunDecision === 'NEAR_MISS').length;

  return {
    scanId: input.scanId ?? input.scanSummary?.time ?? null,
    timestamp: input.timestamp ?? input.scanSummary?.time ?? new Date().toISOString(),
    universeCount: input.universeCount ?? null,
    candidateCount: input.candidateCount ?? input.scanSummary?.candidates ?? null,
    investorFlow: {
      selectedProvider,
      selectedProviderNoneCount: selectedProvider === 'NONE' || selectedProvider === null ? 1 : 0,
      dataUnavailableCount: router?.status === 'DATA_UNAVAILABLE' || semantic?.status === 'DATA_UNAVAILABLE' || naver?.status === 'DATA_UNAVAILABLE' || probe?.overallStatus === 'DATA_UNAVAILABLE' ? 1 : 0,
      ...signals,
      coverageAvailable,
      coverageTotal,
      coverageRatio: ratio(coverageAvailable, coverageTotal),
    },
    providerHealth: {
      naverNotWiredCount: naverStatus === 'NOT_WIRED' || router?.coverage.notWired ? num(router?.coverage.notWired, naverStatus === 'NOT_WIRED' ? 1 : 0) : 0,
      naverDataAvailableCount: naverAvailable ? 1 : 0,
      naverDataUnavailableCount: naverStatus === 'DATA_UNAVAILABLE' || naverStatus === 'EMPTY' || naverStatus === 'PROVIDER_ERROR' ? 1 : 0,
      cacheEmptyCount: Object.values(router?.providerStatuses ?? {}).filter((status) => status === 'CACHE_EMPTY').length,
      kisProviderMismatchCount: num(router?.coverage.providerMismatch) + (router?.providerStatuses?.KIS === 'PROVIDER_MISMATCH' ? 1 : 0),
      providerErrorCount: Object.values(router?.providerStatuses ?? {}).filter((status) => status === 'ERROR' || status === 'PROVIDER_ERROR').length + (naver?.status === 'PROVIDER_ERROR' ? 1 : 0),
    },
    semanticNetBuy: {
      sampleAvailableCount: semanticAvailable,
      selectedSampleCount: semantic?.selectedSample ? 1 : 0,
      missingSampleCount: semantic ? (semantic.selectedSample ? 0 : 1) : 1,
      parseErrorCount: semanticSamples.filter((sample) => sample.status === 'PARSE_ERROR' || !sample.quality.parseOk).length,
      unitIssueCount: semanticSamples.filter((sample) => !sample.quality.unitNormalized).length,
    },
    freshness: {
      staleSourceCount: rows.filter((row) => row.sourceState === 'STALE' || row.sourceState === 'MISSING' || row.providerIssue).length,
      freshSourceCount: rows.filter((row) => row.sourceState === 'FRESH').length,
      oldestSourceAgeTradingDays: freshness?.oldestSourceAgeTradingDays ?? router?.freshness.oldestSourceAgeTradingDays ?? null,
      refreshRecommendedCount: rows.filter((row) => row.refreshStatus === 'RECOMMENDED' || row.refreshStatus === 'PROVIDER_FAILED').length + (freshness?.refreshStatus === 'RECOMMENDED' ? 1 : 0),
    },
    operatorActions: {
      p0Count: (actions?.allActions ?? []).filter((action) => action.priority === 'P0').length,
      p1Count: (actions?.allActions ?? []).filter((action) => action.priority === 'P1').length,
      p2Count: (actions?.allActions ?? []).filter((action) => action.priority === 'P2').length,
      p3Count: (actions?.allActions ?? []).filter((action) => action.priority === 'P3').length,
      investorFlowProviderUnwiredOpen: actionRootOpen(actions, 'INVESTOR_FLOW_PROVIDER_UNWIRED'),
      semanticNetBuyMissingOpen: actionRootOpen(actions, 'SEMANTIC_NETBUY_MISSING'),
      supplySourceRefreshRecommendedOpen: actionRootOpen(actions, 'SUPPLY_SOURCE_REFRESH_RECOMMENDED'),
    },
    gateDiagnostics: {
      gate1NearMissCount: gateNearMiss,
      dataBlockedNearMissCount: num(input.scanSummary?.gateScoreCandidateBuckets?.counts?.DATA_BLOCKED_NEAR_MISS),
      positiveSourceCandidateCount: input.positiveSourceCandidateCount ?? num(input.scanSummary?.positiveScoreStarvation?.totalCandidates),
      dryRunObservationRows: ledger?.totalRows ?? ledgerRows.length,
    },
  };
}

function delta(current: number, baseline?: number | null): number | null {
  return baseline === null || baseline === undefined ? null : Math.round((current - baseline) * 100) / 100;
}

function buildDelta(current: SupplyCoverageSnapshotAdr0484, baseline: SupplyCoverageSnapshotAdr0484 | null, snapshotCount: number): SupplyCoverageRecoveryDeltaAdr0484 {
  const d = {
    coverageRatioDelta: baseline ? delta(current.investorFlow.coverageRatio, baseline.investorFlow.coverageRatio) : null,
    selectedProviderNoneDelta: baseline ? delta(current.investorFlow.selectedProviderNoneCount, baseline.investorFlow.selectedProviderNoneCount) : null,
    dataUnavailableDelta: baseline ? delta(current.investorFlow.dataUnavailableCount, baseline.investorFlow.dataUnavailableCount) : null,
    naverNotWiredDelta: baseline ? delta(current.providerHealth.naverNotWiredCount, baseline.providerHealth.naverNotWiredCount) : null,
    semanticSampleAvailableDelta: baseline ? delta(current.semanticNetBuy.sampleAvailableCount, baseline.semanticNetBuy.sampleAvailableCount) : null,
    staleSourceDelta: baseline ? delta(current.freshness.staleSourceCount, baseline.freshness.staleSourceCount) : null,
    p1ActionDelta: baseline ? delta(current.operatorActions.p1Count, baseline.operatorActions.p1Count) : null,
    gate1NearMissDelta: baseline ? delta(current.gateDiagnostics.gate1NearMissCount, baseline.gateDiagnostics.gate1NearMissCount) : null,
  };
  const improving = [d.coverageRatioDelta !== null && d.coverageRatioDelta > 0, d.naverNotWiredDelta !== null && d.naverNotWiredDelta < 0, d.dataUnavailableDelta !== null && d.dataUnavailableDelta < 0, d.semanticSampleAvailableDelta !== null && d.semanticSampleAvailableDelta > 0, d.staleSourceDelta !== null && d.staleSourceDelta < 0, d.p1ActionDelta !== null && d.p1ActionDelta < 0].filter(Boolean).length;
  const degraded = [d.coverageRatioDelta !== null && d.coverageRatioDelta < 0, d.dataUnavailableDelta !== null && d.dataUnavailableDelta > 0, d.selectedProviderNoneDelta !== null && d.selectedProviderNoneDelta > 0, d.staleSourceDelta !== null && d.staleSourceDelta > 0, d.p1ActionDelta !== null && d.p1ActionDelta > 0].filter(Boolean).length;
  const status: SupplyCoverageRecoveryStatus = !baseline ? (snapshotCount <= 2 ? 'OBSERVING' : 'INSUFFICIENT_DATA') : improving >= 2 ? 'IMPROVING' : degraded >= 2 ? 'DEGRADED' : 'STABLE';
  const trend: SupplyCoverageMetricTrend = d.coverageRatioDelta === null ? 'UNKNOWN' : d.coverageRatioDelta > 0 ? 'UP' : d.coverageRatioDelta < 0 ? 'DOWN' : 'FLAT';
  return { baseline, current, ...d, trend, status, diagnostics: [`improvingSignals=${improving}`, `degradedSignals=${degraded}`, 'ADR-0484 is diagnostic-only; UNKNOWN is not converted to bullish and provider issues are not bearish.'] };
}

function loadSnapshots(filePath: string): SupplyCoverageSnapshotAdr0484[] {
  try {
    ensureDataDir();
    if (!fs.existsSync(filePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed as SupplyCoverageSnapshotAdr0484[] : [];
  } catch { return []; }
}

export function saveSupplyCoverageRecoverySnapshotAdr0484(snapshot: SupplyCoverageSnapshotAdr0484, filePath = SUPPLY_COVERAGE_RECOVERY_OBSERVATIONS_FILE_ADR0484): void {
  try {
    ensureDataDir();
    const snapshots = [...loadSnapshots(filePath), snapshot].slice(-SUPPLY_COVERAGE_RECOVERY_MAX_SNAPSHOTS_ADR0484);
    fs.writeFileSync(filePath, JSON.stringify(snapshots, null, 2));
  } catch (error) {
    console.warn('[ADR-0484] snapshot persistence failed; observation remains in-memory only:', error);
  }
}

function topImproved(d: SupplyCoverageRecoveryDeltaAdr0484 | null): string[] {
  if (!d) return [];
  const pairs: Array<[string, boolean]> = [
    ['coverageRatio', (d.coverageRatioDelta ?? 0) > 0], ['NAVER_NOT_WIRED', (d.naverNotWiredDelta ?? 0) < 0], ['DATA_UNAVAILABLE', (d.dataUnavailableDelta ?? 0) < 0], ['semanticSampleAvailable', (d.semanticSampleAvailableDelta ?? 0) > 0], ['staleSource', (d.staleSourceDelta ?? 0) < 0], ['P1_actions', (d.p1ActionDelta ?? 0) < 0],
  ];
  return pairs.filter(([, ok]) => ok).map(([name]) => name);
}

function remainingBlockers(current: SupplyCoverageSnapshotAdr0484 | null): string[] {
  if (!current) return ['NO_CURRENT_SNAPSHOT'];
  const out: string[] = [];
  if (current.investorFlow.selectedProviderNoneCount > 0) out.push('selectedProvider=NONE');
  if (current.investorFlow.dataUnavailableCount > 0) out.push('DATA_UNAVAILABLE');
  if (current.providerHealth.naverNotWiredCount > 0) out.push('NAVER_NOT_WIRED');
  if (current.semanticNetBuy.missingSampleCount > 0) out.push('SEMANTIC_NETBUY_MISSING');
  if (current.freshness.staleSourceCount > 0) out.push('STALE_SOURCE');
  if (current.operatorActions.p1Count + current.operatorActions.p2Count > 0) out.push('P1_P2_OPERATOR_ACTIONS_OPEN');
  return out;
}

export function buildSupplyCoverageRecoveryObservationReportAdr0484(input: BuildSupplyCoverageRecoveryObservationReportInputAdr0484 = {}): SupplyCoverageRecoveryObservationReportAdr0484 {
  try {
    const current = input.currentSnapshot ?? buildSupplyCoverageSnapshotAdr0484(input);
    const fileSnapshots = input.persist ? loadSnapshots(input.persistenceFile ?? SUPPLY_COVERAGE_RECOVERY_OBSERVATIONS_FILE_ADR0484) : [];
    const snapshots = [...(input.priorSnapshots ?? fileSnapshots), current].slice(-SUPPLY_COVERAGE_RECOVERY_MAX_SNAPSHOTS_ADR0484);
    const baseline = input.baselineSnapshot ?? snapshots.at(0) ?? null;
    const effectiveBaseline = input.baselineSnapshot ? baseline : (baseline === current ? null : baseline);
    const d = buildDelta(current, effectiveBaseline, snapshots.length);
    if (input.persist) saveSupplyCoverageRecoverySnapshotAdr0484(current, input.persistenceFile);
    const improved = topImproved(d);
    const blockers = remainingBlockers(current);
    return {
      generatedAt: input.timestamp ?? new Date().toISOString(),
      window: input.window ?? (snapshots.length >= 5 ? 'LAST_5_SCANS' : snapshots.length >= 3 ? 'LAST_3_SCANS' : 'CURRENT_SCAN'),
      snapshots,
      current,
      baseline: effectiveBaseline,
      delta: d,
      status: d.status,
      topImprovedMetrics: improved,
      topRemainingBlockers: blockers,
      recommendedNextAction: d.status === 'IMPROVING'
        ? ['continue SHADOW_ONLY observation', 'do not promote to ADVISORY without future ADR/operator approval']
        : d.status === 'DEGRADED'
          ? ['keep P1/P2 actions open', 'verify NAVER source availability + semantic fallback + source refresh']
          : ['collect 3 scans before promotion discussion'],
      ...POLICY,
      diagnostics: [...d.diagnostics, 'No raw provider payloads are persisted by ADR-0484.'],
    };
  } catch (error) {
    return { generatedAt: new Date().toISOString(), window: input.window ?? 'CURRENT_SCAN', snapshots: [], current: null, baseline: null, delta: null, status: 'UNKNOWN', topImprovedMetrics: [], topRemainingBlockers: ['OBSERVATION_FAILURE_ISOLATED'], recommendedNextAction: ['continue scan; inspect ADR-0484 diagnostic failure'], ...POLICY, diagnostics: ['ADR-0484 observation failure isolated.', error instanceof Error ? error.message : String(error)] };
  }
}

export function formatSupplyCoverageRecoveryCompactAdr0484(report: SupplyCoverageRecoveryObservationReportAdr0484 | null | undefined): string | null {
  if (!report?.current) return null;
  const cur = report.current;
  const coverage = `${cur.investorFlow.coverageAvailable}/${cur.investorFlow.coverageTotal}`;
  const d = report.delta;
  const deltaText = d?.coverageRatioDelta === null || d?.coverageRatioDelta === undefined ? 'baseline=pending' : `Δcoverage=${d.coverageRatioDelta >= 0 ? '+' : ''}${d.coverageRatioDelta.toFixed(2)}`;
  const blockerText = report.status === 'IMPROVING' ? 'blockers↓' : report.status === 'DEGRADED' ? 'dataUnavailable↑' : report.topRemainingBlockers[0] ?? 'baseline=pending';
  return `📈 ADR-0484 SupplyRecovery: ${report.status} | coverage=${coverage} | ${deltaText} | ${blockerText} | impact=${report.executionImpact}`;
}

export function formatSupplyCoverageRecoveryDetailAdr0484(report: SupplyCoverageRecoveryObservationReportAdr0484): string {
  const cur = report.current;
  return [
    '📈 ADR-0484 Supply Coverage Recovery Observation',
    `status=${report.status} window=${report.window} executionImpact=${report.executionImpact} liveExecutionAllowed=${report.liveExecutionAllowed} policyPromotionMode=${report.policyPromotionMode}`,
    cur ? `current: coverage=${cur.investorFlow.coverageAvailable}/${cur.investorFlow.coverageTotal} ratio=${cur.investorFlow.coverageRatio} selectedProvider=${cur.investorFlow.selectedProvider ?? 'UNKNOWN'} dataUnavailable=${cur.investorFlow.dataUnavailableCount} naverNotWired=${cur.providerHealth.naverNotWiredCount} semanticAvailable=${cur.semanticNetBuy.sampleAvailableCount} staleSource=${cur.freshness.staleSourceCount} p1=${cur.operatorActions.p1Count}` : 'current: none',
    report.baseline ? `baseline: coverage=${report.baseline.investorFlow.coverageAvailable}/${report.baseline.investorFlow.coverageTotal} ratio=${report.baseline.investorFlow.coverageRatio}` : 'baseline: pending',
    report.delta ? `delta: coverage=${report.delta.coverageRatioDelta ?? 'NA'} selectedProviderNone=${report.delta.selectedProviderNoneDelta ?? 'NA'} dataUnavailable=${report.delta.dataUnavailableDelta ?? 'NA'} naverNotWired=${report.delta.naverNotWiredDelta ?? 'NA'} semanticSample=${report.delta.semanticSampleAvailableDelta ?? 'NA'} staleSource=${report.delta.staleSourceDelta ?? 'NA'} p1=${report.delta.p1ActionDelta ?? 'NA'} gate1NearMiss=${report.delta.gate1NearMissDelta ?? 'NA'}` : 'delta: none',
    `topImprovedMetrics: ${report.topImprovedMetrics.join(', ') || 'none'}`,
    `topRemainingBlockers: ${report.topRemainingBlockers.join(', ') || 'none'}`,
    `recommendedNextAction: ${report.recommendedNextAction.join('; ')}`,
    `guardrails: operatorApprovalRequired=${report.operatorApprovalRequired}; no live execution changes; no CORE/ADVISORY promotion`,
  ].join('\n');
}

export interface SupplyCoverageRecoveryDetailRegistryEntryAdr0484 {
  adr: '0484';
  sectionId: 'supply_coverage_recovery';
  commandHint: '/supply_health_detail';
  scanBlockersDetailHint: '/scan_blockers_detail supply_coverage_recovery';
  adrTraceHint: '/adr_trace 0484';
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  render: () => string;
}

export function getSupplyCoverageRecoveryDetailRegistryEntryAdr0484(report: SupplyCoverageRecoveryObservationReportAdr0484): SupplyCoverageRecoveryDetailRegistryEntryAdr0484 {
  return { adr: '0484', sectionId: 'supply_coverage_recovery', commandHint: '/supply_health_detail', scanBlockersDetailHint: '/scan_blockers_detail supply_coverage_recovery', adrTraceHint: '/adr_trace 0484', executionImpact: 'NONE', liveExecutionAllowed: false, render: () => formatSupplyCoverageRecoveryDetailAdr0484(report) };
}

export function buildSupplyCoverageRecoveryObservationRowAdr0484(report: SupplyCoverageRecoveryObservationReportAdr0484): Partial<Gate1DryRunObservationRow> | null {
  if (!report.current) return null;
  return {
    id: `adr0484-${report.current.scanId ?? report.generatedAt}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 180),
    createdAt: report.generatedAt,
    forDate: report.generatedAt.slice(0, 10),
    source: 'ADR_0484_SUPPLY_COVERAGE_RECOVERY' as Gate1DryRunObservationRow['source'],
    symbol: 'SUPPLY_COVERAGE',
    actualGate1Passed: false,
    actualLiveEligible: false,
    dryRunDecision: 'UNKNOWN_DIAGNOSTIC_ONLY',
    dryRunScenario: 'SUPPLY_COVERAGE_RECOVERY_ADR0484',
    requiredScore: 70,
    providerIssue: report.topRemainingBlockers.length > 0,
    marketSignal: false,
    sectorEnergyDiagnosticOnly: false,
    sellOnly: false,
    observationType: 'SUPPLY_COVERAGE_RECOVERY_ADR0484' as Gate1DryRunObservationRow['observationType'],
    beforeCoverage: report.baseline?.investorFlow.coverageAvailable ?? undefined,
    afterCoverage: report.current.investorFlow.coverageAvailable,
    selectedProvider: report.current.investorFlow.selectedProvider ?? undefined,
    status: 'OBSERVING',
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: 'SHADOW_ONLY',
  };
}
