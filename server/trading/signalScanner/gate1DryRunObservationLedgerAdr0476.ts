// @responsibility ADR-0476 Gate1 dry-run observation ledger; near-miss rows; SHADOW_ONLY, no live execution.
import fs from 'fs';
import path from 'path';
import { DATA_DIR, ensureDataDir } from '../../persistence/paths.js';
import type { CandidateSnapshot } from './entryFilterDecomposition.js';
import type { FinalGate1CalibrationAuditReport } from './gate1FinalCalibration.js';
import type { Gate1PositiveSourceWiringReport } from './gate1PositiveSourceWiringAdr0475.js';
import type { InvestorFlowProviderRouteResult } from './investorFlowProviderRouterAdr0477.js';
import type { NaverInvestorTrendCollectorResult } from './naverInvestorTrendCollectorAdr0481.js';
import type { SemanticNetBuyNormalizationReportAdr0482 } from './semanticNetBuyNormalizerAdr0482.js';
import {
  buildFreshDataSupplyObservationRowAdr0487,
  type FreshDataSupplyReportAdr0487,
} from './freshDataSupplyLayerAdr0487.js';
import {
  buildAdr0488ObservationRows,
  type SectorEnergyAndSupplyUnknownPolicyReportAdr0488,
} from './sectorEnergyMasterSupplyUnknownPolicyAdr0488.js';
import {
  buildSupplyRecoveryRuntimeMountObservationRowAdr0486,
  type SupplyRecoveryRuntimeMountReportAdr0486,
} from './supplyRecoveryRuntimeMountAdr0486.js';
import {
  buildSupplySnapshotObservationRowAdr0491,
  type SupplySnapshotStoreReportAdr0491,
} from './supplySnapshotStoreReplayAdr0491.js';

export type Gate1DryRunObservationSource =
  | 'ADR_0471_UNKNOWN_DIAGNOSTIC_ONLY'
  | 'ADR_0472_SCORING_ALIGNMENT'
  | 'ADR_0475_POSITIVE_SOURCE_WIRING'
  | 'ADR_0477_INVESTOR_FLOW_PROVIDER_ROUTER'
  | 'ADR_0481_NAVER_INVESTOR_TREND_COLLECTOR'
  | 'ADR_0482_SEMANTIC_NETBUY_NORMALIZER'
  | 'ADR_0484_SUPPLY_COVERAGE_RECOVERY'
  | 'ADR_0485_SUPPLY_ADVISORY_READINESS'
  | 'ADR_0486_SUPPLY_RECOVERY_RUNTIME_MOUNT'
  | 'ADR_0487_FRESH_DATA_SUPPLY_LAYER'
  | 'ADR_0488_SECTOR_ENERGY_MASTER_SUPPLY_LINE'
  | 'ADR_0488_SUPPLY_UNKNOWN_POLICY_STABILIZATION'
  | 'ADR_0491_SUPPLY_SNAPSHOT_STORE_REPLAY'
  | 'GATE1_NEAR_MISS'
  | 'COUNTERFACTUAL_UNIVERSE';

export type Gate1DryRunObservationStatus =
  | 'PENDING'
  | 'OBSERVING'
  | 'MATURED_1D'
  | 'MATURED_3D'
  | 'MATURED_5D'
  | 'EXPIRED'
  | 'SKIPPED';

export type Gate1DryRunObservationDecision =
  | 'WOULD_PASS_DRY_RUN'
  | 'NEAR_MISS'
  | 'WOULD_STILL_FAIL'
  | 'PROVIDER_SOFTENED'
  | 'UNKNOWN_DIAGNOSTIC_ONLY'
  | 'POSITIVE_SOURCE_REPAIRED';

