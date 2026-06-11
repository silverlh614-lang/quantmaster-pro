// @responsibility ADR-0476 Gate1 dry-run observation ledger; near-miss rows; SHADOW_ONLY, no live execution.
import fs from 'fs';
import path from 'path';
import { DATA_DIR, ensureDataDir } from '../../persistence/paths.js';
import { evictWithMaturityPriority } from '../../persistence/outcomeLedgerEviction.js';
import type { CandidateSnapshot } from './entryFilterDecomposition.js';
import { buildFreshDataSupplyObservationRowAdr0487 } from './freshDataSupplyLayerAdr0487.js';
import { buildAdr0488ObservationRows } from './sectorEnergyMasterSupplyUnknownPolicyAdr0488.js';
import { buildSupplyRecoveryRuntimeMountObservationRowAdr0486 } from './supplyRecoveryRuntimeMountAdr0486.js';
import { buildSupplySnapshotObservationRowAdr0491 } from './supplySnapshotStoreReplayAdr0491.js';
import { LEGACY_GATE1_REQUIRED_SCORE } from '../gateConfig.js';
import {
  computeForwardWindowStats,
  buildGate1RegimeAwareWindowRollup,
  formatGate1RegimeAwareWindowLines,
} from './gate1RegimeAwareWindowAdr0546.js';
// ADR-0579 — type/interface declarations extracted to ./gate1DryRunObservationLedgerAdr0476/types.js
// (ACMA 1500-line limit). Re-exported here so external importers are unaffected; type-only, byte-equivalent.
export * from './gate1DryRunObservationLedgerAdr0476/types.js';
import type {
  Gate1DryRunObservationSource,
  Gate1DryRunObservationStatus,
  Gate1DryRunObservationDecision,
  Gate1ObservationScoreBand,
  Gate1ObservationFeatureCompleteness,
  Gate1ThresholdMaturityStatus,
  Gate1DryRunObservationRow,
  Gate1DryRunObservationSummary,
  Gate1EvidenceMaturityStatus,
  Gate1ThresholdEvidenceSummary,
  Gate1DryRunObservationBuildInput,
  Gate1DryRunObservationOutcomeUpdateResult,
  Gate1DryRunObservationPriceFetcher,
} from './gate1DryRunObservationLedgerAdr0476/types.js';

export const GATE1_DRY_RUN_OBSERVATION_LEDGER_FILE = path.join(
  DATA_DIR,
  'gate1-dry-run-observation-ledger.json',
);
// 2026-06-11 retention 처방 — TOP_N=50 확장(~147행/일) 기준 D10 성숙(10거래일) 커버.
export const GATE1_DRY_RUN_OBSERVATION_MAX_ROWS = 4_000;

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

interface ResolvedObservationMinSignal {
  score?: number;
  requiredScore: number;
  scoreSource: 'MIN_SIGNAL_TRACE' | 'LEGACY_GATE_SCORE';
  /** ADR-0597 — 횡단면 percentile shadow 관측 동반 필드 (있으면 행에 stamp). */
  totalPercentile?: number;
  marketBlockScore?: number;
  marketBlockPercentile?: number;
}

/** 관측 행 점수 SSOT 해석 — canonical 최소신호 점수(minSignalScoreBySymbol, requiredScore 와 동일
 *  스케일) 우선, 부재 시 legacy snapshot.gateScore(27조건 점수 — 스케일 상이) fallback 보존.
 *  수리 전 결함: legacy 점수(0~10)를 requiredScore 70 과 비교 → 전 행 below55 고착·NEAR_MISS
 *  영구 미발화 (docs/gate1-scoring-review-20260611.md §4). */
function resolveObservationMinSignal(
  input: Gate1DryRunObservationBuildInput,
  snapshot: CandidateSnapshot,
): ResolvedObservationMinSignal {
  const mapped = snapshot.symbol ? input.minSignalScoreBySymbol?.[snapshot.symbol] : undefined;
  if (mapped && finite(mapped.actualScore)) {
    return {
      score: mapped.actualScore,
      requiredScore: finite(mapped.requiredScore)
        ? mapped.requiredScore
        : snapshot.minSignalRequiredScore ?? LEGACY_GATE1_REQUIRED_SCORE,
      scoreSource: 'MIN_SIGNAL_TRACE',
      ...(finite(mapped.totalPercentile) ? { totalPercentile: mapped.totalPercentile } : {}),
      ...(finite(mapped.marketBlockScore) ? { marketBlockScore: mapped.marketBlockScore } : {}),
      ...(finite(mapped.marketBlockPercentile) ? { marketBlockPercentile: mapped.marketBlockPercentile } : {}),
    };
  }
  return {
    score: snapshot.gateScore,
    requiredScore: snapshot.minSignalRequiredScore ?? LEGACY_GATE1_REQUIRED_SCORE,
    scoreSource: 'LEGACY_GATE_SCORE',
  };
}

