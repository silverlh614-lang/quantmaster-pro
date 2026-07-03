// @responsibility Render read-only counterfactual outcome board rows for Telegram diagnostics.
import type { ScanSummary } from '../trading/signalScanner/scanDiagnostics/scanSummaryTypes.js';
import {
  listGate1DryRunObservationRows,
  type Gate1DryRunObservationRow,
} from '../trading/signalScanner/gate1DryRunObservationLedgerAdr0476.js';
import {
  loadCounterfactualShadowLearningLedger,
  type CounterfactualShadowLearningLedgerEntry,
} from '../persistence/counterfactualShadowLearningRepo.js';
import {
  loadCounterfactuals,
  type CounterfactualEntry,
} from './counterfactualShadow.js';
import {
  isKrxTradingDay,
  toKstDateKey,
} from '../calendar/krxTradingCalendar.js';
import {
  attachKospiExcessD5ToBand,
  buildCounterfactualKospiJoinContext,
  computeBoardKospiContextD5,
  type KospiMarketBucketExcessD5,
} from './counterfactualKospiJoin.js';

export type CounterfactualSourceType =
  | 'GATE1_DRY_RUN_OBSERVATION'
  | 'COUNTERFACTUAL_LEDGER'
  | 'LEGACY_COUNTERFACTUAL';

export type CounterfactualRowType =
  | 'GATE_COUNTERFACTUAL'
  | 'ENTRY_COUNTERFACTUAL'
  | 'NEAR_MISS'
  | 'PAPER_OBSERVATIONAL'
  | 'GATE1_DRY_RUN'
  | 'GATE2_BLOCKED'
  | 'GATE3_WAIT'
  | 'COUNTERFACTUAL_CANDIDATE'
  | 'DIAGNOSTIC_EVENT'
  | 'SNAPSHOT_REPLAY'
  | 'SUPPLY_SNAPSHOT_STORE_REPLAY'
  | 'PROVIDER_REPLAY'
  | 'ADR_REPLAY'
  | 'UNKNOWN';

export type CounterfactualSourceLane =
  | 'GATE1'
  | 'GATE2'
  | 'GATE3'
  | 'ENTRY_FILTER'
  | 'PAPER_OBSERVATIONAL'
  | 'NEAR_MISS'
  | 'COUNTERFACTUAL'
  | 'DIAGNOSTIC'
  | 'SNAPSHOT_REPLAY'
  | 'PROVIDER_REPLAY'
  | 'ADR_REPLAY'
  | 'UNKNOWN';

export type CounterfactualExcludedReason =
  | 'MISSING_SYMBOL'
  | 'MISSING_SCAN_ID'
  | 'MISSING_SOURCE_SNAPSHOT_ID'
  | 'MISSING_CANDIDATE_SET_ID'
  | 'MISSING_RECORDED_AT'
  | 'MISSING_BLOCKER'
  | 'MISSING_REFERENCE_PRICE'
  | 'DIAGNOSTIC_REPLAY_ARTIFACT'
  | 'NOT_A_GATE_COUNTERFACTUAL_ROW';

export type Gate1OutcomeBand = '70+' | '65~70' | '60~65' | '55~60' | 'below55' | 'UNSCORED';
export type Gate1PassType = 'HARD_PASS' | 'SOFT_PASS' | 'MIN_SIGNAL_PASS' | 'FAIL' | 'DIAGNOSTIC_ONLY';
export type Gate2OutcomeStatus = 'PASS' | 'FAIL' | 'PENDING' | 'NOT_EVALUATED_GATE1_FAIL';
export type Gate3OutcomeStatus = 'READY' | 'WAIT' | 'BLOCKED' | 'NOT_EVALUATED';
export type CounterfactualMaturityStatus =
  | 'PENDING'
  | 'MATURE_D1'
  | 'MATURE_D3'
  | 'MATURE_D5'
  | 'MATURE_D10'
  | 'DATA_UNAVAILABLE';
export type CounterfactualOutcomeLabel =
  | 'GOOD_BLOCK'
  | 'MISSED_OPPORTUNITY'
  | 'NO_EDGE'
  | 'LATE_BREAKOUT'
  | 'OVEREXTENDED_WAS_CORRECT'
  | 'RRR_BLOCK_CORRECT'
  | 'DATA_BLOCKED_BUT_PROFITABLE'
  | 'DATA_BLOCKED_AND_WEAK'
  | 'INSUFFICIENT_MATURITY';

export interface CounterfactualOutcomeBoardRow {
  sourceType: CounterfactualSourceType;
  rowType: CounterfactualRowType;
  sourceLane: CounterfactualSourceLane;
  counterfactualId: string;
  scanId: string | null;
  sourceSnapshotId: string | null;
  candidateSetId: string | null;
  symbol: string;
  name: string | null;
  recordedAt: string;
  marketSession: string | null;
  regimeRaw: string | null;
  regimeEffective: string | null;
  displayPolicy: string | null;
  referencePrice: number | null;
  referencePriceSource: string | null;
  kospiAtRecord: number | null;
  kosdaqAtRecord: number | null;
  gate1Score: number | null;
  gate1Required: number | null;
  gate1Band: Gate1OutcomeBand;
  /** canonical 최소신호 점수 여부 — MIN_SIGNAL_TRACE 행만 밴드 증거로 집계 (구 스케일 혼입 차단). */
  scoreSource?: 'MIN_SIGNAL_TRACE' | 'LEGACY_GATE_SCORE';
  gate1PassType: Gate1PassType;
  gate2Status: Gate2OutcomeStatus;
  gate3Status: Gate3OutcomeStatus;
  rrr: number | null;
  volumeStatus: string | null;
  priceStatus: string | null;
  lastTriggerStatus: string | null;
  blockedByPrimary: string | null;
  blockedBySecondary: string | null;
  blockerVector: string[];
  nearMissType: string | null;
  gate2BlockerTop: string | null;
  gate3BlockerTop: string | null;
  wouldPassIfThresholdMinus5: boolean;
  wouldPassIfThresholdMinus10: boolean;
  wouldPassIfGate2Softened: boolean;
  wouldPassIfGate3WaitAllowed: boolean;
  d1Close: number | null;
  d3Close: number | null;
  d5Close: number | null;
  d10Close: number | null;
  returnD1: number | null;
  returnD3: number | null;
  returnD5: number | null;
  returnD10: number | null;
  mfeD1: number | null;
  mfeD3: number | null;
  mfeD5: number | null;
  mfeD10: number | null;
  maeD1: number | null;
  maeD3: number | null;
  maeD5: number | null;
  maeD10: number | null;
  hitPlus3D5: boolean | null;
  hitMinus3D5: boolean | null;
  hitTP1Virtual: boolean | null;
  hitSLVirtual: boolean | null;
  mfeBeforeMae: boolean | null;
  outcomeLabel: CounterfactualOutcomeLabel;
  falseNegative: boolean;
  correctBlock: boolean;
  overStrictCondition: string | null;
  recommendedAction: string;
  maturityStatus: CounterfactualMaturityStatus;
  executionImpact: 'NONE';
  thresholdAutoChanged: false;
  operatorApprovalRequired: true;
}

export interface CounterfactualOutcomeSummary {
  totalRecorded: number;
  matureD1: number;
  matureD3: number;
  matureD5: number;
  matureD10: number;
  avgReturnD1: number | null;
  avgReturnD3: number | null;
  avgReturnD5: number | null;
  winRateD5: number | null;
  missedOpportunityRateD5: number | null;
  correctBlockRateD5: number | null;
  falseNegativeRateD5: number | null;
  dataUnavailableRate: number;
  verdict: 'NO_VALID_COUNTERFACTUAL_ROWS' | 'INSUFFICIENT_SAMPLE' | 'OBSERVE_MORE' | 'WATCH' | 'KEEP_BLOCKS' | 'REVIEW_WITH_OPERATOR';
}

export interface CounterfactualBandOutcome {
  key: string;
  count: number;
  matureD5: number;
  avgReturnD5: number | null;
  winRateD5: number | null;
  hitPlus3PctRateD5: number | null;
  hitMinus3PctRateD5: number | null;
  avgMfeD5: number | null;
  avgMaeD5: number | null;
  missedOpportunityRateD5: number | null;
  correctBlockRateD5: number | null;
  falseNegativeRateD5?: number | null;
  recommendation?: string;
  /** KOSPI 대비 초과수익 D5 (2026-07-03 patch — display-only additive, counterfactualKospiJoin). */
  avgExcessD5?: number | null;
  winVsMarketD5?: number | null;
  kospiJoinedD5?: number;
  /** 시장 국면 분해 + median (2026-07-03 patch 2 — 경계 kospiReturnD5=0 은 Down bucket 포함). */
  marketUpD5?: KospiMarketBucketExcessD5;
  marketDownD5?: KospiMarketBucketExcessD5;
  medianExcessD5?: number | null;
}

export interface CounterfactualTodaySummary {
  dateKey: string;
  scanId: string | null;
  sourceSnapshotId: string | null;
  totalRecorded: number;
  gateCounterfactualReadyCount: number;
  entryCounterfactualRecorded: number;
  pendingCount: number;
  gate1FailCount: number;
  gate2FailCount: number;
  gate3BlockedOrWaitCount: number;
  paperObservationalSymbols: string[];
  thresholdAutoChanged: false;
  executionImpact: 'NONE';
  shadowLearningContinues: true;
  counterfactualAllowed: true;
}