export interface Gate1DryRunObservationRow {
  id: string;
  createdAt: string;
  forDate: string;
  source: Gate1DryRunObservationSource;
  symbol: string;
  name?: string;
  actualGate1Passed: boolean;
  actualLiveEligible: false;
  dryRunDecision: Gate1DryRunObservationDecision;
  dryRunScenario: string;
  actualScore?: number;
  dryRunScore?: number;
  requiredScore: number;
  scoreGap?: number;
  providerIssue: boolean;
  marketSignal: boolean;
  sectorEnergyDiagnosticOnly: boolean;
  sellOnly: boolean;
  watchlistUpstreamScore?: number;
  relativeStrengthScore?: number;
  breakoutStructureScore?: number;
  supplyPenalty?: number;
  riskPenalty?: number;
  sectorPenalty?: number;
  entryReferencePrice?: number;
  stopLossPrice?: number;
  targetPrice?: number;
  forwardReturn1D?: number;
  forwardReturn3D?: number;
  forwardReturn5D?: number;
  maxFavorableExcursion5D?: number;
  maxAdverseExcursion5D?: number;
  stopLossTouched?: boolean;
  targetTouched?: boolean;
  observationType?: 'INVESTOR_FLOW_PROVIDER_ROUTER_ADR0477' | 'NAVER_INVESTOR_TREND_COLLECTOR_ADR0481' | 'SEMANTIC_NETBUY_NORMALIZER_ADR0482' | 'SUPPLY_COVERAGE_RECOVERY_ADR0484' | 'SUPPLY_ADVISORY_READINESS_ADR0485' | 'SUPPLY_RECOVERY_RUNTIME_MOUNT_ADR0486' | 'FRESH_DATA_SUPPLY_LAYER_ADR0487' | 'SECTOR_ENERGY_MASTER_SUPPLY_LINE_ADR0488' | 'SUPPLY_UNKNOWN_POLICY_STABILIZATION_ADR0488' | 'SUPPLY_SNAPSHOT_STORE_REPLAY_ADR0491';
  beforeCoverage?: number;
  afterCoverage?: number;
  selectedProvider?: string;
  providerTried?: string[];
  routeStatus?: string;
  routeSignal?: string;
  semanticNetBuyStatus?: string;
  sourceAgeTradingDays?: number | null;
  oldestSourceAgeTradingDays?: number | null;
  providerMismatchCount?: number;
  notWiredCount?: number;
  cacheEmptyCount?: number;
  sourceDate?: string | null;
  availableDays?: number;
  requestedDays?: number;
  foreignAvailable?: number;
  institutionAvailable?: number;
  selectedByAdr0477?: boolean;
  provider?: string;
  confidence?: string;
  unit?: string;
  status: Gate1DryRunObservationStatus;
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: 'OBSERVE' | 'SHADOW_ONLY';
}

export interface Gate1DryRunObservationSummary {
  rowsCreated: number;
  totalRows: number;
  pending: number;
  observing: number;
  matured1D: number;
  matured3D: number;
  matured5D: number;
  sources: Partial<Record<Gate1DryRunObservationSource, number>>;
  outcomeUpdateAvailable: boolean;
  outcomeUpdateReason: 'MARKET_CLOSED' | 'PRICE_CACHE_MISSING' | 'NOT_MATURED' | 'UPDATED';
  liveExecutionAllowed: false;
  executionImpact: 'NONE';
  policyPromotionMode: 'OBSERVE' | 'SHADOW_ONLY';
  nextAction: 'TRACK_1D_3D_5D_FORWARD_RETURNS';
}

export interface Gate1DryRunObservationBuildInput {
  now?: Date;
  forDate: string;
  candidateSnapshots?: readonly CandidateSnapshot[];
  finalGate1Calibration?: FinalGate1CalibrationAuditReport | null;
  gate1PositiveSourceWiring?: Gate1PositiveSourceWiringReport | null;
  investorFlowProviderRouter?: InvestorFlowProviderRouteResult | null;
  naverInvestorTrendAdr0481?: NaverInvestorTrendCollectorResult | null;
  semanticNetBuyNormalizationAdr0482?: SemanticNetBuyNormalizationReportAdr0482 | null;
  supplyRecoveryRuntimeMountAdr0486?: SupplyRecoveryRuntimeMountReportAdr0486 | null;
  freshDataSupplyAdr0487?: FreshDataSupplyReportAdr0487 | null;
  sectorEnergySupplyUnknownAdr0488?: SectorEnergyAndSupplyUnknownPolicyReportAdr0488 | null;
  supplySnapshotStoreReplayAdr0491?: SupplySnapshotStoreReportAdr0491 | null;
  sellOnly?: boolean;
  sectorEnergyDiagnosticOnly?: boolean;
  providerIssue?: boolean;
  marketSignal?: boolean;
  topN?: number;
}

