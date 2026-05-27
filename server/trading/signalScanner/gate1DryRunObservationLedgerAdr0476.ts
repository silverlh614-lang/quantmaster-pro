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
  type SupplySnapshotReplayResultAdr0491,
} from './supplySnapshotStoreReplayAdr0491.js';
import type { Gate1ScoringAlignmentDryRunGateResult } from './gate1ScoringAlignmentDryRunGateAdr0520.js';

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
  sourceBreakdownCountSum: number;
  unclassifiedSourceRows: number;
  sourceBreakdownInvariant: boolean;
  outcomeUpdateAvailable: boolean;
  outcomeUpdateReason: 'MARKET_CLOSED' | 'PRICE_CACHE_MISSING' | 'NOT_MATURED' | 'UPDATED';
  liveExecutionAllowed: false;
  executionImpact: 'NONE';
  policyPromotionMode: 'OBSERVE' | 'SHADOW_ONLY';
  nextAction: 'TRACK_1D_3D_5D_FORWARD_RETURNS';
}

export interface Gate1EvidenceMaturityStatus {
  schedulerHealthy: boolean;
  status: 'NOT_YET_DUE' | 'DUE_PENDING_RUN' | 'UP_TO_DATE' | 'NO_ROWS';
  pendingD1: number;
  pendingD3: number;
  pendingD5: number;
  dueNow: number;
  stalePending: number;
  nextMaturityRunAt: string;
  lastMaturityRunAt: string;
  dataUnavailable: boolean;
  lastErrorSanitized: string;
  executionImpact: 'NONE';
}

export interface Gate1ThresholdEvidenceSummary {
  sampleWindow: '1D/3D/5D';
  totalSamples: number;
  pendingSamples: number;
  ledgerRowsCreated: number;
  scoreBandCountSum: number;
  evidenceLedgerMatch: boolean;
  scoreBandLedgerMatch: boolean;
  maturity: Gate1EvidenceMaturityStatus;
  matureSamplesD1: number;
  matureSamplesD3: number;
  matureSamplesD5: number;
  bestDryRunThreshold: 70 | 65 | 60;
  recommendedAction: 'OBSERVE_MORE' | 'KEEP_THRESHOLD_70' | 'DRY_RUN_THRESHOLD_65_R3_ONLY' | 'REJECT_THRESHOLD_RELAXATION';
  confidence: 'INSUFFICIENT_SAMPLE' | 'LOW' | 'MEDIUM' | 'HIGH';
  scoreBandTable: Array<{
    band: '70+' | '65~70' | '60~65' | '55~60' | 'below55';
    count: number;
    matureD1: number;
    matureD3: number;
    matureD5: number;
    avgReturnD1: number | 'N/A';
    avgReturnD3: number | 'N/A';
    avgReturnD5: number | 'N/A';
    winRateD5: number | 'N/A';
    hitPlus3PctRate: number | 'N/A';
    hitMinus3PctRate: number | 'N/A';
    avgMFE: number | 'N/A';
    avgMAE: number | 'N/A';
    expectancyR: number | 'N/A';
    falseNegativeRate: number | 'N/A';
  }>;
  liveExecutionImpact: 'NONE';
  thresholdAutoChanged: false;
  operatorApprovalRequired: true;
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
  /** ADR-0520 — DRY_RUN scoring-alignment gate result (ENV-gated, off by default). */
  scoringAlignmentDryRunAdr0520?: Gate1ScoringAlignmentDryRunGateResult | null;
  freshDataSupplyAdr0487?: FreshDataSupplyReportAdr0487 | null;
  sectorEnergySupplyUnknownAdr0488?: SectorEnergyAndSupplyUnknownPolicyReportAdr0488 | null;
  supplySnapshotStoreAdr0491?: SupplySnapshotReplayResultAdr0491 | null;
  sellOnly?: boolean;
  sectorEnergyDiagnosticOnly?: boolean;
  providerIssue?: boolean;
  marketSignal?: boolean;
  topN?: number;
}