export interface CounterfactualReviewSummary {
  gate1ReviewReady: boolean;
  gate2ReviewReady: boolean;
  gate3ReviewReady: boolean;
  status: 'INSUFFICIENT_SAMPLE' | 'READY_FOR_OPERATOR_REVIEW';
  nextAction: 'OBSERVE_MORE' | 'NO_THRESHOLD_CHANGE' | 'OPERATOR_REVIEW';
  blockers: string[];
}

export interface CounterfactualSafetyChecks {
  counterfactualReportingNonExecutional: boolean;
  thresholdAutoChangeForbidden: boolean;
  livePermissionUnchanged: boolean;
  shadowLearningContinues: boolean;
  sourceSnapshotLinked: boolean;
  outcomeMaturityRequired: boolean;
  gateBlockerAttributionPreserved: boolean;
}

export interface CounterfactualExcludedRow {
  sourceType: CounterfactualSourceType;
  rowType: CounterfactualRowType;
  sourceLane: CounterfactualSourceLane;
  counterfactualId: string;
  symbol: string | null;
  scanId: string | null;
  sourceSnapshotId: string | null;
  candidateSetId: string | null;
  gate1Score: number | null;
  gate1Band: Gate1OutcomeBand;
  gate3Status: Gate3OutcomeStatus;
  excludedReason: CounterfactualExcludedReason;
}

export interface CounterfactualDebugSummary {
  totalRawRows: number;
  includedRows: number;
  excludedRows: number;
  rowTypeDistribution: Record<string, number>;
  sourceLaneDistribution: Record<string, number>;
  idPrefixDistribution: Record<string, number>;
  hasSymbolCount: number;
  hasScanIdCount: number;
  hasSourceSnapshotIdCount: number;
  hasCandidateSetIdCount: number;
  hasGate1ScoreCount: number;
  hasBlockedByCount: number;
  excludedReasonDistribution: Record<string, number>;
  excludedSampleRows: CounterfactualExcludedRow[];
}

export type BandMaturityStallStatus = 'HEALTHY' | 'IMMATURE_WAITING' | 'STALL_SUSPECTED';

/**
 * 관측 전용 가드 (patch-type, ADR 0건). canonical Gate1 밴드가 충분한 거래일 경과 후에도
 * matureD5=0 이면 라벨러 write-back / reference price 배선 버그를 의심한다. 판정만 하며
 * execution / threshold 에 영향 0 (observationOnly).
 */
export interface BandMaturityStallGuard {
  status: BandMaturityStallStatus;
  oldestBandRowAgeTradingDays: number | null;
  totalBandMatureD5: number;
  totalBandRows: number;
  stallThresholdTradingDays: number;
  reason: string;
  recommendedAction:
    | 'NONE'
    | 'OBSERVE_MORE'
    | 'INVESTIGATE_LABELER_WRITEBACK_OR_REFERENCE_PRICE';
  excludedReferencePriceCount: number;
  executionImpact: 'NONE';
  observationOnly: true;
}

export interface CounterfactualOutcomeBoard {
  generatedAt: string;
  periodLabel: string;
  rows: CounterfactualOutcomeBoardRow[];
  summary: CounterfactualOutcomeSummary;
  gate1Bands: CounterfactualBandOutcome[];
  /** 구 스케일/비-canonical 행 별도 집계 — 밴드 증거에서 제외하되 비가시 삭제 금지. */
  gate1LegacyScale: CounterfactualBandOutcome;
  gate2Blockers: CounterfactualBandOutcome[];
  gate3Blockers: CounterfactualBandOutcome[];
  topMissedOpportunities: CounterfactualOutcomeBoardRow[];
  bandMaturityStallGuard: BandMaturityStallGuard;
  today: CounterfactualTodaySummary;
  review: CounterfactualReviewSummary;
  safety: CounterfactualSafetyChecks;
  debug: CounterfactualDebugSummary;
  /** 관측창 KOSPI 시장 컨텍스트 (display-only additive — join 실패 시 UNAVAILABLE graceful). */
  kospiAvgD5?: number | null;
  kospiJoinStatus?: 'JOINED' | 'UNAVAILABLE';
  thresholdAutoChanged: false;
  operatorApprovalRequired: true;
  executionImpact: 'NONE';
}

export interface CounterfactualOutcomeBoardOptions {
  now?: Date;
  periodDays?: number;
  gate1Rows?: readonly Gate1DryRunObservationRow[];
  counterfactualEntries?: readonly CounterfactualShadowLearningLedgerEntry[];
  legacyEntries?: readonly CounterfactualEntry[];
  lastScanSummary?: ScanSummary | null;
}

const GATE1_BANDS: Gate1OutcomeBand[] = ['70+', '65~70', '60~65', '55~60', 'below55'];
/** D5 성숙(5거래일) + grace 2거래일 — false-positive 방지용 STALL 판정 임계. */
const BAND_MATURITY_STALL_THRESHOLD_TRADING_DAYS = 7;
const GATE2_BLOCKERS = [
  'BREAKOUT_MOMENTUM_NOT_CONFIRMED',
  'FUNDAMENTAL_UNAVAILABLE',
  'RELATIVE_STRENGTH_FAIL',
  'VOLUME_CONFIRMATION_FAIL',
  'EARNINGS_QUALITY_UNAVAILABLE',
  'PER_UNAVAILABLE',
] as const;
const GATE3_BLOCKERS = [
  'LAST_TRIGGER_NOT_FIRED',
  'PRICE_NOT_CONFIRMED',
  'PRICE_OVEREXTENDED',
  'RRR_FAIL',
  'RRR_WATCH',
  'VOLUME_WEAK',
  'VOLUME_DRY_UP',
  'PRE_BREAKOUT_WAIT',
] as const;