export interface Gate1DryRunObservationOutcomeUpdateResult {
  updated: number;
  pending: number;
  outcomeUpdateAvailable: boolean;
  reason: 'MARKET_CLOSED' | 'PRICE_CACHE_MISSING' | 'NOT_MATURED' | 'UPDATED';
}

export const GATE1_DRY_RUN_OBSERVATION_LEDGER_FILE = path.join(
  DATA_DIR,
  'gate1-dry-run-observation-ledger.json',
);
export const GATE1_DRY_RUN_OBSERVATION_MAX_ROWS = 2_000;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function observationKey(row: Pick<Gate1DryRunObservationRow, 'forDate' | 'symbol' | 'source' | 'dryRunScenario'>): string {
  return `${row.forDate}|${row.symbol}|${row.source}|${row.dryRunScenario}`;
}

function safeSymbol(symbol: string): string {
  return symbol.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || 'UNKNOWN';
}

function makeId(row: Pick<Gate1DryRunObservationRow, 'forDate' | 'symbol' | 'source' | 'dryRunScenario'>): string {
  return `adr0476-${row.forDate}-${safeSymbol(row.symbol)}-${row.source}-${row.dryRunScenario}`.slice(0, 180);
}

function withOptionalScoreFields(
  row: Omit<Gate1DryRunObservationRow, 'id'> & { id?: string },
): Gate1DryRunObservationRow {
  const base = {
    ...row,
    id: row.id ?? makeId(row),
    actualLiveEligible: false as const,
    executionImpact: 'NONE' as const,
    liveExecutionAllowed: false as const,
    policyPromotionMode: 'SHADOW_ONLY' as const,
  };
  return base;
}

function rowFromSnapshot(input: {
  snapshot: CandidateSnapshot;
  nowIso: string;
  forDate: string;
  source: Gate1DryRunObservationSource;
  scenario: string;
  dryRunDecision: Gate1DryRunObservationDecision;
  dryRunScore?: number;
  requiredScore?: number;
  sellOnly: boolean;
  providerIssue: boolean;
  marketSignal: boolean;
  sectorEnergyDiagnosticOnly: boolean;
}): Gate1DryRunObservationRow {
  const requiredScore = input.requiredScore ?? input.snapshot.minSignalRequiredScore ?? 70;
  const actualScore = input.snapshot.gateScore;
  const score = input.dryRunScore ?? actualScore;
  const scoreGap = finite(score) ? round1(score - requiredScore) : undefined;
  return withOptionalScoreFields({
    createdAt: input.nowIso,
    forDate: input.forDate,
    source: input.source,
    symbol: input.snapshot.symbol,
    ...(input.snapshot.name ? { name: input.snapshot.name } : {}),
    actualGate1Passed: input.snapshot.gate1Passed === true,
    actualLiveEligible: false,
    dryRunDecision: input.dryRunDecision,
    dryRunScenario: input.scenario,
    ...(finite(actualScore) ? { actualScore: round1(actualScore) } : {}),
    ...(finite(score) ? { dryRunScore: round1(score) } : {}),
    requiredScore,
    ...(scoreGap !== undefined ? { scoreGap } : {}),
    providerIssue: input.providerIssue || input.snapshot.supplyProviderHealth?.providerIssue === true,
    marketSignal: input.marketSignal || input.snapshot.supplyProviderHealth?.marketSignal === true,
    sectorEnergyDiagnosticOnly: input.sectorEnergyDiagnosticOnly || input.snapshot.sectorEnergyState === 'DIAGNOSTIC_ONLY',
    sellOnly: input.sellOnly,
    status: 'PENDING',
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: 'SHADOW_ONLY',
  });
}