export interface Gate1DryRunObservationOutcomeUpdateResult {
  updated: number;
  updatedD1: number;
  updatedD3: number;
  updatedD5: number;
  duplicateSuppressed: number;
  pending: number;
  outcomeUpdateAvailable: boolean;
  reason: 'MARKET_CLOSED' | 'PRICE_CACHE_MISSING' | 'NOT_MATURED' | 'UPDATED';
}

export type Gate1DryRunObservationPriceFetcher = (
  symbol: string,
  asOf: Date,
  row: Gate1DryRunObservationRow,
) => Promise<number | null | undefined> | number | null | undefined;

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

function addBusinessDays(yyyymmdd: string, businessDays: number): string {
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  let added = 0;
  while (added < businessDays) {
    t.setUTCDate(t.getUTCDate() + 1);
    const dow = t.getUTCDay();
    if (dow !== 0 && dow !== 6) added += 1;
  }
  return t.toISOString().slice(0, 10);
}

function pctReturn(entryPrice: number, futurePrice: number): number {
  return Math.round((((futurePrice - entryPrice) / entryPrice) * 100) * 100) / 100;
}

function targetDateAsUtc(targetDate: string): Date {
  return new Date(`${targetDate}T00:00:00.000Z`);
}

function updateStatusForResolvedHorizons(row: Gate1DryRunObservationRow): Gate1DryRunObservationStatus {
  if (finite(row.forwardReturn5D)) return 'MATURED_5D';
  if (finite(row.forwardReturn3D)) return 'MATURED_3D';
  if (finite(row.forwardReturn1D)) return 'MATURED_1D';
  return row.status === 'PENDING' ? 'OBSERVING' : row.status;
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

function buildScoringAlignmentRowsAdr0520(input: Gate1DryRunObservationBuildInput, nowIso: string): Gate1DryRunObservationRow[] {
  const gate = input.scoringAlignmentDryRunAdr0520;
  // Observation-only source; always recorded when present (no ENV toggle). Empty when absent.
  if (!gate) return [];
  // Only the REAL symbols that pass the relaxed curve but fail the live curve.
  const survivors = gate.survivors.slice(0, input.topN ?? 10);
  return survivors.map((survivor) => withOptionalScoreFields({
    createdAt: nowIso,
    forDate: input.forDate,
    source: 'ADR_0472_SCORING_ALIGNMENT',
    symbol: survivor.symbol,
    ...(survivor.name ? { name: survivor.name } : {}),
    // actualGate1Passed reflects the LIVE frozen decision (always false for survivors).
    actualGate1Passed: false,
    actualLiveEligible: false,
    dryRunDecision: 'WOULD_PASS_DRY_RUN',
    dryRunScenario: gate.scenario,
    actualScore: survivor.actualScore,
    dryRunScore: survivor.dryRunScore,
    requiredScore: survivor.requiredScore,
    scoreGap: survivor.scoreGap,
    providerIssue: input.providerIssue === true,
    marketSignal: input.marketSignal === true,
    sectorEnergyDiagnosticOnly: input.sectorEnergyDiagnosticOnly === true,
    sellOnly: input.sellOnly === true,
    breakoutStructureScore: survivor.breakoutStructureScore,
    status: 'PENDING',
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: 'SHADOW_ONLY',
  }));
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


function buildSupplySnapshotRowsAdr0491(input: Gate1DryRunObservationBuildInput): Gate1DryRunObservationRow[] {
  const report = input.supplySnapshotStoreAdr0491;
  if (!report) return [];
  return [withOptionalScoreFields({
    ...buildSupplySnapshotObservationRowAdr0491(report),
    observationType: 'SUPPLY_SNAPSHOT_STORE_REPLAY_ADR0491' as const,
  } as Omit<Gate1DryRunObservationRow, 'id'> & { id?: string })];
}

function buildSectorEnergySupplyUnknownRowsAdr0488(input: Gate1DryRunObservationBuildInput): Gate1DryRunObservationRow[] {
  const report = input.sectorEnergySupplyUnknownAdr0488;
  if (!report) return [];
  return buildAdr0488ObservationRows(report).map((row) => (
    withOptionalScoreFields(row as Omit<Gate1DryRunObservationRow, 'id'> & { id?: string })
  ));
}

export function buildGate1DryRunObservationRows(input: Gate1DryRunObservationBuildInput): Gate1DryRunObservationRow[] {
  const nowIso = (input.now ?? new Date()).toISOString();
  const rows = [
    ...buildUnknownDiagnosticRows(input, nowIso),
    ...buildPositiveWiringRows(input, nowIso),
    ...buildScoringAlignmentRowsAdr0520(input, nowIso),
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
  // Source attribution integrity: every row carries a source, so the breakdown must sum to rowsCreated.
  // unclassified>0 surfaces rows whose source bucket is missing from the breakdown (early detection).
  const sourceBreakdownCountSum = Object.values(sources).reduce((sum, count) => sum + (count ?? 0), 0);
  const unclassifiedSourceRows = Math.max(0, rowsCreated - sourceBreakdownCountSum);
  return {
    rowsCreated,
    totalRows: rows.length,
    pending: countStatus('PENDING'),
    observing: countStatus('OBSERVING'),
    matured1D: countStatus('MATURED_1D'),
    matured3D: countStatus('MATURED_3D'),
    matured5D: countStatus('MATURED_5D'),
    sources,
    sourceBreakdownCountSum,
    unclassifiedSourceRows,
    sourceBreakdownInvariant: unclassifiedSourceRows === 0,
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
  priceFetcher?: Gate1DryRunObservationPriceFetcher;
} = {}): Promise<Gate1DryRunObservationOutcomeUpdateResult> {
  const rows = input.rows ? [...input.rows] : loadRows();
  const persist = input.rows === undefined;
  if (input.marketOpen === false) {
    return { updated: 0, updatedD1: 0, updatedD3: 0, updatedD5: 0, duplicateSuppressed: 0, pending: rows.length, outcomeUpdateAvailable: false, reason: 'MARKET_CLOSED' };
  }
  if (input.priceCacheAvailable === false) {
    return { updated: 0, updatedD1: 0, updatedD3: 0, updatedD5: 0, duplicateSuppressed: 0, pending: rows.length, outcomeUpdateAvailable: false, reason: 'PRICE_CACHE_MISSING' };
  }
  const now = input.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const horizons = [
    { days: 1, field: 'forwardReturn1D', counter: 'updatedD1' },
    { days: 3, field: 'forwardReturn3D', counter: 'updatedD3' },
    { days: 5, field: 'forwardReturn5D', counter: 'updatedD5' },
  ] as const;
  const hasDue = rows.some((row) => horizons.some((horizon) => today >= addBusinessDays(row.forDate, horizon.days)));
  if (!hasDue) {
    return { updated: 0, updatedD1: 0, updatedD3: 0, updatedD5: 0, duplicateSuppressed: 0, pending: rows.length, outcomeUpdateAvailable: false, reason: 'NOT_MATURED' };
  }

  let updatedD1 = 0;
  let updatedD3 = 0;
  let updatedD5 = 0;
  let duplicateSuppressed = 0;
  const fetcher = input.priceFetcher;

  for (const row of rows) {
    const entryPrice = finite(row.entryReferencePrice) && row.entryReferencePrice > 0 ? row.entryReferencePrice : null;
    if (entryPrice === null) continue;
    for (const horizon of horizons) {
      const targetDate = addBusinessDays(row.forDate, horizon.days);
      if (today < targetDate) continue;
      if (finite(row[horizon.field])) {
        duplicateSuppressed += 1;
        continue;
      }
      if (!fetcher) continue;
      const price = await fetcher(row.symbol, targetDateAsUtc(targetDate), row);
      if (!finite(price) || price <= 0) continue;
      row[horizon.field] = pctReturn(entryPrice, price);
      row.status = updateStatusForResolvedHorizons(row);
      if (horizon.counter === 'updatedD1') updatedD1 += 1;
      else if (horizon.counter === 'updatedD3') updatedD3 += 1;
      else updatedD5 += 1;
    }
  }

  const updated = updatedD1 + updatedD3 + updatedD5;
  if (persist && updated > 0) writeRows(rows);
  const pending = rows.filter((row) => row.status === 'PENDING' || row.status === 'OBSERVING').length;
  return {
    updated,
    updatedD1,
    updatedD3,
    updatedD5,
    duplicateSuppressed,
    pending,
    outcomeUpdateAvailable: updated > 0,
    reason: updated > 0 ? 'UPDATED' : 'PRICE_CACHE_MISSING',
  };
}

export function formatGate1DryRunObservationSummary(
  summary?: Gate1DryRunObservationSummary | null,
): string | null {
  if (!summary) return null;
  const lines = [
    '🧾 Gate1 Dry-run Observation Ledger (ADR-0476)',
    `  rowsCreated: ${summary.rowsCreated}`,
    `  pending: ${summary.pending}`,
    `  observing: ${summary.observing}`,
    `  matured1D: ${summary.matured1D}`,
    `  matured3D: ${summary.matured3D}`,
    `  matured5D: ${summary.matured5D}`,
    '  sources:',
  ];
  // Render EVERY source bucket with rows (complete breakdown) so the displayed sum reconciles with
  // rowsCreated — no source type is hidden by a fixed render list.
  const sourceEntries = (Object.entries(summary.sources) as Array<[Gate1DryRunObservationSource, number]>)
    .filter(([, count]) => (count ?? 0) > 0)
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
  if (sourceEntries.length === 0) {
    lines.push('    (none)');
  } else {
    for (const [source, count] of sourceEntries) {
      lines.push(`    ${source}: ${count}`);
    }
  }
  lines.push(
    `  sourceBreakdownCountSum: ${summary.sourceBreakdownCountSum}`,
    `  unclassifiedSourceRows: ${summary.unclassifiedSourceRows}`,
    `  sourceBreakdownInvariant: ${summary.sourceBreakdownInvariant}`,
  );
  if (!summary.sourceBreakdownInvariant) {
    lines.push('  sourceBreakdownNextAction: CLASSIFY_GATE1_EVIDENCE_SOURCE');
  }
  lines.push(
    `  liveExecutionAllowed: ${summary.liveExecutionAllowed}`,
    `  executionImpact: ${summary.executionImpact}`,
    `  nextAction: ${summary.nextAction}`,
  );
  return lines.join('\n');
}

/**
 * Derives the D+1/D+3/D+5 maturity-schedule status from the ledger rows + current date alone
 * (no separate persisted scheduler state). lastMaturityRunAt is not tracked at this layer ⟹ 'N/A'.
 * stalePending>0 ⟹ a horizon was due >2 business days ago yet is still pending (scheduler stalled).
 */
function buildGate1EvidenceMaturityStatus(
  rows: readonly Gate1DryRunObservationRow[],
  now: Date,
): Gate1EvidenceMaturityStatus {
  const base = { lastMaturityRunAt: 'N/A', lastErrorSanitized: 'NONE', executionImpact: 'NONE' } as const;
  if (rows.length === 0) {
    return { ...base, schedulerHealthy: true, status: 'NO_ROWS', pendingD1: 0, pendingD3: 0, pendingD5: 0, dueNow: 0, stalePending: 0, nextMaturityRunAt: 'N/A', dataUnavailable: true };
  }
  const today = now.toISOString().slice(0, 10);
  const horizons = [
    { days: 1, field: 'forwardReturn1D' },
    { days: 3, field: 'forwardReturn3D' },
    { days: 5, field: 'forwardReturn5D' },
  ] as const;
  let pendingD1 = 0;
  let pendingD3 = 0;
  let pendingD5 = 0;
  let dueNow = 0;
  let stalePending = 0;
  const futureDueDates: string[] = [];
  for (const row of rows) {
    for (const horizon of horizons) {
      if (finite(row[horizon.field])) continue;
      if (horizon.days === 1) pendingD1 += 1;
      else if (horizon.days === 3) pendingD3 += 1;
      else pendingD5 += 1;
      const dueDate = addBusinessDays(row.forDate, horizon.days);
      if (today >= dueDate) {
        dueNow += 1;
        if (today >= addBusinessDays(dueDate, 2)) stalePending += 1;
      } else {
        futureDueDates.push(dueDate);
      }
    }
  }
  const anyPending = pendingD1 + pendingD3 + pendingD5 > 0;
  const nextMaturityRunAt = futureDueDates.length > 0
    ? futureDueDates.sort()[0]
    : (dueNow > 0 ? 'DUE_NOW' : 'N/A');
  const status: Gate1EvidenceMaturityStatus['status'] = !anyPending
    ? 'UP_TO_DATE'
    : dueNow > 0 ? 'DUE_PENDING_RUN' : 'NOT_YET_DUE';
  return {
    ...base,
    schedulerHealthy: stalePending === 0,
    status,
    pendingD1,
    pendingD3,
    pendingD5,
    dueNow,
    stalePending,
    nextMaturityRunAt,
    dataUnavailable: false,
  };
}

export function buildGate1ThresholdEvidenceSummary(
  rows: readonly Gate1DryRunObservationRow[],
  now: Date = new Date(),
): Gate1ThresholdEvidenceSummary {
  // ADR-0476 ledger is the primary source — totalSamples/pending reflect ALL observation rows
  // (rowsCreated/pending/observing/matured), not only D5-matured ones, so the Evidence report
  // reconciles with the Gate1 Dry-run Observation Ledger section.
  const ledger = summarizeGate1DryRunObservationRows(rows);
  const totalSamples = ledger.rowsCreated;
  const pendingSamples = ledger.pending;
  const matureD1 = rows.filter((row) => finite(row.forwardReturn1D)).length;
  const matureD3 = rows.filter((row) => finite(row.forwardReturn3D)).length;
  const matureD5 = rows.filter((row) => finite(row.forwardReturn5D)).length;
  // scoreBand membership uses every row's dryRunScore (unscored ⟹ below55) so band counts sum to
  // totalSamples; forward-return/MFE/win-rate stats inside buildBandSummary stay scoped to matured rows.
  const scoreOf = (row: Gate1DryRunObservationRow): number =>
    finite(row.dryRunScore) ? (row.dryRunScore as number) : Number.NEGATIVE_INFINITY;
  const scoreBand = (min: number, max?: number) => rows.filter((row) => {
    const s = scoreOf(row);
    return s >= min && (max === undefined || s < max);
  });
  // Recommendation/confidence remain gated on MATURED outcomes — pending-only rows never relax the gate.
  const matured = rows.filter((row) => finite(row.dryRunScore) && finite(row.forwardReturn5D));
  const matureSampleSize = matured.length;
  const band = (min: number, max?: number) => matured.filter((row) => {
    const s = row.dryRunScore as number;
    return s >= min && (max === undefined || s < max);
  });
  const avg = (items: Gate1DryRunObservationRow[]) => items.length > 0
    ? items.reduce((sum, row) => sum + (row.forwardReturn5D as number), 0) / items.length
    : Number.NEGATIVE_INFINITY;
  const b70 = band(70);
  const b65 = band(65, 70);
  const b60 = band(60, 65);
  const winRate65 = b65.length > 0 ? b65.filter((row) => (row.forwardReturn5D as number) > 0).length / b65.length : 0;
  const hitMinus5_70 = b70.length > 0 ? b70.filter((row) => (row.forwardReturn5D as number) <= -5).length / b70.length : 0;
  const hitMinus5_65 = b65.length > 0 ? b65.filter((row) => (row.forwardReturn5D as number) <= -5).length / b65.length : 0;
  const can65 = b65.length >= 10 && avg(b65) >= avg(b70) && winRate65 >= 0.55 && hitMinus5_65 <= hitMinus5_70 + 0.05;
  const reject60 = b60.length > 0 && avg(b60) < 0;
  const confidence = matureSampleSize < 100 ? 'INSUFFICIENT_SAMPLE' : matureSampleSize < 200 ? 'LOW' : matureSampleSize < 400 ? 'MEDIUM' : 'HIGH';
  const recommendedAction = matureSampleSize < 100
    ? 'OBSERVE_MORE'
    : reject60
      ? 'KEEP_THRESHOLD_70'
      : can65
        ? 'DRY_RUN_THRESHOLD_65_R3_ONLY'
        : 'REJECT_THRESHOLD_RELAXATION';
  const buildBandSummary = (
    bandRows: Gate1DryRunObservationRow[],
    band: '70+' | '65~70' | '60~65' | '55~60' | 'below55',
  ) => {
    const maturedD1Rows = bandRows.filter((row) => finite(row.forwardReturn1D));
    const maturedD3Rows = bandRows.filter((row) => finite(row.forwardReturn3D));
    const maturedD5Rows = bandRows.filter((row) => finite(row.forwardReturn5D));
    const avgValue = (values: number[]): number | 'N/A' => (values.length > 0
      ? round1(values.reduce((sum, value) => sum + value, 0) / values.length)
      : 'N/A');
    const rateValue = (ok: number, total: number): number | 'N/A' => (total > 0 ? round1((ok / total) * 100) : 'N/A');
    const d5Returns = maturedD5Rows.map((row) => row.forwardReturn5D as number);
    const mfeValues = maturedD5Rows
      .map((row) => row.maxFavorableExcursion5D)
      .filter(finite);
    const maeValues = maturedD5Rows
      .map((row) => row.maxAdverseExcursion5D)
      .filter(finite);
    return {
      band,
      count: bandRows.length,
      matureD1: maturedD1Rows.length,
      matureD3: maturedD3Rows.length,
      matureD5: maturedD5Rows.length,
      avgReturnD1: avgValue(maturedD1Rows.map((row) => row.forwardReturn1D as number)),
      avgReturnD3: avgValue(maturedD3Rows.map((row) => row.forwardReturn3D as number)),
      avgReturnD5: avgValue(d5Returns),
      winRateD5: rateValue(d5Returns.filter((value) => value > 0).length, d5Returns.length),
      hitPlus3PctRate: rateValue(d5Returns.filter((value) => value >= 3).length, d5Returns.length),
      hitMinus3PctRate: rateValue(d5Returns.filter((value) => value <= -3).length, d5Returns.length),
      avgMFE: avgValue(mfeValues),
      avgMAE: avgValue(maeValues),
      expectancyR: avgValue(d5Returns.map((value) => value / 3)),
      falseNegativeRate: rateValue(d5Returns.filter((value) => value >= 3).length, d5Returns.length),
    };
  };
  const scoreBandTable = [
    buildBandSummary(scoreBand(70), '70+'),
    buildBandSummary(scoreBand(65, 70), '65~70'),
    buildBandSummary(scoreBand(60, 65), '60~65'),
    buildBandSummary(scoreBand(55, 60), '55~60'),
    buildBandSummary(scoreBand(Number.NEGATIVE_INFINITY, 55), 'below55'),
  ];
  const scoreBandCountSum = scoreBandTable.reduce((sum, band) => sum + band.count, 0);
  return {
    sampleWindow: '1D/3D/5D',
    totalSamples,
    pendingSamples,
    ledgerRowsCreated: ledger.rowsCreated,
    scoreBandCountSum,
    evidenceLedgerMatch: totalSamples === ledger.rowsCreated,
    scoreBandLedgerMatch: scoreBandCountSum === totalSamples,
    maturity: buildGate1EvidenceMaturityStatus(rows, now),
    matureSamplesD1: matureD1,
    matureSamplesD3: matureD3,
    matureSamplesD5: matureD5,
    bestDryRunThreshold: recommendedAction === 'DRY_RUN_THRESHOLD_65_R3_ONLY' ? 65 : 70,
    recommendedAction,
    confidence,
    scoreBandTable,
    liveExecutionImpact: 'NONE',
    thresholdAutoChanged: false,
    operatorApprovalRequired: true,
  };
}

const GATE1_THRESHOLD_EVIDENCE_BAND_ORDER: ReadonlyArray<Gate1ThresholdEvidenceSummary['scoreBandTable'][number]['band']> = [
  '70+',
  '65~70',
  '60~65',
  '55~60',
  'below55',
];

function gate1EvidenceCell(value: number | 'N/A' | undefined): string {
  return value === undefined || value === 'N/A' ? 'N/A' : String(value);
}

function gate1EvidenceBandBlock(
  band: Gate1ThresholdEvidenceSummary['scoreBandTable'][number] | undefined,
  key: Gate1ThresholdEvidenceSummary['scoreBandTable'][number]['band'],
): string[] {
  return [
    `${key}:`,
    `  count: ${band ? band.count : 'N/A'}`,
    `  matureD1: ${band ? band.matureD1 : 'N/A'}`,
    `  matureD3: ${band ? band.matureD3 : 'N/A'}`,
    `  matureD5: ${band ? band.matureD5 : 'N/A'}`,
    `  avgReturnD1: ${gate1EvidenceCell(band?.avgReturnD1)}`,
    `  avgReturnD3: ${gate1EvidenceCell(band?.avgReturnD3)}`,
    `  avgReturnD5: ${gate1EvidenceCell(band?.avgReturnD5)}`,
    `  winRateD5: ${gate1EvidenceCell(band?.winRateD5)}`,
    `  hitPlus3PctRate: ${gate1EvidenceCell(band?.hitPlus3PctRate)}`,
    `  hitMinus3PctRate: ${gate1EvidenceCell(band?.hitMinus3PctRate)}`,
    `  avgMFE: ${gate1EvidenceCell(band?.avgMFE)}`,
    `  avgMAE: ${gate1EvidenceCell(band?.avgMAE)}`,
    `  expectancyR: ${gate1EvidenceCell(band?.expectancyR)}`,
    `  falseNegativeRate: ${gate1EvidenceCell(band?.falseNegativeRate)}`,
  ];
}

/**
 * Renders the Gate1 Threshold Evidence section for /scan_blockers full (emit-only, suggest-only).
 * ALWAYS returns the section — undefined summary (immature/0 mature samples) renders the
 * INSUFFICIENT_SAMPLE / OBSERVE_MORE skeleton with N/A. Distinct from "Gate3 Threshold Evidence".
 * regimeSplit/dataQualitySplit are not carried on dry-run rows yet → N/A (follow-up data wiring).
 */
export function formatGate1ThresholdEvidenceSection(
  summary?: Gate1ThresholdEvidenceSummary | null,
): string {
  const lines: string[] = [
    'Gate1 Threshold Evidence',
    '------------------------',
    'window: D1/D3/D5',
    `totalSamples: ${summary ? summary.totalSamples : 'N/A'}`,
    `pendingSamples: ${summary ? summary.pendingSamples : 'N/A'}`,
    `matureSamplesD1: ${summary ? summary.matureSamplesD1 : 'N/A'}`,
    `matureSamplesD3: ${summary ? summary.matureSamplesD3 : 'N/A'}`,
    `matureSamplesD5: ${summary ? summary.matureSamplesD5 : 'N/A'}`,
    'thresholdAutoChanged: false',
    'operatorApprovalRequired: true',
    'liveExecutionAllowed: false',
    'executionImpact: NONE',
    `confidence: ${summary ? summary.confidence : 'INSUFFICIENT_SAMPLE'}`,
    `recommendedAction: ${summary ? summary.recommendedAction : 'OBSERVE_MORE'}`,
    '',
    'scoreBandTable:',
  ];
  for (const key of GATE1_THRESHOLD_EVIDENCE_BAND_ORDER) {
    const band = summary?.scoreBandTable.find((entry) => entry.band === key);
    lines.push(...gate1EvidenceBandBlock(band, key));
  }
  const countSum = summary
    ? summary.scoreBandTable.reduce((sum, entry) => sum + entry.count, 0)
    : 'N/A';
  lines.push(`countSum: ${countSum}`);
  lines.push(
    '',
    'Regime Split:',
    '- R3_EARLY: N/A',
    '- R5_CAUTION: N/A',
    '- R6_RECOVERY_WATCH: N/A',
    '- SHADOW_ONLY: N/A',
    '',
    'Data Quality Split:',
    '- FULL_COMPUTED: N/A',
    '- SKELETON_ONLY: N/A',
    '- supplyGateScoreEligible=true: N/A',
    '- supplyGateScoreEligible=false: N/A',
    '',
    'Gate1 Threshold Evidence Integrity:',
    `- ledgerRowsCreated: ${summary ? summary.ledgerRowsCreated : 'N/A'}`,
    `- evidenceTotalSamples: ${summary ? summary.totalSamples : 'N/A'}`,
    `- scoreBandCountSum: ${summary ? summary.scoreBandCountSum : 'N/A'}`,
    `- evidenceLedgerMatch: ${summary ? summary.evidenceLedgerMatch : 'N/A'}`,
    `- scoreBandLedgerMatch: ${summary ? summary.scoreBandLedgerMatch : 'N/A'}`,
    `- executionImpact: NONE`,
  );
  if (summary && (!summary.evidenceLedgerMatch || !summary.scoreBandLedgerMatch)) {
    lines.push(
      `- mismatchReason: ${!summary.evidenceLedgerMatch ? 'EVIDENCE_TOTAL_NE_LEDGER_ROWS' : 'SCOREBAND_SUM_NE_EVIDENCE_TOTAL'}`,
      `- missingRows: ${Math.max(0, summary.ledgerRowsCreated - summary.totalSamples)}`,
      `- extraRows: ${Math.max(0, summary.totalSamples - summary.scoreBandCountSum)}`,
      `- nextAction: RECONCILE_EVIDENCE_LEDGER_COUNT`,
    );
  }
  const maturity = summary?.maturity;
  lines.push(
    '',
    'Gate1 Evidence Maturity Scheduler:',
    `- schedulerHealthy: ${maturity ? maturity.schedulerHealthy : 'N/A'}`,
    `- status: ${maturity ? maturity.status : 'N/A'}`,
    `- pendingD1: ${maturity ? maturity.pendingD1 : 'N/A'}`,
    `- pendingD3: ${maturity ? maturity.pendingD3 : 'N/A'}`,
    `- pendingD5: ${maturity ? maturity.pendingD5 : 'N/A'}`,
    `- dueNow: ${maturity ? maturity.dueNow : 'N/A'}`,
    `- stalePending: ${maturity ? maturity.stalePending : 'N/A'}`,
    `- nextMaturityRunAt: ${maturity ? maturity.nextMaturityRunAt : 'N/A'}`,
    `- lastMaturityRunAt: ${maturity ? maturity.lastMaturityRunAt : 'N/A'}`,
    `- dataUnavailable: ${maturity ? maturity.dataUnavailable : 'N/A'}`,
    `- lastErrorSanitized: ${maturity ? maturity.lastErrorSanitized : 'NONE'}`,
    `- executionImpact: NONE`,
  );
  return lines.join('\n');
}