const INCLUDED_ROW_TYPES = new Set<CounterfactualRowType>(['GATE_COUNTERFACTUAL', 'ENTRY_COUNTERFACTUAL', 'NEAR_MISS', 'PAPER_OBSERVATIONAL', 'GATE1_DRY_RUN', 'GATE2_BLOCKED', 'GATE3_WAIT', 'COUNTERFACTUAL_CANDIDATE']);
const INCLUDED_SOURCE_LANES = new Set<CounterfactualSourceLane>(['GATE1', 'GATE2', 'GATE3', 'ENTRY_FILTER', 'PAPER_OBSERVATIONAL', 'NEAR_MISS', 'COUNTERFACTUAL']);
const REPLAY_ARTIFACT_TOKENS = ['ADR_0491_SUPPLY_SNAPSHOT_STORE_REPLAY', 'DIAGNOSTIC_EVENT', 'SNAPSHOT_REPLAY', 'SUPPLY_SNAPSHOT_STORE_REPLAY', 'PROVIDER_REPLAY', 'ADR_REPLAY'] as const;

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function positive(value: unknown): number | null {
  const n = finite(value);
  return n !== null && n > 0 ? n : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function upperText(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function hasReplayArtifactToken(values: readonly unknown[]): boolean {
  const joined = values.map(upperText).filter(Boolean).join('|');
  return REPLAY_ARTIFACT_TOKENS.some((token) => joined.includes(token));
}

function sourceRowType(value: unknown): CounterfactualRowType | null {
  const normalized = upperText(value);
  if (!normalized) return null;
  if (normalized === 'GATE_COUNTERFACTUAL') return 'GATE_COUNTERFACTUAL';
  if (normalized === 'ENTRY_COUNTERFACTUAL') return 'ENTRY_COUNTERFACTUAL';
  if (normalized === 'NEAR_MISS') return 'NEAR_MISS';
  if (normalized === 'PAPER_OBSERVATIONAL') return 'PAPER_OBSERVATIONAL';
  if (normalized === 'GATE1_DRY_RUN') return 'GATE1_DRY_RUN';
  if (normalized === 'GATE2_BLOCKED') return 'GATE2_BLOCKED';
  if (normalized === 'GATE3_WAIT') return 'GATE3_WAIT';
  if (normalized === 'COUNTERFACTUAL_CANDIDATE') return 'COUNTERFACTUAL_CANDIDATE';
  if (normalized.includes('SUPPLY_SNAPSHOT_STORE_REPLAY')) return 'SUPPLY_SNAPSHOT_STORE_REPLAY';
  if (normalized.includes('PROVIDER_REPLAY')) return 'PROVIDER_REPLAY';
  if (normalized.includes('SNAPSHOT_REPLAY')) return 'SNAPSHOT_REPLAY';
  if (normalized.includes('ADR_REPLAY')) return 'ADR_REPLAY';
  if (normalized.includes('DIAGNOSTIC')) return 'DIAGNOSTIC_EVENT';
  return null;
}

function sourceLane(value: unknown): CounterfactualSourceLane | null {
  const normalized = upperText(value);
  if (!normalized) return null;
  if (normalized === 'GATE1') return 'GATE1';
  if (normalized === 'GATE2') return 'GATE2';
  if (normalized === 'GATE3') return 'GATE3';
  if (normalized === 'ENTRY_FILTER') return 'ENTRY_FILTER';
  if (normalized === 'PAPER_OBSERVATIONAL') return 'PAPER_OBSERVATIONAL';
  if (normalized === 'NEAR_MISS') return 'NEAR_MISS';
  if (normalized === 'COUNTERFACTUAL') return 'COUNTERFACTUAL';
  if (normalized.includes('SUPPLY_SNAPSHOT_STORE_REPLAY') || normalized.includes('SNAPSHOT_REPLAY')) return 'SNAPSHOT_REPLAY';
  if (normalized.includes('PROVIDER_REPLAY')) return 'PROVIDER_REPLAY';
  if (normalized.includes('ADR_REPLAY')) return 'ADR_REPLAY';
  if (normalized.includes('DIAGNOSTIC')) return 'DIAGNOSTIC';
  return null;
}

function inferGate1RowType(row: Gate1DryRunObservationRow): CounterfactualRowType {
  if (hasReplayArtifactToken([row.id, row.source, row.observationType])) return 'SUPPLY_SNAPSHOT_STORE_REPLAY';
  if (row.dryRunDecision === 'UNKNOWN_DIAGNOSTIC_ONLY') return 'DIAGNOSTIC_EVENT';
  if (row.source === 'GATE1_NEAR_MISS') return 'NEAR_MISS';
  if (row.source === 'COUNTERFACTUAL_UNIVERSE') return 'COUNTERFACTUAL_CANDIDATE';
  if (row.source === 'GATE1_SCORE_OBSERVATION_V2') return 'GATE1_DRY_RUN';
  if (row.source.startsWith('ADR_')) return 'DIAGNOSTIC_EVENT';
  return 'GATE1_DRY_RUN';
}

function inferGate1SourceLane(row: Gate1DryRunObservationRow, rowType: CounterfactualRowType): CounterfactualSourceLane {
  if (rowType === 'SUPPLY_SNAPSHOT_STORE_REPLAY' || rowType === 'SNAPSHOT_REPLAY') return 'SNAPSHOT_REPLAY';
  if (rowType === 'DIAGNOSTIC_EVENT' || rowType === 'ADR_REPLAY') return 'DIAGNOSTIC';
  if (rowType === 'NEAR_MISS') return 'NEAR_MISS';
  if (rowType === 'COUNTERFACTUAL_CANDIDATE') return 'COUNTERFACTUAL';
  return 'GATE1';
}

function inferLedgerRowType(entry: CounterfactualShadowLearningLedgerEntry): CounterfactualRowType {
  const source = entry as unknown as Record<string, unknown>;
  const explicit = sourceRowType(source.rowType);
  if (explicit) return explicit;
  if (hasReplayArtifactToken([source.id, source.source, source.sourceLane, entry.eventType, entry.label])) return 'SUPPLY_SNAPSHOT_STORE_REPLAY';
  if ((entry.blockedBy ?? []).some((blocker) => blocker.includes('GATE3'))) return 'GATE3_WAIT';
  if ((entry.blockedBy ?? []).some((blocker) => blocker.includes('GATE2'))) return 'GATE2_BLOCKED';
  return 'ENTRY_COUNTERFACTUAL';
}

function inferLedgerSourceLane(entry: CounterfactualShadowLearningLedgerEntry, rowType: CounterfactualRowType): CounterfactualSourceLane {
  const source = entry as unknown as Record<string, unknown>;
  const explicit = sourceLane(source.sourceLane);
  if (explicit) return explicit;
  if (rowType === 'GATE2_BLOCKED') return 'GATE2';
  if (rowType === 'GATE3_WAIT') return 'GATE3';
  if (rowType === 'SUPPLY_SNAPSHOT_STORE_REPLAY' || rowType === 'SNAPSHOT_REPLAY') return 'SNAPSHOT_REPLAY';
  if (rowType === 'DIAGNOSTIC_EVENT' || rowType === 'ADR_REPLAY') return 'DIAGNOSTIC';
  return 'COUNTERFACTUAL';
}

function inferLegacyRowType(entry: CounterfactualEntry): CounterfactualRowType {
  const source = entry as unknown as Record<string, unknown>;
  const explicit = sourceRowType(source.rowType);
  if (explicit) return explicit;
  if (hasReplayArtifactToken([entry.id, source.source, source.sourceLane, source.observationType, entry.skipReason, entry.blockedReason])) {
    return 'SUPPLY_SNAPSHOT_STORE_REPLAY';
  }
  if (entry.skipReason?.includes('NEAR_MISS')) return 'NEAR_MISS';
  return 'COUNTERFACTUAL_CANDIDATE';
}

function inferLegacySourceLane(entry: CounterfactualEntry, rowType: CounterfactualRowType): CounterfactualSourceLane {
  const source = entry as unknown as Record<string, unknown>;
  const explicit = sourceLane(source.sourceLane);
  if (explicit) return explicit;
  if (rowType === 'NEAR_MISS') return 'NEAR_MISS';
  if (rowType === 'SUPPLY_SNAPSHOT_STORE_REPLAY' || rowType === 'SNAPSHOT_REPLAY') return 'SNAPSHOT_REPLAY';
  if (rowType === 'DIAGNOSTIC_EVENT' || rowType === 'ADR_REPLAY') return 'DIAGNOSTIC';
  return 'COUNTERFACTUAL';
}

function numberFrom(source: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = finite(source[key]);
    if (value !== null) return value;
  }
  return null;
}

function stringFrom(source: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = text(source[key]);
    if (value) return value;
  }
  return null;
}

function kstDateKey(now: Date): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

function recordedDateKey(row: Pick<CounterfactualOutcomeBoardRow, 'recordedAt'>): string {
  return row.recordedAt.slice(0, 10);
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function avg(values: readonly (number | null | undefined)[]): number | null {
  const nums = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (nums.length === 0) return null;
  return round2(nums.reduce((sum, value) => sum + value, 0) / nums.length);
}

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? round2(numerator / denominator) : null;
}

function priceFromReturn(referencePrice: number | null, returnPct: number | null): number | null {
  if (referencePrice === null || returnPct === null) return null;
  return round2(referencePrice * (1 + returnPct / 100));
}

function gate1BandFor(score: number | null): Gate1OutcomeBand {
  if (score === null) return 'UNSCORED';
  if (score >= 70) return '70+';
  if (score >= 65) return '65~70';
  if (score >= 60) return '60~65';
  if (score >= 55) return '55~60';
  return 'below55';
}

function gate1PassTypeFor(input: {
  score: number | null;
  required: number | null;
  hardPass?: boolean;
  softPass?: boolean;
  minSignalLivePass?: boolean;
  diagnosticOnly?: boolean;
  actualGate1Passed?: boolean;
}): Gate1PassType {
  if (input.diagnosticOnly) return 'DIAGNOSTIC_ONLY';
  if (input.hardPass === true || input.actualGate1Passed === true) return 'HARD_PASS';
  const required = input.required ?? 70;
  if (input.score !== null && input.score >= required) return 'HARD_PASS';
  if (input.softPass === true || (input.score !== null && input.score >= required - 5)) return 'SOFT_PASS';
  if (input.minSignalLivePass === true) return 'MIN_SIGNAL_PASS';
  return 'FAIL';
}

function gate2StatusFor(row: Gate1DryRunObservationRow, passType: Gate1PassType): Gate2OutcomeStatus {
  if (passType === 'FAIL' && row.gate2Evaluated !== true) return 'NOT_EVALUATED_GATE1_FAIL';
  if (row.gate2Pass === true) return 'PASS';
  if (row.gate2Pass === false || row.gate2PrimaryBlocker) return 'FAIL';
  return row.gate2Evaluated === true ? 'PENDING' : 'PENDING';
}

function gate3StatusFor(row: Gate1DryRunObservationRow): Gate3OutcomeStatus {
  const raw = (row.gate3Readiness ?? '').toUpperCase();
  if (raw.includes('READY') || raw.includes('EXECUTION_READY')) return 'READY';
  if (raw.includes('WAIT')) return 'WAIT';
  if (raw.includes('BLOCK') || raw.includes('FAIL')) return 'BLOCKED';
  return row.gate3Evaluated === true ? 'WAIT' : 'NOT_EVALUATED';
}

function maturityStatusFor(input: {
  returnD1: number | null;
  returnD3: number | null;
  returnD5: number | null;
  returnD10: number | null;
  raw?: string | null;
  dataUnavailable?: boolean;
}): CounterfactualMaturityStatus {
  if (input.dataUnavailable) return 'DATA_UNAVAILABLE';
  const raw = (input.raw ?? '').toUpperCase();
  if (raw.includes('DATA_UNAVAILABLE') || raw.includes('INSUFFICIENT')) return 'DATA_UNAVAILABLE';
  if (input.returnD10 !== null || raw.includes('10')) return 'MATURE_D10';
  if (input.returnD5 !== null || raw.includes('5')) return 'MATURE_D5';
  if (input.returnD3 !== null || raw.includes('3')) return 'MATURE_D3';
  if (input.returnD1 !== null || raw.includes('1')) return 'MATURE_D1';
  return 'PENDING';
}

function appendUnique(values: string[], value: string | null | undefined): void {
  const normalized = text(value);
  if (normalized && !values.includes(normalized)) values.push(normalized);
}

function blockerTokens(row: Partial<CounterfactualOutcomeBoardRow>): string[] {
  return [
    ...(row.blockerVector ?? []),
    row.blockedByPrimary,
    row.blockedBySecondary,
    row.gate2BlockerTop,
    row.gate3BlockerTop,
    row.nearMissType,
    row.rrr !== null && row.rrr !== undefined ? `RRR_${row.rrr}` : null,
    row.volumeStatus,
    row.priceStatus,
    row.lastTriggerStatus,
  ]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.toUpperCase());
}