function buildUnknownDiagnosticRows(input: Gate1DryRunObservationBuildInput, nowIso: string): Gate1DryRunObservationRow[] {
  const report = input.finalGate1Calibration;
  if (!report) return [];
  const scenario = report.unknownPolicyScenarios.find((item) => item.scenario === 'UNKNOWN_DIAGNOSTIC_ONLY');
  if (!scenario || scenario.gate1Survivors <= 0) return [];
  const examples: Array<{
    symbol: string;
    name?: string;
    beforeScore: number;
    afterScore: number;
    requiredScore: number;
    reason: string[];
  }> = scenario.survivorExamples.length > 0
    ? scenario.survivorExamples.slice(0, input.topN ?? 5)
    : Array.from({ length: Math.min(scenario.gate1Survivors, input.topN ?? 5) }, (_, index) => ({
        symbol: `ADR0471-${String(index + 1).padStart(2, '0')}`,
        beforeScore: report.bestRepairedNetAvg,
        afterScore: scenario.netScoreAvg,
        requiredScore: report.currentRequiredScore,
        reason: ['UNKNOWN_DIAGNOSTIC_ONLY'],
      }));
  return examples.map((example) => {
    const dryRunScore = finite(example.afterScore) ? example.afterScore : scenario.netScoreAvg;
    const scoreGap = round1(dryRunScore - example.requiredScore);
    return withOptionalScoreFields({
      createdAt: nowIso,
      forDate: input.forDate,
      source: 'ADR_0471_UNKNOWN_DIAGNOSTIC_ONLY',
      symbol: example.symbol,
      ...(example.name ? { name: example.name } : {}),
      actualGate1Passed: false,
      actualLiveEligible: false,
      dryRunDecision: 'UNKNOWN_DIAGNOSTIC_ONLY',
      dryRunScenario: 'UNKNOWN_DIAGNOSTIC_ONLY',
      ...(finite(example.beforeScore) ? { actualScore: round1(example.beforeScore) } : {}),
      dryRunScore: round1(dryRunScore),
      requiredScore: example.requiredScore,
      scoreGap,
      providerIssue: true,
      marketSignal: false,
      sectorEnergyDiagnosticOnly: false,
      sellOnly: input.sellOnly === true,
      supplyPenalty: scenario.pointPenaltyAvg,
      status: 'PENDING',
      executionImpact: 'NONE',
      liveExecutionAllowed: false,
      policyPromotionMode: 'SHADOW_ONLY',
    });
  });
}

function buildPositiveWiringRows(input: Gate1DryRunObservationBuildInput, nowIso: string): Gate1DryRunObservationRow[] {
  const report = input.gate1PositiveSourceWiring;
  if (!report) return [];
  const best = report.dryRunScenarios.find((item) => item.scenario === 'WIRE_ALL_PLUS_DEDUP_PLUS_RISK_SPLIT')
    ?? [...report.dryRunScenarios].sort((a, b) => b.netScoreAvg - a.netScoreAvg)[0];
  if (!best) return [];
  const snapshots = [...(input.candidateSnapshots ?? [])].slice(0, input.topN ?? 5);
  const requiredScore = best.requiredScore || 70;
  const topCount = Math.max(1, Math.min(input.topN ?? 5, snapshots.length || 5));
  const synthetic = snapshots.length > 0
    ? snapshots
    : Array.from({ length: topCount }, (_, index): CandidateSnapshot => ({
        symbol: `ADR0475-${String(index + 1).padStart(2, '0')}`,
        name: `ADR-0475 dry-run candidate ${index + 1}`,
        gateScore: report.beforeNetScoreAvg,
        minSignalRequiredScore: requiredScore,
        gate1Passed: false,
      }));
  return synthetic.slice(0, topCount).map((snapshot, index) => {
    const decay = index * Math.max(0.2, best.scoreRange / Math.max(1, topCount * 2));
    const dryRunScore = round1(Math.max(best.scoreMin, best.scoreMax - decay));
    const gap = round1(dryRunScore - requiredScore);
    return rowFromSnapshot({
      snapshot,
      nowIso,
      forDate: input.forDate,
      source: 'ADR_0475_POSITIVE_SOURCE_WIRING',
      scenario: best.scenario,
      dryRunDecision: gap >= 0 ? 'WOULD_PASS_DRY_RUN' : (gap >= -5 ? 'NEAR_MISS' : 'POSITIVE_SOURCE_REPAIRED'),
      dryRunScore,
      requiredScore,
      sellOnly: input.sellOnly === true,
      providerIssue: input.providerIssue === true,
      marketSignal: input.marketSignal === true,
      sectorEnergyDiagnosticOnly: input.sectorEnergyDiagnosticOnly === true,
    });
  });
}