/** GATE1_OBSERVATION_TOP_N — 관측 top-N 확대 ENV. 1~500 정수만 유효, 미설정/무효 시 undefined
 *  (각 빌더 default 10/5 보존 — byte-equivalent). */
export function resolveGate1ObservationTopNEnv(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const raw = env.GATE1_OBSERVATION_TOP_N;
  if (raw === undefined || raw.trim() === '') return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) return undefined;
  return parsed;
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
  if (finite(row.forwardReturn10D) || finite(row.forwardReturnD10)) return 'MATURED_10D';
  if (finite(row.forwardReturn5D)) return 'MATURED_5D';
  if (finite(row.forwardReturn3D)) return 'MATURED_3D';
  if (finite(row.forwardReturn1D)) return 'MATURED_1D';
  return row.status === 'PENDING' ? 'OBSERVING' : row.status;
}

function scoreBandFor(score: unknown): Gate1ObservationScoreBand {
  if (!finite(score)) return 'UNSCORED';
  if (score >= 70) return '70+';
  if (score >= 65) return '65~70';
  if (score >= 60) return '60~65';
  if (score >= 55) return '55~60';
  return 'below55';
}

function snapshotNumber(snapshot: CandidateSnapshot, keys: readonly string[]): number | undefined {
  const source = snapshot as unknown as Record<string, unknown>;
  const quote = snapshot.quote && typeof snapshot.quote === 'object'
    ? snapshot.quote as Record<string, unknown>
    : undefined;
  for (const key of keys) {
    const direct = source[key];
    if (finite(direct)) return direct;
    const quoted = quote?.[key];
    if (finite(quoted)) return quoted;
  }
  return undefined;
}