function classifyGate2Blocker(tokens: readonly string[]): string | null {
  const joined = tokens.join('|');
  if (joined.includes('BREAKOUT') || joined.includes('GATE2_NOT_CONFIRMED')) return 'BREAKOUT_MOMENTUM_NOT_CONFIRMED';
  if (joined.includes('FUNDAMENTAL')) return 'FUNDAMENTAL_UNAVAILABLE';
  if (joined.includes('RELATIVE_STRENGTH') || joined.includes('RS_')) return 'RELATIVE_STRENGTH_FAIL';
  if (joined.includes('VOLUME')) return 'VOLUME_CONFIRMATION_FAIL';
  if (joined.includes('EARNINGS') || joined.includes('QUALITY')) return 'EARNINGS_QUALITY_UNAVAILABLE';
  if (joined.includes('PER')) return 'PER_UNAVAILABLE';
  return null;
}

function classifyGate3Blocker(tokens: readonly string[]): string | null {
  const joined = tokens.join('|');
  if (joined.includes('LAST_TRIGGER') && !joined.includes('FIRED')) return 'LAST_TRIGGER_NOT_FIRED';
  if (joined.includes('PRICE_OVEREXTENDED') || joined.includes('OVEREXTENDED')) return 'PRICE_OVEREXTENDED';
  if (joined.includes('PRICE') && (joined.includes('NOT') || joined.includes('FAIL'))) return 'PRICE_NOT_CONFIRMED';
  if (joined.includes('RRR_FAIL')) return 'RRR_FAIL';
  if (joined.includes('RRR_WATCH') || joined.includes('RRR')) return 'RRR_WATCH';
  if (joined.includes('VOLUME_DRY')) return 'VOLUME_DRY_UP';
  if (joined.includes('VOLUME_WEAK') || joined.includes('VOLUME') && joined.includes('WEAK')) return 'VOLUME_WEAK';
  if (joined.includes('PRE_BREAKOUT') || joined.includes('WAIT')) return 'PRE_BREAKOUT_WAIT';
  return null;
}

function labelOutcome(row: {
  returnD5: number | null;
  mfeD5: number | null;
  maeD5: number | null;
  blockerVector: string[];
  blockedByPrimary: string | null;
  blockedBySecondary: string | null;
  gate3BlockerTop: string | null;
  mfeBeforeMae: boolean | null;
  maturityStatus: CounterfactualMaturityStatus;
}): CounterfactualOutcomeLabel {
  if (row.maturityStatus === 'PENDING' || row.maturityStatus === 'MATURE_D1' || row.maturityStatus === 'MATURE_D3') {
    return 'INSUFFICIENT_MATURITY';
  }
  const tokens = blockerTokens(row);
  const joined = tokens.join('|');
  const dataBlocked = joined.includes('DATA_UNAVAILABLE') || joined.includes('UNAVAILABLE');
  const returnD5 = row.returnD5;
  const mfeD5 = row.mfeD5;
  const maeD5 = row.maeD5;
  if (returnD5 === null && mfeD5 === null && maeD5 === null) return 'INSUFFICIENT_MATURITY';
  if (dataBlocked && returnD5 !== null && returnD5 >= 3) return 'DATA_BLOCKED_BUT_PROFITABLE';
  if (dataBlocked && ((returnD5 !== null && returnD5 < 3) || (maeD5 !== null && maeD5 <= -3))) return 'DATA_BLOCKED_AND_WEAK';
  if ((joined.includes('RRR_FAIL') || row.gate3BlockerTop === 'RRR_FAIL') && (row.mfeBeforeMae === false || (maeD5 !== null && maeD5 <= -3))) {
    return 'RRR_BLOCK_CORRECT';
  }
  if (joined.includes('PRICE_OVEREXTENDED') && ((returnD5 !== null && returnD5 <= 0) || (maeD5 !== null && maeD5 <= -5))) {
    return 'OVEREXTENDED_WAS_CORRECT';
  }
  if (returnD5 !== null && returnD5 >= 3 && (mfeD5 ?? returnD5) >= 5 && (maeD5 === null || maeD5 > -3)) {
    return 'MISSED_OPPORTUNITY';
  }
  if ((returnD5 !== null && returnD5 <= 0) || (maeD5 !== null && maeD5 <= -5)) return 'GOOD_BLOCK';
  if (joined.includes('PRE_BREAKOUT') && returnD5 !== null && returnD5 > 0) return 'LATE_BREAKOUT';
  return 'NO_EDGE';
}

function recommendedActionFor(row: {
  outcomeLabel: CounterfactualOutcomeLabel;
  gate1Band: Gate1OutcomeBand;
  gate2BlockerTop: string | null;
  gate3BlockerTop: string | null;
}): string {
  if (row.outcomeLabel === 'INSUFFICIENT_MATURITY') return 'OBSERVE_MORE';
  if (row.outcomeLabel === 'MISSED_OPPORTUNITY' || row.outcomeLabel === 'DATA_BLOCKED_BUT_PROFITABLE') {
    if (row.gate1Band === '65~70' || row.gate1Band === '60~65') return 'REVIEW_GATE1_BAND_WITH_OPERATOR';
    if (row.gate2BlockerTop) return 'WATCH_GATE2_TIMING';
    if (row.gate3BlockerTop) return 'WATCH_GATE3_TIMING';
    return 'OBSERVE_MORE';
  }
  if (row.outcomeLabel === 'GOOD_BLOCK' || row.outcomeLabel === 'RRR_BLOCK_CORRECT' || row.outcomeLabel === 'OVEREXTENDED_WAS_CORRECT') {
    return 'KEEP_BLOCK';
  }
  return 'NO_THRESHOLD_CHANGE';
}

function finalizeRow(row: Omit<
  CounterfactualOutcomeBoardRow,
  'outcomeLabel' | 'falseNegative' | 'correctBlock' | 'overStrictCondition' | 'recommendedAction' | 'executionImpact' | 'thresholdAutoChanged' | 'operatorApprovalRequired'
>): CounterfactualOutcomeBoardRow {
  const outcomeLabel = labelOutcome(row);
  const falseNegative = outcomeLabel === 'MISSED_OPPORTUNITY' || outcomeLabel === 'DATA_BLOCKED_BUT_PROFITABLE';
  const correctBlock = outcomeLabel === 'GOOD_BLOCK' ||
    outcomeLabel === 'RRR_BLOCK_CORRECT' ||
    outcomeLabel === 'OVEREXTENDED_WAS_CORRECT' ||
    outcomeLabel === 'DATA_BLOCKED_AND_WEAK';
  const overStrictCondition = falseNegative
    ? row.gate2BlockerTop ?? row.gate3BlockerTop ?? (row.gate1PassType === 'FAIL' ? 'GATE1_THRESHOLD' : null)
    : null;
  const recommendedAction = recommendedActionFor({ ...row, outcomeLabel });
  return {
    ...row,
    outcomeLabel,
    falseNegative,
    correctBlock,
    overStrictCondition,
    recommendedAction,
    executionImpact: 'NONE',
    thresholdAutoChanged: false,
    operatorApprovalRequired: true,
  };
}