function buildGateNearMissRows(input: Gate1DryRunObservationBuildInput, nowIso: string): Gate1DryRunObservationRow[] {
  const rows = [...(input.candidateSnapshots ?? [])]
    .filter((snapshot) => finite(snapshot.gateScore))
    .map((snapshot) => {
      const requiredScore = snapshot.minSignalRequiredScore ?? 70;
      const gap = round1((snapshot.gateScore ?? 0) - requiredScore);
      return { snapshot, requiredScore, gap };
    })
    .filter((item) => item.gap >= -10 && item.gap < 0)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, input.topN ?? 5);
  return rows.map((item) => rowFromSnapshot({
    snapshot: item.snapshot,
    nowIso,
    forDate: input.forDate,
    source: 'GATE1_NEAR_MISS',
    scenario: 'ACTUAL_SCORE_GAP_NEAR_MISS',
    dryRunDecision: 'NEAR_MISS',
    dryRunScore: item.snapshot.gateScore,
    requiredScore: item.requiredScore,
    sellOnly: input.sellOnly === true,
    providerIssue: input.providerIssue === true,
    marketSignal: input.marketSignal === true,
    sectorEnergyDiagnosticOnly: input.sectorEnergyDiagnosticOnly === true,
  }));
}

function buildCounterfactualUniverseRows(input: Gate1DryRunObservationBuildInput, nowIso: string): Gate1DryRunObservationRow[] {
  const snapshots = [...(input.candidateSnapshots ?? [])]
    .filter((snapshot) => snapshot.symbol)
    .slice(0, input.topN ?? 5);
  if (snapshots.length === 0) return [];
  return snapshots.map((snapshot) => rowFromSnapshot({
    snapshot,
    nowIso,
    forDate: input.forDate,
    source: 'COUNTERFACTUAL_UNIVERSE',
    scenario: 'BEFORE_BUYLIST_LOOP_SNAPSHOT',
    dryRunDecision: 'WOULD_STILL_FAIL',
    dryRunScore: snapshot.gateScore,
    requiredScore: snapshot.minSignalRequiredScore ?? 70,
    sellOnly: input.sellOnly === true,
    providerIssue: input.providerIssue === true,
    marketSignal: input.marketSignal === true,
    sectorEnergyDiagnosticOnly: input.sectorEnergyDiagnosticOnly === true,
  }));
}

function buildInvestorFlowRouterRows(input: Gate1DryRunObservationBuildInput, nowIso: string): Gate1DryRunObservationRow[] {
  const route = input.investorFlowProviderRouter;
  if (!route) return [];
  return [withOptionalScoreFields({
    createdAt: nowIso,
    forDate: input.forDate,
    source: 'ADR_0477_INVESTOR_FLOW_PROVIDER_ROUTER',
    symbol: route.code,
    actualGate1Passed: false,
    actualLiveEligible: false,
    dryRunDecision: route.signal === 'BULLISH' ? 'PROVIDER_SOFTENED' : 'WOULD_STILL_FAIL',
    dryRunScenario: 'INVESTOR_FLOW_PROVIDER_ROUTER_ADR0477',
    requiredScore: 70,
    providerIssue: route.signal === 'UNKNOWN',
    marketSignal: route.signal === 'BEARISH',
    sectorEnergyDiagnosticOnly: input.sectorEnergyDiagnosticOnly === true,
    sellOnly: input.sellOnly === true,
    observationType: 'INVESTOR_FLOW_PROVIDER_ROUTER_ADR0477',
    beforeCoverage: 0,
    afterCoverage: route.coverage.available,
    selectedProvider: route.selectedProvider,
    providerTried: [...route.providerTried],
    routeStatus: route.status,
    routeSignal: route.signal,
    semanticNetBuyStatus: route.semanticNetBuy?.status ?? 'DATA_UNAVAILABLE',
    sourceAgeTradingDays: route.freshness.sourceAgeTradingDays,
    oldestSourceAgeTradingDays: route.freshness.oldestSourceAgeTradingDays,
    providerMismatchCount: route.coverage.providerMismatch,
    notWiredCount: route.coverage.notWired,
    cacheEmptyCount: route.coverage.missing + (route.freshness.cacheState === 'EMPTY' ? 1 : 0),
    status: 'PENDING',
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: 'SHADOW_ONLY',
  })];
}