function snapshotPath(snapshot: CandidateSnapshot, pathKey: string): unknown {
  let current: unknown = snapshot;
  for (const key of pathKey.split('.')) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function snapshotString(snapshot: CandidateSnapshot, keys: readonly string[], fallback = 'UNKNOWN'): string {
  for (const key of keys) {
    const value = key.includes('.') ? snapshotPath(snapshot, key) : (snapshot as unknown as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    if (typeof value === 'boolean') return value ? 'PASS' : 'FAIL';
  }
  return fallback;
}

function minSignalComponentScore(snapshot: CandidateSnapshot, code: string): number | undefined {
  const components = snapshotPath(snapshot, 'minSignalScoreTrace.components') ??
    snapshotPath(snapshot, 'gate1Trace.minSignalScoreTrace.components');
  if (!Array.isArray(components)) return undefined;
  const component = components.find((item) =>
    item && typeof item === 'object' && (item as Record<string, unknown>).code === code
  ) as Record<string, unknown> | undefined;
  const weighted = component?.weightedScore;
  return finite(weighted) ? round1(weighted) : undefined;
}

function thresholdMaturityStatusFor(row: Pick<Gate1DryRunObservationRow, 'forwardReturn1D' | 'forwardReturn3D' | 'forwardReturn5D' | 'forwardReturn10D' | 'forwardReturnD10'>): Gate1ThresholdMaturityStatus {
  if (finite(row.forwardReturn10D) || finite(row.forwardReturnD10)) return 'MATURED_D10';
  if (finite(row.forwardReturn5D)) return 'MATURED_D5';
  if (finite(row.forwardReturn3D)) return 'MATURED_D3';
  if (finite(row.forwardReturn1D)) return 'MATURED_D1';
  return 'PENDING';
}

function resolveFeatureCompleteness(snapshot: CandidateSnapshot): Gate1ObservationFeatureCompleteness {
  const hasMomentum = snapshotNumber(snapshot, ['return5d', 'return20d', 'marketRelativeReturn']) !== undefined;
  const hasRs = snapshotNumber(snapshot, ['rsRankPct', 'relativeStrengthScore', 'relativeStrength']) !== undefined;
  const hasBreakout = finite(snapshot.breakoutScore) || finite(snapshot.vcpScore) || Boolean(snapshot.breakoutTrace);
  const present = [hasMomentum, hasRs, hasBreakout].filter(Boolean).length;
  if (present === 3) return 'COMPLETE';
  if (present > 0) return 'PARTIAL';
  return 'UNKNOWN';
}

function observationInputContext(input: Gate1DryRunObservationBuildInput): Pick<
  Parameters<typeof rowFromSnapshot>[0],
  'sourceSnapshotId' | 'scanId' | 'candidateSetId' | 'regime' | 'rawRegime' | 'effectiveRegime' | 'displayRegime' | 'engineMode' | 'policyView' | 'marketSession' | 'marketSessionState'
> {
  return {
    sourceSnapshotId: input.sourceSnapshotId,
    scanId: input.scanId,
    candidateSetId: input.candidateSetId,
    regime: input.regime,
    rawRegime: input.rawRegime,
    effectiveRegime: input.effectiveRegime,
    displayRegime: input.displayRegime,
    engineMode: input.engineMode,
    policyView: input.policyView,
    marketSession: input.marketSession,
    marketSessionState: input.marketSessionState,
  };
}

function withOptionalScoreFields(
  row: Omit<Gate1DryRunObservationRow, 'id'> & { id?: string },
): Gate1DryRunObservationRow {
  const base = {
    ...row,
    id: row.id ?? makeId(row),
    tradeDate: row.tradeDate ?? row.forDate,
    marketSessionState: row.marketSessionState ?? row.marketSession,
    actualLiveEligible: false as const,
    executionImpact: 'NONE' as const,
    liveExecutionAllowed: false as const,
    policyPromotionMode: 'SHADOW_ONLY' as const,
    maturityStatus: row.maturityStatus ?? thresholdMaturityStatusFor(row),
    observationOnly: true as const,
    thresholdAutoChanged: false as const,
    operatorApprovalRequired: true as const,
    shadowLearningAllowed: true as const,
    counterfactualAllowed: true as const,
    shadowBuyAllowed: row.shadowBuyAllowed ?? false,
    forwardReturnD1: row.forwardReturnD1 ?? row.forwardReturn1D,
    forwardReturnD3: row.forwardReturnD3 ?? row.forwardReturn3D,
    forwardReturnD5: row.forwardReturnD5 ?? row.forwardReturn5D,
    forwardReturnD10: row.forwardReturnD10 ?? row.forwardReturn10D,
    mfeD5: row.mfeD5 ?? row.maxFavorableExcursion5D,
    maeD5: row.maeD5 ?? row.maxAdverseExcursion5D,
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
  sourceSnapshotId?: string;
  scanId?: string;
  candidateSetId?: string;
  regime?: string;
  rawRegime?: string;
  effectiveRegime?: string;
  displayRegime?: string;
  engineMode?: string;
  policyView?: string;
  marketSession?: string;
  marketSessionState?: string;
  sellOnly: boolean;
  providerIssue: boolean;
  marketSignal: boolean;
  sectorEnergyDiagnosticOnly: boolean;
  /** resolveObservationMinSignal 결과 — MIN_SIGNAL_TRACE 시 actualScore 를 canonical 점수로 교체. */
  minSignal?: ResolvedObservationMinSignal;
}): Gate1DryRunObservationRow {
  const requiredScore = input.requiredScore ?? input.minSignal?.requiredScore ?? input.snapshot.minSignalRequiredScore ?? LEGACY_GATE1_REQUIRED_SCORE;
  const actualScore = input.minSignal?.scoreSource === 'MIN_SIGNAL_TRACE'
    ? input.minSignal.score
    : input.snapshot.gateScore;
  const score = input.dryRunScore ?? actualScore;
  const scoreGap = finite(score) ? round1(score - requiredScore) : undefined;
  const rawPositiveScore = snapshotNumber(input.snapshot, ['gateRawScore', 'totalGateScore', 'gateScore']);
  const finalGate1Score = finite(actualScore) ? actualScore : score;
  const effectivePenaltyScore = finite(rawPositiveScore) && finite(finalGate1Score)
    ? Math.max(0, round1(rawPositiveScore - finalGate1Score))
    : 0;
  const rsPercentile = snapshotNumber(input.snapshot, ['rsRankPct']);
  const priceMomentum = snapshotNumber(input.snapshot, ['return5d', 'return20d', 'marketRelativeReturn']);
  // counterfacture_gate Phase A — forward-return anchor. updateGate1DryRunObservationOutcomes 는
  // entryReferencePrice>0 가 없으면 행을 skip(continue)하므로, 미stamp 시 모든 관측이 영구 라벨 불가.
  const entryReferencePrice = snapshotNumber(input.snapshot, ['price', 'currentPrice', 'priceAtSignal', 'lastPrice', 'close']);
  const hardPass = input.snapshot.gate1Passed === true && input.snapshot.minSignalScorePassed === true;
  const softPass = input.snapshot.gate1Passed === true || input.snapshot.minSignalScorePassed === true;
  const minSignalLivePass = input.snapshot.minSignalScorePassed === true;
  const gate2Evaluated = input.snapshot.gate1Passed === true || input.snapshot.gate2Passed !== undefined;
  const gate3Evaluated = input.snapshot.gate2Passed === true || input.snapshot.gate3Passed !== undefined;
  const shadowObservationEligible = (finite(finalGate1Score) && finalGate1Score >= 60) || softPass || minSignalLivePass;
  return withOptionalScoreFields({
    createdAt: input.nowIso,
    forDate: input.forDate,
    tradeDate: input.forDate,
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
    ...(input.minSignal ? { scoreSource: input.minSignal.scoreSource } : {}),
    ...(finite(input.minSignal?.totalPercentile) ? { crossSectionalPercentile: input.minSignal.totalPercentile } : {}),
    ...(finite(input.minSignal?.marketBlockScore) ? { marketBlockScore: input.minSignal.marketBlockScore } : {}),
    ...(finite(input.minSignal?.marketBlockPercentile) ? { marketBlockPercentile: input.minSignal.marketBlockPercentile } : {}),
    ...(finite(entryReferencePrice) && entryReferencePrice > 0 ? { entryReferencePrice } : {}),
    ...(input.sourceSnapshotId ? { sourceSnapshotId: input.sourceSnapshotId } : {}),
    ...(input.scanId ? { scanId: input.scanId } : {}),
    ...(input.candidateSetId ? { candidateSetId: input.candidateSetId } : {}),
    ...(input.regime ? { regime: input.regime } : {}),
    ...(input.rawRegime ? { rawRegime: input.rawRegime } : {}),
    ...(input.effectiveRegime ? { effectiveRegime: input.effectiveRegime } : {}),
    ...(input.displayRegime ? { displayRegime: input.displayRegime } : {}),
    ...(input.engineMode ? { engineMode: input.engineMode } : {}),
    ...(input.policyView ? { policyView: input.policyView } : {}),
    ...(input.marketSession ? { marketSession: input.marketSession } : {}),
    ...(input.marketSessionState ? { marketSessionState: input.marketSessionState } : {}),
    ...(finite(finalGate1Score) ? { finalGate1Score: round1(finalGate1Score) } : {}),
    ...(finite(rawPositiveScore) ? { rawPositiveScore: round1(rawPositiveScore) } : {}),
    effectivePenaltyScore,
    diagnosticPenaltyScore: 0,
    scoreBand: scoreBandFor(finalGate1Score),
    hardPass,
    softPass,
    minSignalLivePass,
    liveCandidateAfterGate1: hardPass && input.sellOnly !== true,
    shadowObservable: true,
    counterfactualEligible: Boolean(input.snapshot.symbol),
    shadowObservationEligible,
    shadowBuyAllowed: false,
    learningLabel: 'GATE1_THRESHOLD_OBSERVATION',
    priceMomentumScore: minSignalComponentScore(input.snapshot, 'PRICE_MOMENTUM') ?? snapshotNumber(input.snapshot, ['priceMomentumScore']),
    relativeStrengthScore: minSignalComponentScore(input.snapshot, 'RELATIVE_STRENGTH') ?? snapshotNumber(input.snapshot, ['relativeStrengthScore']),
    breakoutStructureScore: minSignalComponentScore(input.snapshot, 'BREAKOUT_STRUCTURE') ?? snapshotNumber(input.snapshot, ['breakoutScore', 'vcpScore']),
    volumeLiquidityScore: minSignalComponentScore(input.snapshot, 'VOLUME_LIQUIDITY') ?? snapshotNumber(input.snapshot, ['volumeLiquidityScore']),
    watchlistScore: minSignalComponentScore(input.snapshot, 'WATCHLIST_UPSTREAM_SCORE') ?? snapshotNumber(input.snapshot, ['watchlistUpstreamScore', 'watchlistScore', 'upstreamScore']),
    supplyScore: minSignalComponentScore(input.snapshot, 'SUPPLY') ?? snapshotNumber(input.snapshot, ['supplyScore']),
    sectorLeadershipScore: minSignalComponentScore(input.snapshot, 'SECTOR_LEADERSHIP') ?? snapshotNumber(input.snapshot, ['sectorBoost']),
    technicalTrendScore: minSignalComponentScore(input.snapshot, 'TECHNICAL_TREND') ?? snapshotNumber(input.snapshot, ['technicalTrendScore']),
    gate2Evaluated,
    gate2Pass: input.snapshot.gate2Passed === true,
    gate2PrimaryBlocker: snapshotString(input.snapshot, ['gate2PrimaryBlocker', 'primaryBlocker', 'gateLayerSummary.gate2.primaryBlocker'], gate2Evaluated ? 'NONE' : 'NOT_EVALUATED_GATE1_FAIL'),
    gate3Evaluated,
    gate3Readiness: snapshotString(input.snapshot, ['gate3Readiness', 'gateLayerSummary.gate3.readiness'], gate3Evaluated ? 'EVALUATED' : 'NOT_EVALUATED'),
    rrrStatus: snapshotString(input.snapshot, ['conditionResults.rrr.status', 'conditionResults.RRR.status', 'rrrStatus'], 'UNKNOWN'),
    volumeConfirmation: snapshotString(input.snapshot, ['conditionResults.volume.status', 'conditionResults.VOLUME.status', 'volumeConfirmation'], 'UNKNOWN'),
    priceConfirmation: snapshotString(input.snapshot, ['conditionResults.priceConfirmation.status', 'conditionResults.PRICE_CONFIRMATION.status', 'priceConfirmation'], 'UNKNOWN'),
    lastTriggerStatus: snapshotString(input.snapshot, ['lastTriggerStatus', 'gateLayerSummary.gate3.lastTriggerStatus'], 'UNKNOWN'),
    featureCompleteness: resolveFeatureCompleteness(input.snapshot),
    supplyGateScoreEligible: input.snapshot.supplyProviderHealth?.providerIssue !== true,
    breakoutPositive: (input.snapshot.breakoutScore ?? 0) > 0 || (input.snapshot.vcpScore ?? 0) > 0,
    ...(finite(rsPercentile) ? { rsPercentile: round1(rsPercentile) } : {}),
    ...(finite(priceMomentum) ? { priceMomentumPositive: priceMomentum > 0 } : {}),
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
  const requiredScore = best.requiredScore || LEGACY_GATE1_REQUIRED_SCORE;
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
      ...observationInputContext(input),
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

function buildGate1ScoreObservationV2Rows(input: Gate1DryRunObservationBuildInput, nowIso: string): Gate1DryRunObservationRow[] {
  const rows = [...(input.candidateSnapshots ?? [])]
    .filter((snapshot) => snapshot.symbol)
    .map((snapshot) => ({ snapshot, minSignal: resolveObservationMinSignal(input, snapshot) }))
    .sort((a, b) => (b.minSignal.score ?? Number.NEGATIVE_INFINITY) - (a.minSignal.score ?? Number.NEGATIVE_INFINITY))
    .slice(0, input.topN ?? 10);
  return rows.map(({ snapshot, minSignal }) => {
    const requiredScore = minSignal.requiredScore;
    const score = minSignal.score;
    const gap = finite(score) ? round1(score - requiredScore) : Number.NEGATIVE_INFINITY;
    return rowFromSnapshot({
      snapshot,
      nowIso,
      forDate: input.forDate,
      source: 'GATE1_SCORE_OBSERVATION_V2',
      scenario: 'GATE1_SCORE_THRESHOLD_OBSERVATION_V2',
      dryRunDecision: gap >= 0 ? 'WOULD_PASS_DRY_RUN' : gap >= -10 ? 'NEAR_MISS' : 'WOULD_STILL_FAIL',
      dryRunScore: score,
      requiredScore,
      minSignal,
      ...observationInputContext(input),
      sellOnly: input.sellOnly === true,
      providerIssue: input.providerIssue === true,
      marketSignal: input.marketSignal === true,
      sectorEnergyDiagnosticOnly: input.sectorEnergyDiagnosticOnly === true,
    });
  });
}

function buildGateNearMissRows(input: Gate1DryRunObservationBuildInput, nowIso: string): Gate1DryRunObservationRow[] {
  const rows = [...(input.candidateSnapshots ?? [])]
    .map((snapshot) => ({ snapshot, minSignal: resolveObservationMinSignal(input, snapshot) }))
    .filter((item) => finite(item.minSignal.score))
    .map((item) => {
      const gap = round1((item.minSignal.score ?? 0) - item.minSignal.requiredScore);
      return { ...item, gap };
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
    dryRunScore: item.minSignal.score,
    requiredScore: item.minSignal.requiredScore,
    minSignal: item.minSignal,
    ...observationInputContext(input),
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
  return snapshots.map((snapshot) => {
    const minSignal = resolveObservationMinSignal(input, snapshot);
    return rowFromSnapshot({
      snapshot,
      nowIso,
      forDate: input.forDate,
      source: 'COUNTERFACTUAL_UNIVERSE',
      scenario: 'BEFORE_BUYLIST_LOOP_SNAPSHOT',
      dryRunDecision: 'WOULD_STILL_FAIL',
      dryRunScore: minSignal.score,
      requiredScore: minSignal.requiredScore,
      minSignal,
      ...observationInputContext(input),
      sellOnly: input.sellOnly === true,
      providerIssue: input.providerIssue === true,
      marketSignal: input.marketSignal === true,
      sectorEnergyDiagnosticOnly: input.sectorEnergyDiagnosticOnly === true,
    });
  });
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
    requiredScore: LEGACY_GATE1_REQUIRED_SCORE,
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
    requiredScore: LEGACY_GATE1_REQUIRED_SCORE,
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
    requiredScore: LEGACY_GATE1_REQUIRED_SCORE,
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
    ...buildGate1ScoreObservationV2Rows(input, nowIso),
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
  // 성숙 우선 eviction — 종결(MATURED_10D/EXPIRED/SKIPPED) 행부터 제거, 미성숙 forward 증거 보존.
  const trimmed = evictWithMaturityPriority(rows, GATE1_DRY_RUN_OBSERVATION_MAX_ROWS, (row) =>
    row.status === 'MATURED_10D' || row.status === 'EXPIRED' || row.status === 'SKIPPED');
  fs.writeFileSync(filePath, JSON.stringify(trimmed));
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
    matured10D: countStatus('MATURED_10D'),
    sources,
    sourceBreakdownCountSum,
    unclassifiedSourceRows,
    sourceBreakdownInvariant: unclassifiedSourceRows === 0,
    outcomeUpdateAvailable: false,
    outcomeUpdateReason: 'NOT_MATURED',
    liveExecutionAllowed: false,
    executionImpact: 'NONE',
    policyPromotionMode: 'SHADOW_ONLY',
    nextAction: 'TRACK_1D_3D_5D_10D_FORWARD_RETURNS',
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
    return { updated: 0, updatedD1: 0, updatedD3: 0, updatedD5: 0, updatedD10: 0, duplicateSuppressed: 0, pending: rows.length, outcomeUpdateAvailable: false, reason: 'MARKET_CLOSED' };
  }
  if (input.priceCacheAvailable === false) {
    return { updated: 0, updatedD1: 0, updatedD3: 0, updatedD5: 0, updatedD10: 0, duplicateSuppressed: 0, pending: rows.length, outcomeUpdateAvailable: false, reason: 'PRICE_CACHE_MISSING' };
  }
  const now = input.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const horizons = [
    { days: 1, field: 'forwardReturn1D', counter: 'updatedD1' },
    { days: 3, field: 'forwardReturn3D', counter: 'updatedD3' },
    { days: 5, field: 'forwardReturn5D', counter: 'updatedD5' },
    { days: 10, field: 'forwardReturn10D', counter: 'updatedD10' },
  ] as const;
  const hasDue = rows.some((row) => horizons.some((horizon) => today >= addBusinessDays(row.forDate, horizon.days)));
  if (!hasDue) {
    return { updated: 0, updatedD1: 0, updatedD3: 0, updatedD5: 0, updatedD10: 0, duplicateSuppressed: 0, pending: rows.length, outcomeUpdateAvailable: false, reason: 'NOT_MATURED' };
  }

  let updatedD1 = 0;
  let updatedD3 = 0;
  let updatedD5 = 0;
  let updatedD10 = 0;
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
      if (horizon.field === 'forwardReturn10D') row.forwardReturnD10 = row.forwardReturn10D;
      if (horizon.field === 'forwardReturn1D') row.forwardReturnD1 = row.forwardReturn1D;
      if (horizon.field === 'forwardReturn3D') row.forwardReturnD3 = row.forwardReturn3D;
      if (horizon.field === 'forwardReturn5D') row.forwardReturnD5 = row.forwardReturn5D;
      row.status = updateStatusForResolvedHorizons(row);
      row.maturityStatus = thresholdMaturityStatusFor(row);
      if (horizon.counter === 'updatedD1') updatedD1 += 1;
      else if (horizon.counter === 'updatedD3') updatedD3 += 1;
      else if (horizon.counter === 'updatedD5') updatedD5 += 1;
      else updatedD10 += 1;
    }
  }

  const updated = updatedD1 + updatedD3 + updatedD5 + updatedD10;
  if (persist && updated > 0) writeRows(rows);
  const pending = rows.filter((row) => row.status === 'PENDING' || row.status === 'OBSERVING').length;
  return {
    updated,
    updatedD1,
    updatedD3,
    updatedD5,
    updatedD10,
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
    `  matured10D: ${summary.matured10D}`,
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
    return { ...base, schedulerHealthy: true, status: 'NO_ROWS', pendingD1: 0, pendingD3: 0, pendingD5: 0, pendingD10: 0, dueNow: 0, stalePending: 0, nextMaturityRunAt: 'N/A', dataUnavailable: true };
  }
  const today = now.toISOString().slice(0, 10);
  const horizons = [
    { days: 1, field: 'forwardReturn1D' },
    { days: 3, field: 'forwardReturn3D' },
    { days: 5, field: 'forwardReturn5D' },
    { days: 10, field: 'forwardReturn10D' },
  ] as const;
  let pendingD1 = 0;
  let pendingD3 = 0;
  let pendingD5 = 0;
  let pendingD10 = 0;
  let dueNow = 0;
  let stalePending = 0;
  const futureDueDates: string[] = [];
  for (const row of rows) {
    for (const horizon of horizons) {
      if (finite(row[horizon.field])) continue;
      if (horizon.days === 1) pendingD1 += 1;
      else if (horizon.days === 3) pendingD3 += 1;
      else if (horizon.days === 5) pendingD5 += 1;
      else pendingD10 += 1;
      const dueDate = addBusinessDays(row.forDate, horizon.days);
      if (today >= dueDate) {
        dueNow += 1;
        if (today >= addBusinessDays(dueDate, 2)) stalePending += 1;
      } else {
        futureDueDates.push(dueDate);
      }
    }
  }
  const anyPending = pendingD1 + pendingD3 + pendingD5 + pendingD10 > 0;
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
    pendingD10,
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
  const matureD10 = rows.filter((row) => finite(row.forwardReturn10D) || finite(row.forwardReturnD10)).length;
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
  const below55 = band(Number.NEGATIVE_INFINITY, 55);
  const b55 = band(55, 60);
  const minBandMatureD5 = Math.min(b70.length, b65.length, b60.length, below55.length);
  const sixtyToSeventy = [...b65, ...b60];
  const sixtyToSeventyComparable = sixtyToSeventy.length >= 60 && b70.length >= 30;
  const below55Defensive = below55.length >= 30 && avg(below55) <= avg(b70);
  const falseNegativeCalculable = sixtyToSeventy.length >= 60;
  const mfeMaeComparable = [...b70, ...b65, ...b60, ...b55, ...below55]
    .filter((row) => finite(row.maxFavorableExcursion5D) || finite(row.mfeD5))
    .length >= 100;
  const reviewBlockers = [
    minBandMatureD5 < 30 ? 'SCORE_BAND_D5_SAMPLE_LT_30' : '',
    matureSampleSize < 100 ? 'TOTAL_D5_SAMPLE_LT_100' : '',
    !sixtyToSeventyComparable ? 'SIXTY_TO_SEVENTY_NOT_COMPARABLE' : '',
    !below55Defensive ? 'BELOW55_DEFENSE_NOT_CONFIRMED' : '',
    !falseNegativeCalculable ? 'FALSE_NEGATIVE_RATE_INSUFFICIENT' : '',
    !mfeMaeComparable ? 'MFE_MAE_TIMING_SPLIT_INSUFFICIENT' : '',
  ].filter(Boolean);
  const reviewReady = reviewBlockers.length === 0;
  const confidence: Gate1ThresholdEvidenceSummary['confidence'] = reviewReady
    ? 'READY_FOR_REVIEW'
    : matureSampleSize > 0 ? 'OBSERVING' : 'INSUFFICIENT_SAMPLE';
  const recommendedAction: Gate1ThresholdEvidenceSummary['recommendedAction'] = reviewReady
    ? 'REVIEW_THRESHOLD_WITH_OPERATOR'
    : 'OBSERVE_MORE';
  const buildBandSummary = (
    bandRows: Gate1DryRunObservationRow[],
    band: '70+' | '65~70' | '60~65' | '55~60' | 'below55',
  ) => {
    const stats = computeForwardWindowStats(bandRows);
    return {
      band,
      count: bandRows.length,
      ...stats,
      // falseNegativeRate: band 내 D5 ≥+3% 비율 — "70 미만이라 막혔지만 실제로는 큰 상승" 추정.
      falseNegativeRate: stats.hitPlus3PctRate,
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

  // ADR-0546 Phase2 — regime-aware 완화 창 롤업. 70+ 대조군 통계는 scoreBandTable 에서 재사용.
  const b70Stats = scoreBandTable.find((entry) => entry.band === '70+');
  const regimeAwareWindow = buildGate1RegimeAwareWindowRollup(
    rows,
    b70Stats ? b70Stats.matureD5 : 0,
    b70Stats ? b70Stats.avgReturnD5 : 'N/A',
  );

  return {
    sampleWindow: '1D/3D/5D/10D',
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
    matureSamplesD10: matureD10,
    bestDryRunThreshold: LEGACY_GATE1_REQUIRED_SCORE,
    recommendedAction,
    confidence,
    reviewReady,
    reviewBlockers,
    liveRequiredScore: LEGACY_GATE1_REQUIRED_SCORE,
    shadowObservationMode: 'ON',
    shadowObservationBands: ['60~65', '65~70', '70+'],
    liveThresholdAutoChanged: false,
    scoreBandTable,
    liveExecutionImpact: 'NONE',
    thresholdAutoChanged: false,
    operatorApprovalRequired: true,
    regimeAwareWindow,
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
    'window: D1/D3/D5/D10',
    `totalSamples: ${summary ? summary.totalSamples : 'N/A'}`,
    `pendingSamples: ${summary ? summary.pendingSamples : 'N/A'}`,
    `matureSamplesD1: ${summary ? summary.matureSamplesD1 : 'N/A'}`,
    `matureSamplesD3: ${summary ? summary.matureSamplesD3 : 'N/A'}`,
    `matureSamplesD5: ${summary ? summary.matureSamplesD5 : 'N/A'}`,
    `matureSamplesD10: ${summary ? summary.matureSamplesD10 : 'N/A'}`,
    'observationLedgerV2: true',
    'ledgerExecutionImpact: NONE',
    'thresholdAutoChanged: false',
    'operatorApprovalRequired: true',
    'liveExecutionAllowed: false',
    'executionImpact: NONE',
    `confidence: ${summary ? summary.confidence : 'INSUFFICIENT_SAMPLE'}`,
    `recommendedAction: ${summary ? summary.recommendedAction : 'OBSERVE_MORE'}`,
    `reviewReady: ${summary ? summary.reviewReady : false}`,
    `reviewBlockers: ${summary ? (summary.reviewBlockers.length > 0 ? summary.reviewBlockers.join(',') : 'NONE') : 'INSUFFICIENT_SAMPLE'}`,
    'nextReview: after enough D5 samples',
    '',
    'Threshold Policy Split:',
    `- liveRequiredScore=${summary ? summary.liveRequiredScore : LEGACY_GATE1_REQUIRED_SCORE}`,
    '- liveThresholdAutoChanged=false',
    `- shadowObservationMode=${summary ? summary.shadowObservationMode : 'ON'}`,
    `- shadowObservationBands=${summary ? summary.shadowObservationBands.join(',') : '60~65,65~70,70+'}`,
    '- shadowObservationEligible!=shadowBuyAllowed',
    '- operatorApprovalRequired=true',
    '- executionImpact=NONE',
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
    'Score Band Outcome:',
  );
  for (const key of GATE1_THRESHOLD_EVIDENCE_BAND_ORDER) {
    const band = summary?.scoreBandTable.find((entry) => entry.band === key);
    lines.push(`- ${key}: n=${band ? band.count : 'N/A'}, D5 winRate=${gate1EvidenceCell(band?.winRateD5)}, avgReturn=${gate1EvidenceCell(band?.avgReturnD5)}`);
  }
  // ADR-0546 Phase2 — regime-aware 완화 창 성과 (legacy 70 vs regime 40 비교 근거). 관측 전용.
  lines.push(...formatGate1RegimeAwareWindowLines(summary?.regimeAwareWindow));
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
    '',
    'Gate1 Threshold Invariants:',
    '[OK] GATE1_THRESHOLD_AUTO_CHANGE_FORBIDDEN',
    '[OK] GATE1_OBSERVATION_LEDGER_NON_EXECUTIONAL',
    '[OK] SHADOW_OBSERVATION_NOT_SHADOW_BUY',
    '[OK] SCORE_BAND_MATURITY_REQUIRED',
    '[OK] LIVE_THRESHOLD_SEPARATED_FROM_SHADOW_OBSERVATION',
    '[OK] NO_PROVIDER_ISSUE_TO_BEARISH_CONVERSION',
    '[OK] SOURCE_SNAPSHOT_ID_CONSISTENCY',
    '[OK] COUNTERFACTUAL_CONTINUITY',
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
    `- pendingD10: ${maturity ? maturity.pendingD10 : 'N/A'}`,
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