function rowFromGate1(row: Gate1DryRunObservationRow): CounterfactualOutcomeBoardRow {
  const source = row as unknown as Record<string, unknown>;
  const rowType = inferGate1RowType(row);
  const sourceLane = inferGate1SourceLane(row, rowType);
  const gate1Score = finite(row.dryRunScore) ?? finite(row.actualScore) ?? finite(row.finalGate1Score);
  const gate1Required = finite(row.requiredScore) ?? 70;
  const gate1PassType = gate1PassTypeFor({
    score: gate1Score,
    required: gate1Required,
    hardPass: row.hardPass,
    softPass: row.softPass,
    minSignalLivePass: row.minSignalLivePass,
    diagnosticOnly: row.dryRunDecision === 'UNKNOWN_DIAGNOSTIC_ONLY',
    actualGate1Passed: row.actualGate1Passed,
  });
  const returnD1 = finite(row.forwardReturnD1) ?? finite(row.forwardReturn1D);
  const returnD3 = finite(row.forwardReturnD3) ?? finite(row.forwardReturn3D);
  const returnD5 = finite(row.forwardReturnD5) ?? finite(row.forwardReturn5D);
  const returnD10 = finite(row.forwardReturnD10) ?? finite(row.forwardReturn10D);
  const referencePrice = positive(row.entryReferencePrice);
  const blockerVector: string[] = [];
  appendUnique(blockerVector, row.gate2PrimaryBlocker);
  appendUnique(blockerVector, row.gate3Readiness);
  appendUnique(blockerVector, row.rrrStatus);
  appendUnique(blockerVector, row.volumeConfirmation);
  appendUnique(blockerVector, row.priceConfirmation);
  appendUnique(blockerVector, row.lastTriggerStatus);
  appendUnique(blockerVector, row.dryRunScenario);
  const preliminary = {
    blockerVector,
    blockedByPrimary: row.gate2PrimaryBlocker ?? null,
    blockedBySecondary: row.gate3Readiness ?? row.rrrStatus ?? null,
    gate3BlockerTop: null,
  };
  const gate2BlockerTop = classifyGate2Blocker(blockerTokens(preliminary)) ?? row.gate2PrimaryBlocker ?? null;
  const gate3BlockerTop = classifyGate3Blocker(blockerTokens({ ...preliminary, gate2BlockerTop })) ?? null;
  const gate2Status = gate2StatusFor(row, gate1PassType);
  const gate3Status = gate3StatusFor(row);
  const maturityStatus = maturityStatusFor({
    returnD1,
    returnD3,
    returnD5,
    returnD10,
    raw: row.maturityStatus ?? row.status,
  });

  return finalizeRow({
    sourceType: 'GATE1_DRY_RUN_OBSERVATION',
    rowType,
    sourceLane,
    counterfactualId: row.id,
    scanId: row.scanId ?? null,
    sourceSnapshotId: row.sourceSnapshotId ?? null,
    candidateSetId: row.candidateSetId ?? null,
    symbol: row.symbol,
    name: row.name ?? null,
    recordedAt: row.createdAt,
    marketSession: row.marketSessionState ?? row.marketSession ?? null,
    regimeRaw: row.rawRegime ?? row.regime ?? null,
    regimeEffective: row.effectiveRegime ?? row.displayRegime ?? row.regime ?? null,
    displayPolicy: row.policyView ?? row.policyPromotionMode ?? null,
    referencePrice,
    referencePriceSource: referencePrice !== null ? 'GATE1_DRY_RUN_ENTRY_REFERENCE' : null,
    kospiAtRecord: numberFrom(source, ['kospiAtRecord', 'kospi']),
    kosdaqAtRecord: numberFrom(source, ['kosdaqAtRecord', 'kosdaq']),
    gate1Score,
    gate1Required,
    gate1Band: gate1BandFor(gate1Score),
    scoreSource: row.scoreSource,
    gate1PassType,
    gate2Status,
    gate3Status,
    rrr: numberFrom(source, ['rrr', 'rrrValue']),
    volumeStatus: row.volumeConfirmation ?? null,
    priceStatus: row.priceConfirmation ?? null,
    lastTriggerStatus: row.lastTriggerStatus ?? null,
    blockedByPrimary: preliminary.blockedByPrimary,
    blockedBySecondary: preliminary.blockedBySecondary,
    blockerVector,
    nearMissType: row.dryRunDecision,
    gate2BlockerTop,
    gate3BlockerTop,
    wouldPassIfThresholdMinus5: gate1Score !== null && gate1Required !== null && gate1Score >= gate1Required - 5,
    wouldPassIfThresholdMinus10: gate1Score !== null && gate1Required !== null && gate1Score >= gate1Required - 10,
    wouldPassIfGate2Softened: gate1PassType !== 'FAIL' && gate2Status !== 'PASS',
    wouldPassIfGate3WaitAllowed: gate2Status === 'PASS' && (gate3Status === 'WAIT' || gate3Status === 'BLOCKED'),
    d1Close: priceFromReturn(referencePrice, returnD1),
    d3Close: priceFromReturn(referencePrice, returnD3),
    d5Close: priceFromReturn(referencePrice, returnD5),
    d10Close: priceFromReturn(referencePrice, returnD10),
    returnD1,
    returnD3,
    returnD5,
    returnD10,
    mfeD1: finite(row.mfeD1),
    mfeD3: finite(row.mfeD3),
    mfeD5: finite(row.mfeD5) ?? finite(row.maxFavorableExcursion5D),
    mfeD10: numberFrom(source, ['mfeD10']),
    maeD1: finite(row.maeD1),
    maeD3: finite(row.maeD3),
    maeD5: finite(row.maeD5) ?? finite(row.maxAdverseExcursion5D),
    maeD10: numberFrom(source, ['maeD10']),
    hitPlus3D5: returnD5 !== null ? returnD5 >= 3 : null,
    hitMinus3D5: returnD5 !== null ? returnD5 <= -3 : null,
    hitTP1Virtual: typeof row.targetTouched === 'boolean' ? row.targetTouched : null,
    hitSLVirtual: typeof row.stopLossTouched === 'boolean' ? row.stopLossTouched : null,
    mfeBeforeMae: typeof source.mfeBeforeMae === 'boolean' ? source.mfeBeforeMae : null,
    maturityStatus,
  });
}

function rowFromCounterfactualLedger(entry: CounterfactualShadowLearningLedgerEntry): CounterfactualOutcomeBoardRow {
  const source = entry as unknown as Record<string, unknown>;
  const rowType = inferLedgerRowType(entry);
  const sourceLane = inferLedgerSourceLane(entry, rowType);
  const blockerVector = [...(entry.blockedBy ?? []), ...(entry.reasons ?? [])];
  const gate1PassType: Gate1PassType = entry.gate1Passed === true ? 'HARD_PASS' : 'DIAGNOSTIC_ONLY';
  const gate2Status: Gate2OutcomeStatus = entry.gate2Passed === true
    ? 'PASS'
    : blockerVector.some((item) => item.includes('GATE2')) ? 'FAIL' : 'PENDING';
  const gate3Status: Gate3OutcomeStatus = blockerVector.some((item) => item.includes('WAIT'))
    ? 'WAIT'
    : blockerVector.some((item) => item.includes('BLOCK')) ? 'BLOCKED' : 'NOT_EVALUATED';
  const gate2BlockerTop = classifyGate2Blocker(blockerVector.map((item) => item.toUpperCase()));
  const gate3BlockerTop = classifyGate3Blocker(blockerVector.map((item) => item.toUpperCase()));
  const referencePrice = positive(entry.entryPriceHint);
  const outcomeStatus = text(entry.outcomeStatus);
  const maturityStatus = outcomeStatus === 'DATA_INSUFFICIENT'
    ? 'DATA_UNAVAILABLE'
    : outcomeStatus === 'LABELED' ? 'MATURE_D5' : 'PENDING';

  return finalizeRow({
    sourceType: 'COUNTERFACTUAL_LEDGER',
    rowType,
    sourceLane,
    counterfactualId: entry.scanId ? `${entry.scanId}:${entry.symbol}:ADR-0430` : `${entry.createdAtKst}:${entry.symbol}:ADR-0430`,
    scanId: entry.scanId ?? null,
    sourceSnapshotId: stringFrom(source, ['sourceSnapshotId', 'snapshotId']),
    candidateSetId: stringFrom(source, ['candidateSetId']),
    symbol: entry.symbol,
    name: entry.name ?? null,
    recordedAt: entry.createdAtKst,
    marketSession: entry.marketSession ?? null,
    regimeRaw: entry.rawRegime ?? entry.regime ?? null,
    regimeEffective: entry.effectiveRegime ?? entry.regime ?? null,
    displayPolicy: entry.engineMode ?? 'COUNTERFACTUAL_ONLY',
    referencePrice,
    referencePriceSource: referencePrice !== null ? 'COUNTERFACTUAL_ENTRY_PRICE_HINT' : null,
    kospiAtRecord: numberFrom(source, ['kospiAtRecord', 'kospi']),
    kosdaqAtRecord: numberFrom(source, ['kosdaqAtRecord', 'kosdaq']),
    gate1Score: numberFrom(source, ['gate1Score', 'dryRunScore']),
    gate1Required: numberFrom(source, ['gate1Required', 'requiredScore']) ?? 70,
    gate1Band: gate1BandFor(numberFrom(source, ['gate1Score', 'dryRunScore'])),
    gate1PassType,
    gate2Status,
    gate3Status,
    rrr: numberFrom(source, ['rrr', 'rrrValue']),
    volumeStatus: stringFrom(source, ['volumeStatus', 'volumeConfirmation']),
    priceStatus: stringFrom(source, ['priceStatus', 'priceConfirmation']),
    lastTriggerStatus: stringFrom(source, ['lastTriggerStatus']),
    blockedByPrimary: entry.blockedBy?.[0] ?? entry.label ?? null,
    blockedBySecondary: entry.blockedBy?.[1] ?? entry.routerLabel ?? null,
    blockerVector,
    nearMissType: entry.label,
    gate2BlockerTop,
    gate3BlockerTop,
    wouldPassIfThresholdMinus5: false,
    wouldPassIfThresholdMinus10: false,
    wouldPassIfGate2Softened: gate2Status !== 'PASS',
    wouldPassIfGate3WaitAllowed: gate2Status === 'PASS' && (gate3Status === 'WAIT' || gate3Status === 'BLOCKED'),
    d1Close: null,
    d3Close: null,
    d5Close: null,
    d10Close: null,
    returnD1: null,
    returnD3: null,
    returnD5: null,
    returnD10: null,
    mfeD1: null,
    mfeD3: null,
    mfeD5: null,
    mfeD10: null,
    maeD1: null,
    maeD3: null,
    maeD5: null,
    maeD10: null,
    hitPlus3D5: null,
    hitMinus3D5: null,
    hitTP1Virtual: null,
    hitSLVirtual: null,
    mfeBeforeMae: null,
    maturityStatus,
  });
}