function buildNaverInvestorTrendRowsAdr0481(input: Gate1DryRunObservationBuildInput, nowIso: string): Gate1DryRunObservationRow[] {
  const result = input.naverInvestorTrendAdr0481;
  if (!result) return [];
  return [withOptionalScoreFields({
    createdAt: nowIso,
    forDate: input.forDate,
    source: 'ADR_0481_NAVER_INVESTOR_TREND_COLLECTOR',
    symbol: result.code,
    actualGate1Passed: false,
    actualLiveEligible: false,
    dryRunDecision: result.signal === 'BULLISH' ? 'PROVIDER_SOFTENED' : 'WOULD_STILL_FAIL',
    dryRunScenario: 'NAVER_INVESTOR_TREND_COLLECTOR_ADR0481',
    requiredScore: 70,
    providerIssue: result.signal === 'UNKNOWN',
    marketSignal: result.signal === 'BEARISH',
    sectorEnergyDiagnosticOnly: input.sectorEnergyDiagnosticOnly === true,
    sellOnly: input.sellOnly === true,
    observationType: 'NAVER_INVESTOR_TREND_COLLECTOR_ADR0481',
    selectedProvider: 'NAVER',
    providerTried: ['NAVER'],
    routeStatus: result.status,
    routeSignal: result.signal,
    semanticNetBuyStatus: result.semanticNetBuyCandidate?.status ?? 'DATA_UNAVAILABLE',
    sourceDate: result.semanticNetBuyCandidate?.sourceDate ?? result.freshness.lastSourceDate,
    sourceAgeTradingDays: result.freshness.sourceAgeTradingDays,
    availableDays: result.coverage.availableDays,
    requestedDays: result.coverage.requestedDays,
    foreignAvailable: result.coverage.foreignAvailable,
    institutionAvailable: result.coverage.institutionAvailable,
    selectedByAdr0477: input.investorFlowProviderRouter?.selectedProvider === 'NAVER',
    status: 'PENDING',
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: 'SHADOW_ONLY',
  })];
}

function buildSemanticNetBuyNormalizerRowsAdr0482(input: Gate1DryRunObservationBuildInput, nowIso: string): Gate1DryRunObservationRow[] {
  const report = input.semanticNetBuyNormalizationAdr0482;
  if (!report) return [];
  const selected = report.selectedSample;
  return [withOptionalScoreFields({
    createdAt: nowIso,
    forDate: input.forDate,
    source: 'ADR_0482_SEMANTIC_NETBUY_NORMALIZER',
    symbol: report.code,
    actualGate1Passed: false,
    actualLiveEligible: false,
    dryRunDecision: report.signal === 'BULLISH' ? 'PROVIDER_SOFTENED' : 'WOULD_STILL_FAIL',
    dryRunScenario: 'SEMANTIC_NETBUY_NORMALIZER_ADR0482',
    requiredScore: 70,
    providerIssue: selected === null || selected.quality.isProviderIssue,
    marketSignal: report.signal === 'BEARISH',
    sectorEnergyDiagnosticOnly: input.sectorEnergyDiagnosticOnly === true,
    sellOnly: input.sellOnly === true,
    observationType: 'SEMANTIC_NETBUY_NORMALIZER_ADR0482',
    provider: selected?.provider ?? 'NONE',
    selectedProvider: selected?.provider ?? 'NONE',
    providerTried: report.samples.map((sample) => sample.provider),
    routeStatus: report.status,
    routeSignal: report.signal,
    confidence: report.confidence,
    unit: selected?.unit ?? 'UNKNOWN',
    semanticNetBuyStatus: selected?.status ?? report.status,
    sourceDate: selected?.sourceDate ?? null,
    sourceAgeTradingDays: selected?.freshness.sourceAgeTradingDays ?? null,
    availableDays: selected ? 1 : 0,
    requestedDays: 1,
    foreignAvailable: selected?.coverage.foreignAvailable === true ? 1 : 0,
    institutionAvailable: selected?.coverage.institutionAvailable === true ? 1 : 0,
    selectedByAdr0477: input.investorFlowProviderRouter?.selectedProvider === selected?.provider,
    status: 'PENDING',
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: 'SHADOW_ONLY',
  })];
}