function rowFromLegacyCounterfactual(entry: CounterfactualEntry): CounterfactualOutcomeBoardRow {
  const source = entry as unknown as Record<string, unknown>;
  const rowType = inferLegacyRowType(entry);
  const sourceLane = inferLegacySourceLane(entry, rowType);
  const blockerVector = [entry.blockedReason ?? entry.skipReason, entry.outcomeLabel, entry.outcomeStatus]
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  const gate1Score = finite(entry.gateScore);
  const referencePrice = positive(entry.hypotheticalEntryPrice) ?? positive(entry.priceAtSignal);
  const gate2BlockerTop = classifyGate2Blocker(blockerVector.map((item) => item.toUpperCase()));
  const gate3BlockerTop = classifyGate3Blocker(blockerVector.map((item) => item.toUpperCase()));
  const maturityStatus: CounterfactualMaturityStatus = entry.outcomeStatus === 'DATA_INSUFFICIENT'
    ? 'DATA_UNAVAILABLE'
    : entry.outcomeStatus === 'LABELED' ? 'MATURE_D5' : 'PENDING';
  return finalizeRow({
    sourceType: 'LEGACY_COUNTERFACTUAL',
    rowType,
    sourceLane,
    counterfactualId: entry.id,
    scanId: stringFrom(source, ['scanId']) ?? entry.sourceCandidateId ?? null,
    sourceSnapshotId: stringFrom(source, ['sourceSnapshotId', 'snapshotId']),
    candidateSetId: stringFrom(source, ['candidateSetId']),
    symbol: entry.symbol ?? entry.stockCode,
    name: entry.stockName ?? null,
    recordedAt: entry.signalTime,
    marketSession: entry.marketSession ?? null,
    regimeRaw: entry.rawRegime ?? entry.regime ?? null,
    regimeEffective: entry.effectiveRegime ?? entry.entryEffectiveState ?? entry.regime ?? null,
    displayPolicy: entry.engineMode ?? 'COUNTERFACTUAL_ONLY',
    referencePrice,
    referencePriceSource: referencePrice !== null ? 'LEGACY_COUNTERFACTUAL_REFERENCE' : stringFrom(source, ['referencePriceSource']),
    kospiAtRecord: null,
    kosdaqAtRecord: null,
    gate1Score,
    gate1Required: 70,
    gate1Band: gate1BandFor(gate1Score),
    gate1PassType: gate1PassTypeFor({ score: gate1Score, required: 70 }),
    gate2Status: gate2BlockerTop ? 'FAIL' : 'PENDING',
    gate3Status: gate3BlockerTop ? 'BLOCKED' : 'NOT_EVALUATED',
    rrr: null,
    volumeStatus: null,
    priceStatus: null,
    lastTriggerStatus: null,
    blockedByPrimary: entry.blockedReason ?? entry.skipReason ?? null,
    blockedBySecondary: entry.outcomeLabel ?? null,
    blockerVector,
    nearMissType: entry.skipReason,
    gate2BlockerTop,
    gate3BlockerTop,
    wouldPassIfThresholdMinus5: gate1Score !== null && gate1Score >= 65,
    wouldPassIfThresholdMinus10: gate1Score !== null && gate1Score >= 60,
    wouldPassIfGate2Softened: gate2BlockerTop !== null,
    wouldPassIfGate3WaitAllowed: gate3BlockerTop !== null,
    d1Close: null,
    d3Close: null,
    d5Close: null,
    d10Close: null,
    returnD1: null,
    returnD3: null,
    returnD5: null,
    returnD10: null,
    mfeD1: null,
    mfeD3: null,
    mfeD5: null,
    mfeD10: null,
    maeD1: null,
    maeD3: null,
    maeD5: null,
    maeD10: null,
    hitPlus3D5: null,
    hitMinus3D5: null,
    hitTP1Virtual: entry.outcomeLabel === 'MISSED_WIN' ? true : null,
    hitSLVirtual: entry.outcomeLabel === 'AVOIDED_LOSS' ? true : null,
    mfeBeforeMae: null,
    maturityStatus,
  });
}

function hasBlocker(row: CounterfactualOutcomeBoardRow): boolean {
  return row.blockerVector.length > 0 || row.blockedByPrimary !== null;
}

function hasReference(row: CounterfactualOutcomeBoardRow): boolean {
  return row.referencePrice !== null || row.referencePriceSource !== null;
}

function exclusionReasonFor(row: CounterfactualOutcomeBoardRow): CounterfactualExcludedReason | null {
  if (
    !INCLUDED_ROW_TYPES.has(row.rowType) ||
    !INCLUDED_SOURCE_LANES.has(row.sourceLane) ||
    hasReplayArtifactToken([row.counterfactualId, row.rowType, row.sourceLane])
  ) {
    return row.rowType === 'UNKNOWN' || row.sourceLane === 'UNKNOWN'
      ? 'NOT_A_GATE_COUNTERFACTUAL_ROW'
      : 'DIAGNOSTIC_REPLAY_ARTIFACT';
  }
  if (!text(row.symbol)) return 'MISSING_SYMBOL';
  if (!text(row.recordedAt)) return 'MISSING_RECORDED_AT';
  if (!text(row.scanId)) return 'MISSING_SCAN_ID';
  if (!text(row.sourceSnapshotId)) return 'MISSING_SOURCE_SNAPSHOT_ID';
  if (!text(row.candidateSetId)) return 'MISSING_CANDIDATE_SET_ID';
  if (!hasBlocker(row)) return 'MISSING_BLOCKER';
  if (!hasReference(row)) return 'MISSING_REFERENCE_PRICE';
  return null;
}

function excludedRow(row: CounterfactualOutcomeBoardRow, excludedReason: CounterfactualExcludedReason): CounterfactualExcludedRow {
  return {
    sourceType: row.sourceType,
    rowType: row.rowType,
    sourceLane: row.sourceLane,
    counterfactualId: row.counterfactualId,
    symbol: text(row.symbol),
    scanId: row.scanId,
    sourceSnapshotId: row.sourceSnapshotId,
    candidateSetId: row.candidateSetId,
    gate1Score: row.gate1Score,
    gate1Band: row.gate1Band,
    gate3Status: row.gate3Status,
    excludedReason,
  };
}

function splitCounterfactualRows(rows: readonly CounterfactualOutcomeBoardRow[]): {
  included: CounterfactualOutcomeBoardRow[];
  excluded: CounterfactualExcludedRow[];
} {
  const included: CounterfactualOutcomeBoardRow[] = [];
  const excluded: CounterfactualExcludedRow[] = [];
  for (const row of rows) {
    const reason = exclusionReasonFor(row);
    if (reason) {
      excluded.push(excludedRow(row, reason));
    } else {
      included.push(row);
    }
  }
  return { included, excluded };
}

function scopeRowsByRecentRecordedDates(rows: CounterfactualOutcomeBoardRow[], periodDays: number): CounterfactualOutcomeBoardRow[] {
  const dates = Array.from(new Set(rows.map(recordedDateKey))).sort((a, b) => b.localeCompare(a)).slice(0, periodDays);
  const allowed = new Set(dates);
  return rows.filter((row) => allowed.has(recordedDateKey(row)));
}

function matureRows(rows: readonly CounterfactualOutcomeBoardRow[]): CounterfactualOutcomeBoardRow[] {
  return rows.filter((row) => row.returnD5 !== null);
}

function buildOutcomeSummary(rows: readonly CounterfactualOutcomeBoardRow[]): CounterfactualOutcomeSummary {
  const d5 = matureRows(rows);
  const missed = d5.filter((row) => row.falseNegative).length;
  const correct = d5.filter((row) => row.correctBlock).length;
  const dataUnavailable = rows.filter((row) => blockerTokens(row).some((token) => token.includes('UNAVAILABLE'))).length;
  const missedRate = rate(missed, d5.length);
  const verdict: CounterfactualOutcomeSummary['verdict'] =
    rows.length === 0 ? 'NO_VALID_COUNTERFACTUAL_ROWS'
      : d5.length < 30 ? 'INSUFFICIENT_SAMPLE'
      : (missedRate ?? 0) >= 0.3 ? 'REVIEW_WITH_OPERATOR'
        : (missedRate ?? 0) >= 0.15 ? 'WATCH'
          : correct >= missed ? 'KEEP_BLOCKS' : 'OBSERVE_MORE';
  return {
    totalRecorded: rows.length,
    matureD1: rows.filter((row) => row.returnD1 !== null).length,
    matureD3: rows.filter((row) => row.returnD3 !== null).length,
    matureD5: d5.length,
    matureD10: rows.filter((row) => row.returnD10 !== null).length,
    avgReturnD1: avg(rows.map((row) => row.returnD1)),
    avgReturnD3: avg(rows.map((row) => row.returnD3)),
    avgReturnD5: avg(rows.map((row) => row.returnD5)),
    winRateD5: rate(d5.filter((row) => (row.returnD5 ?? 0) > 0).length, d5.length),
    missedOpportunityRateD5: missedRate,
    correctBlockRateD5: rate(correct, d5.length),
    falseNegativeRateD5: missedRate,
    dataUnavailableRate: rate(dataUnavailable, rows.length) ?? 0,
    verdict,
  };
}

function buildBandOutcome(key: string, rows: readonly CounterfactualOutcomeBoardRow[], includeGate3FalseNegative = false): CounterfactualBandOutcome {
  const d5 = matureRows(rows);
  const missed = d5.filter((row) => row.falseNegative).length;
  const correct = d5.filter((row) => row.correctBlock).length;
  return {
    key,
    count: rows.length,
    matureD5: d5.length,
    avgReturnD5: avg(d5.map((row) => row.returnD5)),
    winRateD5: rate(d5.filter((row) => (row.returnD5 ?? 0) > 0).length, d5.length),
    hitPlus3PctRateD5: rate(d5.filter((row) => row.hitPlus3D5 === true).length, d5.length),
    hitMinus3PctRateD5: rate(d5.filter((row) => row.hitMinus3D5 === true).length, d5.length),
    avgMfeD5: avg(d5.map((row) => row.mfeD5)),
    avgMaeD5: avg(d5.map((row) => row.maeD5)),
    missedOpportunityRateD5: rate(missed, d5.length),
    correctBlockRateD5: rate(correct, d5.length),
    ...(includeGate3FalseNegative ? { falseNegativeRateD5: rate(missed, d5.length) } : {}),
    recommendation: d5.length < 30 ? 'OBSERVE_MORE' : missed > correct ? 'WATCH' : 'KEEP_BLOCK',
  };
}

function groupByKnownKeys(
  rows: readonly CounterfactualOutcomeBoardRow[],
  keys: readonly string[],
  selector: (row: CounterfactualOutcomeBoardRow) => string | null,
  includeFalseNegative = false,
): CounterfactualBandOutcome[] {
  return keys.map((key) => buildBandOutcome(
    key,
    rows.filter((row) => selector(row) === key),
    includeFalseNegative,
  ));
}

function paperObservationalSymbols(summary: ScanSummary | null | undefined): string[] {
  const records = summary?.paperEntryForensic?.decisionRecords ?? [];
  const fromRecords = records
    .filter((record) => record.decision === 'CREATED' && record.paperEntryKind === 'OBSERVATIONAL_PAPER_ENTRY')
    .map((record) => record.symbol);
  if (fromRecords.length > 0) return Array.from(new Set(fromRecords));
  return Array.from(new Set(summary?.paperEntryForensic?.createdSymbols ?? []));
}

function scanIdFromSummary(summary: ScanSummary | null | undefined): string | null {
  const scanEvaluation = summary?.scanEvaluation as { scanId?: string; sourceSnapshotId?: string } | undefined;
  return scanEvaluation?.scanId ?? summary?.snapshotId ?? summary?.time ?? null;
}

function buildTodaySummary(rows: readonly CounterfactualOutcomeBoardRow[], now: Date, lastScanSummary?: ScanSummary | null): CounterfactualTodaySummary {
  const todayKey = kstDateKey(now);
  const todayRows = rows.filter((row) => recordedDateKey(row) === todayKey);
  const entryFilter = lastScanSummary?.entryFilterDecomposition as Record<string, unknown> | undefined;
  const candidatePool = lastScanSummary?.candidatePool as Record<string, unknown> | undefined;
  const totalRecorded =
    finite(entryFilter?.ledgerRowsCreated) ??
    finite(candidatePool?.counterfactualRecorded) ??
    todayRows.length;
  const gateCounterfactualReadyCount = finite(entryFilter?.counterfactualReady) ??
    todayRows.filter((row) => row.gate3Status === 'READY').length;
  const entryCounterfactualRecorded = finite(entryFilter?.counterfactualRecorded) ??
    finite(candidatePool?.counterfactualRecorded) ??
    totalRecorded;
  const scanEvaluation = lastScanSummary?.scanEvaluation as { sourceSnapshotId?: string } | undefined;
  return {
    dateKey: todayKey,
    scanId: scanIdFromSummary(lastScanSummary),
    sourceSnapshotId: scanEvaluation?.sourceSnapshotId ?? lastScanSummary?.snapshotId ?? null,
    totalRecorded,
    gateCounterfactualReadyCount,
    entryCounterfactualRecorded,
    pendingCount: todayRows.filter((row) => row.maturityStatus === 'PENDING').length,
    gate1FailCount: todayRows.filter((row) => row.gate1PassType === 'FAIL').length,
    gate2FailCount: todayRows.filter((row) => row.gate2Status === 'FAIL').length,
    gate3BlockedOrWaitCount: todayRows.filter((row) => row.gate3Status === 'BLOCKED' || row.gate3Status === 'WAIT').length,
    paperObservationalSymbols: paperObservationalSymbols(lastScanSummary),
    thresholdAutoChanged: false,
    executionImpact: 'NONE',
    shadowLearningContinues: true,
    counterfactualAllowed: true,
  };
}

function buildReview(summary: CounterfactualOutcomeSummary, gate2: readonly CounterfactualBandOutcome[], gate3: readonly CounterfactualBandOutcome[]): CounterfactualReviewSummary {
  const gate1ReviewReady = summary.matureD5 >= 100;
  const gate2ReviewReady = gate2.some((item) => item.matureD5 >= 50);
  const gate3ReviewReady = summary.matureD5 >= 100 && gate3.some((item) => item.matureD5 >= 30);
  const blockers = [
    gate1ReviewReady ? '' : 'GATE1_D5_SAMPLE_LT_100',
    gate2ReviewReady ? '' : 'GATE2_BLOCKER_D5_SAMPLE_LT_50',
    gate3ReviewReady ? '' : 'GATE3_D5_SAMPLE_LT_100_OR_GROUP_LT_30',
  ].filter(Boolean);
  const ready = gate1ReviewReady && gate2ReviewReady && gate3ReviewReady;
  return {
    gate1ReviewReady,
    gate2ReviewReady,
    gate3ReviewReady,
    status: ready ? 'READY_FOR_OPERATOR_REVIEW' : 'INSUFFICIENT_SAMPLE',
    nextAction: ready ? 'OPERATOR_REVIEW' : 'OBSERVE_MORE',
    blockers,
  };
}

function countWith(rows: readonly CounterfactualOutcomeBoardRow[], predicate: (row: CounterfactualOutcomeBoardRow) => boolean): number {
  return rows.filter(predicate).length;
}

function linkagePass(count: number, total: number): boolean {
  return total > 0 && count / total >= 0.95;
}

function buildSafety(rows: readonly CounterfactualOutcomeBoardRow[]): CounterfactualSafetyChecks {
  const linkedRows = rows.filter((row) => Boolean(row.scanId) && Boolean(row.sourceSnapshotId) && Boolean(row.candidateSetId)).length;
  return {
    counterfactualReportingNonExecutional: rows.every((row) => row.executionImpact === 'NONE'),
    thresholdAutoChangeForbidden: rows.every((row) => row.thresholdAutoChanged === false),
    livePermissionUnchanged: true,
    shadowLearningContinues: true,
    sourceSnapshotLinked: linkagePass(linkedRows, rows.length),
    outcomeMaturityRequired: rows.every((row) =>
      row.outcomeLabel === 'INSUFFICIENT_MATURITY' ||
      row.maturityStatus === 'MATURE_D5' ||
      row.maturityStatus === 'MATURE_D10' ||
      row.maturityStatus === 'DATA_UNAVAILABLE'),
    gateBlockerAttributionPreserved: rows.length === 0 || rows.every((row) => row.blockerVector.length > 0 || row.blockedByPrimary !== null),
  };
}

function incrementDistribution(target: Record<string, number>, key: string | null | undefined): void {
  const normalized = text(key) ?? 'N/A';
  target[normalized] = (target[normalized] ?? 0) + 1;
}

function idPrefix(id: string): string {
  const upper = id.toUpperCase();
  const replay = REPLAY_ARTIFACT_TOKENS.find((token) => upper.includes(token));
  if (replay) return replay;
  const beforeColon = id.split(':')[0]?.trim();
  return beforeColon ? beforeColon.slice(0, 64) : 'N/A';
}

function buildDebugSummary(
  rawRows: readonly CounterfactualOutcomeBoardRow[],
  rows: readonly CounterfactualOutcomeBoardRow[],
  excludedRows: readonly CounterfactualExcludedRow[],
): CounterfactualDebugSummary {
  const rowTypeDistribution: Record<string, number> = {};
  const sourceLaneDistribution: Record<string, number> = {};
  const idPrefixDistribution: Record<string, number> = {};
  const excludedReasonDistribution: Record<string, number> = {};

  for (const row of rawRows) {
    incrementDistribution(rowTypeDistribution, row.rowType);
    incrementDistribution(sourceLaneDistribution, row.sourceLane);
    incrementDistribution(idPrefixDistribution, idPrefix(row.counterfactualId));
  }
  for (const row of excludedRows) {
    incrementDistribution(excludedReasonDistribution, row.excludedReason);
  }

  return {
    totalRawRows: rawRows.length,
    includedRows: rows.length,
    excludedRows: excludedRows.length,
    rowTypeDistribution,
    sourceLaneDistribution,
    idPrefixDistribution,
    hasSymbolCount: countWith(rows, (row) => Boolean(text(row.symbol))),
    hasScanIdCount: countWith(rows, (row) => Boolean(row.scanId)),
    hasSourceSnapshotIdCount: countWith(rows, (row) => Boolean(row.sourceSnapshotId)),
    hasCandidateSetIdCount: countWith(rows, (row) => Boolean(row.candidateSetId)),
    hasGate1ScoreCount: countWith(rows, (row) => row.gate1Score !== null || row.gate1Band !== 'UNSCORED'),
    hasBlockedByCount: countWith(rows, hasBlocker),
    excludedReasonDistribution,
    excludedSampleRows: excludedRows.slice(0, 3),
  };
}