function buildSupplyRecoveryRuntimeMountRowsAdr0486(input: Gate1DryRunObservationBuildInput): Gate1DryRunObservationRow[] {
  const report = input.supplyRecoveryRuntimeMountAdr0486;
  if (!report) return [];
  return [withOptionalScoreFields(buildSupplyRecoveryRuntimeMountObservationRowAdr0486(report) as Omit<Gate1DryRunObservationRow, 'id'> & { id?: string })];
}

function buildFreshDataSupplyRowsAdr0487(input: Gate1DryRunObservationBuildInput): Gate1DryRunObservationRow[] {
  const report = input.freshDataSupplyAdr0487;
  if (!report) return [];
  return [withOptionalScoreFields(buildFreshDataSupplyObservationRowAdr0487(report) as Omit<Gate1DryRunObservationRow, 'id'> & { id?: string })];
}

function buildSectorEnergySupplyUnknownRowsAdr0488(input: Gate1DryRunObservationBuildInput): Gate1DryRunObservationRow[] {
  const report = input.sectorEnergySupplyUnknownAdr0488;
  if (!report) return [];
  return buildAdr0488ObservationRows(report).map((row) => (
    withOptionalScoreFields(row as Omit<Gate1DryRunObservationRow, 'id'> & { id?: string })
  ));
}

function buildSupplySnapshotRowsAdr0491(input: Gate1DryRunObservationBuildInput): Gate1DryRunObservationRow[] {
  const report = input.supplySnapshotStoreReplayAdr0491;
  if (!report) return [];
  return [withOptionalScoreFields(buildSupplySnapshotObservationRowAdr0491(report) as Omit<Gate1DryRunObservationRow, 'id'> & { id?: string })];
}

export function buildGate1DryRunObservationRows(input: Gate1DryRunObservationBuildInput): Gate1DryRunObservationRow[] {
  const nowIso = (input.now ?? new Date()).toISOString();
  const rows = [
    ...buildUnknownDiagnosticRows(input, nowIso),
    ...buildPositiveWiringRows(input, nowIso),
    ...buildInvestorFlowRouterRows(input, nowIso),
    ...buildNaverInvestorTrendRowsAdr0481(input, nowIso),
    ...buildSemanticNetBuyNormalizerRowsAdr0482(input, nowIso),
    ...buildSupplyRecoveryRuntimeMountRowsAdr0486(input),
    ...buildFreshDataSupplyRowsAdr0487(input),
    ...buildSectorEnergySupplyUnknownRowsAdr0488(input),
    ...buildSupplySnapshotRowsAdr0491(input),
    ...buildGateNearMissRows(input, nowIso),
    ...buildCounterfactualUniverseRows(input, nowIso),
  ];
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = observationKey(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function loadRows(filePath = GATE1_DRY_RUN_OBSERVATION_LEDGER_FILE): Gate1DryRunObservationRow[] {
  ensureDataDir();
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return Array.isArray(parsed) ? (parsed as Gate1DryRunObservationRow[]) : [];
  } catch {
    return [];
  }
}

function writeRows(rows: Gate1DryRunObservationRow[], filePath = GATE1_DRY_RUN_OBSERVATION_LEDGER_FILE): void {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify(rows.slice(-GATE1_DRY_RUN_OBSERVATION_MAX_ROWS), null, 2));
}

export async function saveGate1DryRunObservationRows(
  rows: readonly Gate1DryRunObservationRow[],
  filePath = GATE1_DRY_RUN_OBSERVATION_LEDGER_FILE,
): Promise<void> {
  if (rows.length === 0) return;
  const existing = loadRows(filePath);
  const byKey = new Map(existing.map((row) => [observationKey(row), row]));
  for (const row of rows) {
    const key = observationKey(row);
    const previous = byKey.get(key);
    byKey.set(key, previous ? { ...row, id: previous.id, createdAt: previous.createdAt } : row);
  }
  writeRows([...byKey.values()], filePath);
}

export async function listGate1DryRunObservationRows(filter: {
  forDate?: string;
  source?: Gate1DryRunObservationSource;
  status?: Gate1DryRunObservationStatus;
} = {}, filePath = GATE1_DRY_RUN_OBSERVATION_LEDGER_FILE): Promise<Gate1DryRunObservationRow[]> {
  return loadRows(filePath).filter((row) =>
    (filter.forDate === undefined || row.forDate === filter.forDate) &&
    (filter.source === undefined || row.source === filter.source) &&
    (filter.status === undefined || row.status === filter.status));
}