/**
 * recordedAt(이후, exclusive) → now(포함) 사이의 KRX 거래일 경과수. 주말/공휴일 판정은
 * krxTradingCalendar(isKrxTradingDay → isKrxHoliday SSOT) 에 위임 — 두 번째 캘린더 산식
 * 신설 금지(ADR-0559/0591). 산식: oldest 기록일의 다음 일자부터 now 까지 하루씩 walk 하며
 * 거래일만 카운트. now 가 oldest 보다 앞서거나 같으면 0.
 */
function tradingDaysSinceRecorded(oldestRecordedAt: string, now: Date): number | null {
  const startKey = toKstDateKey(oldestRecordedAt);
  const endKey = toKstDateKey(now);
  if (!startKey || !endKey || endKey <= startKey) return startKey && endKey ? 0 : null;
  let count = 0;
  let cursorMs = new Date(`${startKey}T03:00:00.000Z`).getTime();
  const endMs = new Date(`${endKey}T03:00:00.000Z`).getTime();
  // calendar-day walk 상한(약 1년) — 무한루프 방지. 거래일만 isKrxTradingDay 로 가산.
  for (let i = 0; i < 400 && cursorMs < endMs; i += 1) {
    cursorMs += 86_400_000;
    const cursorKey = toKstDateKey(new Date(cursorMs));
    if (cursorKey && cursorKey <= endKey && isKrxTradingDay(cursorKey)) count += 1;
  }
  return count;
}

/**
 * 관측 전용 가드. canonical 밴드 적격 행(included, gate1Band≠UNSCORED, scoreSource=MIN_SIGNAL_TRACE)
 * 의 matureD5 합이 0 인데 가장 오래된 행이 STALL_THRESHOLD 거래일 이상 늙었으면 STALL_SUSPECTED.
 * 신규 fetch 0 — 이미 메모리상 included rows + canonical 밴드 집계만 사용.
 */
function buildBandMaturityStallGuard(
  canonicalBands: readonly CounterfactualBandOutcome[],
  includedRows: readonly CounterfactualOutcomeBoardRow[],
  excludedReasonDistribution: Record<string, number>,
  now: Date,
): BandMaturityStallGuard {
  const eligibleRows = includedRows.filter(
    (row) => row.gate1Band !== 'UNSCORED' && row.scoreSource === 'MIN_SIGNAL_TRACE',
  );
  const totalBandMatureD5 = canonicalBands.reduce((sum, band) => sum + band.matureD5, 0);
  const totalBandRows = canonicalBands.reduce((sum, band) => sum + band.count, 0);
  const excludedReferencePriceCount = excludedReasonDistribution.MISSING_REFERENCE_PRICE ?? 0;
  const oldestRecordedAt = eligibleRows.reduce<string | null>(
    (oldest, row) => (oldest === null || row.recordedAt < oldest ? row.recordedAt : oldest),
    null,
  );
  const oldestBandRowAgeTradingDays =
    oldestRecordedAt !== null ? tradingDaysSinceRecorded(oldestRecordedAt, now) : null;

  let status: BandMaturityStallStatus;
  let reason: string;
  let recommendedAction: BandMaturityStallGuard['recommendedAction'];
  if (totalBandMatureD5 > 0) {
    status = 'HEALTHY';
    reason = `canonical bands have matured D5 rows (${totalBandMatureD5}/${totalBandRows}); pipeline write-back is live`;
    recommendedAction = 'NONE';
  } else if (
    oldestBandRowAgeTradingDays !== null &&
    oldestBandRowAgeTradingDays >= BAND_MATURITY_STALL_THRESHOLD_TRADING_DAYS
  ) {
    status = 'STALL_SUSPECTED';
    reason = `canonical matureD5=0 but oldest band row is ${oldestBandRowAgeTradingDays} trading days old (>=${BAND_MATURITY_STALL_THRESHOLD_TRADING_DAYS}); suspect labeler write-back or reference price wiring (missingRefPrice=${excludedReferencePriceCount})`;
    recommendedAction = 'INVESTIGATE_LABELER_WRITEBACK_OR_REFERENCE_PRICE';
  } else {
    status = 'IMMATURE_WAITING';
    reason =
      oldestBandRowAgeTradingDays === null
        ? 'no canonical band-eligible rows yet; nothing to mature'
        : `canonical matureD5=0 and oldest band row is ${oldestBandRowAgeTradingDays} trading days old (<${BAND_MATURITY_STALL_THRESHOLD_TRADING_DAYS}); still within normal maturation window`;
    recommendedAction = 'OBSERVE_MORE';
  }

  return {
    status,
    oldestBandRowAgeTradingDays,
    totalBandMatureD5,
    totalBandRows,
    stallThresholdTradingDays: BAND_MATURITY_STALL_THRESHOLD_TRADING_DAYS,
    reason,
    recommendedAction,
    excludedReferencePriceCount,
    executionImpact: 'NONE',
    observationOnly: true,
  };
}

export async function buildCounterfactualOutcomeBoard(
  options: CounterfactualOutcomeBoardOptions = {},
): Promise<CounterfactualOutcomeBoard> {
  const now = options.now ?? new Date();
  const periodDays = options.periodDays ?? 20;
  const gate1Rows = options.gate1Rows ?? await listGate1DryRunObservationRows();
  const counterfactualEntries = options.counterfactualEntries ?? loadCounterfactualShadowLearningLedger();
  const legacyEntries = options.legacyEntries ?? loadCounterfactuals();
  const normalized = [
    ...gate1Rows.map(rowFromGate1),
    ...counterfactualEntries.map(rowFromCounterfactualLedger),
    ...legacyEntries.map(rowFromLegacyCounterfactual),
  ].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  const selected = splitCounterfactualRows(normalized);
  const rows = scopeRowsByRecentRecordedDates(selected.included, periodDays);
  const summary = buildOutcomeSummary(rows);
  // 점수 신뢰 필터(2026-06-11 patch): canonical(scoreSource=MIN_SIGNAL_TRACE) 행만 밴드 증거로
  // 집계 — 구 스케일(27조건 gateScore) 혼입 행은 legacyScaleMixed 로 분리 표시 (silent 제거 금지).
  // KOSPI join (2026-07-03 patch): 표시 전용 초과수익 D5 — 실패 시 UNAVAILABLE graceful
  // (providerIssue≠marketSignal, Yahoo fallback 금지). 기존 밴드 값 무변경 (additive).
  const kospiJoin = await buildCounterfactualKospiJoinContext(rows, now);
  const gate1Bands = GATE1_BANDS.map((band) => {
    const bandRows = rows.filter((row) => row.gate1Band === band && row.scoreSource === 'MIN_SIGNAL_TRACE');
    return attachKospiExcessD5ToBand(buildBandOutcome(band, bandRows), bandRows, kospiJoin);
  });
  const gate1LegacyScale = buildBandOutcome('legacyScaleMixed', rows.filter((row) => row.gate1Band !== 'UNSCORED' && row.scoreSource !== 'MIN_SIGNAL_TRACE'));
  const gate2Blockers = groupByKnownKeys(rows, GATE2_BLOCKERS, (row) => row.gate2BlockerTop);
  const gate3Blockers = groupByKnownKeys(rows, GATE3_BLOCKERS, (row) => row.gate3BlockerTop, true);
  const topMissedOpportunities = rows
    .filter((row) => row.falseNegative && row.returnD5 !== null)
    .sort((a, b) => (b.returnD5 ?? 0) - (a.returnD5 ?? 0))
    .slice(0, 10);
  const today = buildTodaySummary(rows, now, options.lastScanSummary);
  const review = buildReview(summary, gate2Blockers, gate3Blockers);
  const safety = buildSafety(rows);
  const debug = buildDebugSummary(normalized, rows, selected.excluded);
  const bandMaturityStallGuard = buildBandMaturityStallGuard(
    gate1Bands,
    rows,
    debug.excludedReasonDistribution,
    now,
  );
  return {
    generatedAt: now.toISOString(),
    periodLabel: `recent ${periodDays} recorded sessions`,
    rows,
    summary,
    gate1Bands,
    gate1LegacyScale,
    gate2Blockers,
    gate3Blockers,
    topMissedOpportunities,
    bandMaturityStallGuard,
    ...computeBoardKospiContextD5(rows, kospiJoin),
    today,
    review,
    safety,
    debug,
    thresholdAutoChanged: false,
    operatorApprovalRequired: true,
    executionImpact: 'NONE',
  };
}

// ADR-0610: 표시(format) 레이어는 counterfactualOutcomeBoardFormat.ts 로 추출됨(byte-equivalent
// re-export → 호출처 import 경로 무변경). build(집계)/format(표시) SRP 분리 + ACMA 1500 여유 확보.
export {
  formatCounterfactualSafetyChecks,
  formatCounterfactualBoardSummary,
  formatCounterfactualGate1,
  formatCounterfactualGate2,
  formatCounterfactualGate3,
  formatCounterfactualMissed,
  formatCounterfactualToday,
  formatCounterfactualReview,
  formatCounterfactualDebug,
  resolveCounterfactualCommandMode,
  formatCounterfactualCommandReply,
} from './counterfactualOutcomeBoardFormat.js';
export type { CounterfactualCommandMode } from './counterfactualOutcomeBoardFormat.js';