export function getGate1DryRunObservationLedgerCount(
  filePath = GATE1_DRY_RUN_OBSERVATION_LEDGER_FILE,
): number {
  return loadRows(filePath).length;
}

export function summarizeGate1DryRunObservationRows(
  rows: readonly Gate1DryRunObservationRow[],
  rowsCreated = rows.length,
): Gate1DryRunObservationSummary {
  const sources: Partial<Record<Gate1DryRunObservationSource, number>> = {};
  for (const row of rows) {
    sources[row.source] = (sources[row.source] ?? 0) + 1;
  }
  const countStatus = (status: Gate1DryRunObservationStatus) => rows.filter((row) => row.status === status).length;
  return {
    rowsCreated,
    totalRows: rows.length,
    pending: countStatus('PENDING'),
    observing: countStatus('OBSERVING'),
    matured1D: countStatus('MATURED_1D'),
    matured3D: countStatus('MATURED_3D'),
    matured5D: countStatus('MATURED_5D'),
    sources,
    outcomeUpdateAvailable: false,
    outcomeUpdateReason: 'NOT_MATURED',
    liveExecutionAllowed: false,
    executionImpact: 'NONE',
    policyPromotionMode: 'SHADOW_ONLY',
    nextAction: 'TRACK_1D_3D_5D_FORWARD_RETURNS',
  };
}

export async function updateGate1DryRunObservationOutcomes(input: {
  now?: Date;
  rows?: readonly Gate1DryRunObservationRow[];
  marketOpen?: boolean;
  priceCacheAvailable?: boolean;
} = {}): Promise<Gate1DryRunObservationOutcomeUpdateResult> {
  const rows = input.rows ? [...input.rows] : loadRows();
  if (input.marketOpen === false) {
    return { updated: 0, pending: rows.length, outcomeUpdateAvailable: false, reason: 'MARKET_CLOSED' };
  }
  if (input.priceCacheAvailable === false) {
    return { updated: 0, pending: rows.length, outcomeUpdateAvailable: false, reason: 'PRICE_CACHE_MISSING' };
  }
  const now = input.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const matured = rows.filter((row) => today > row.forDate);
  if (matured.length === 0) {
    return { updated: 0, pending: rows.length, outcomeUpdateAvailable: false, reason: 'NOT_MATURED' };
  }
  return { updated: 0, pending: rows.length, outcomeUpdateAvailable: true, reason: 'UPDATED' };
}

export function formatGate1DryRunObservationSummary(
  summary?: Gate1DryRunObservationSummary | null,
): string | null {
  if (!summary) return null;
  const sourceLine = (source: Gate1DryRunObservationSource) =>
    `    ${source}: ${summary.sources[source] ?? 0}`;
  return [
    '🧾 Gate1 Dry-run Observation Ledger (ADR-0476)',
    `  rowsCreated: ${summary.rowsCreated}`,
    `  pending: ${summary.pending}`,
    `  observing: ${summary.observing}`,
    `  matured1D: ${summary.matured1D}`,
    `  matured3D: ${summary.matured3D}`,
    `  matured5D: ${summary.matured5D}`,
    '  sources:',
    sourceLine('ADR_0471_UNKNOWN_DIAGNOSTIC_ONLY'),
    sourceLine('ADR_0475_POSITIVE_SOURCE_WIRING'),
    sourceLine('ADR_0477_INVESTOR_FLOW_PROVIDER_ROUTER'),
    sourceLine('ADR_0481_NAVER_INVESTOR_TREND_COLLECTOR'),
    sourceLine('ADR_0482_SEMANTIC_NETBUY_NORMALIZER'),
    sourceLine('ADR_0484_SUPPLY_COVERAGE_RECOVERY'),
    sourceLine('ADR_0485_SUPPLY_ADVISORY_READINESS'),
    sourceLine('GATE1_NEAR_MISS'),
    `  liveExecutionAllowed: ${summary.liveExecutionAllowed}`,
    `  executionImpact: ${summary.executionImpact}`,
    `  nextAction: ${summary.nextAction}`,
  ].join('\n');
}
