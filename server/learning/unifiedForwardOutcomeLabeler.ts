// @responsibility Unified D1/D3/D5/D10 forward-outcome labeling bus; learning evidence only, zero execution/threshold mutation.

import fs from 'fs';
import path from 'path';
import { fetchHistoricalClosePrice } from '../clients/historicalClosePrice.js';
import { DATA_DIR, ensureDataDir } from '../persistence/paths.js';
import {
  loadGate3OutcomeSeeds,
  persistGate3OutcomeSeed,
} from '../persistence/gate3OutcomeRepo.js';
import {
  getAllNearMissOutcomes,
  refreshNearMissOutcomeLedger,
  type NearMissOutcomeEntry,
} from '../persistence/nearMissOutcomeLedger.js';
import {
  loadCounterfactualShadowLearningLedger,
  type CounterfactualShadowLearningLedgerEntry,
} from '../persistence/counterfactualShadowLearningRepo.js';
import {
  listGate1DryRunObservationRows,
  updateGate1DryRunObservationOutcomes,
  type Gate1DryRunObservationRow,
} from '../trading/signalScanner/gate1DryRunObservationLedgerAdr0476.js';
import {
  updatePendingGate3Outcomes,
  type Gate3ForwardHorizon,
  type Gate3ForwardPriceSnapshot,
} from '../quant/gate3ForwardReturn.js';
import { buildGate3EvidenceScore } from '../quant/gate3EvidenceScore.js';
import { tradingDaysBetween } from '../quant/gate3EvidenceWarmup.js';
import type { Gate3OutcomeSeed } from '../quant/gate3OutcomeSeed.js';
import { addBusinessDaysFromKstDate } from '../trading/krxHolidays.js';

export type UnifiedForwardOutcomeSourceType =
  | 'GATE3_OUTCOME_SEED'
  | 'GATE3_THRESHOLD_EVIDENCE'
  | 'GATE1_DRY_RUN_OBSERVATION'
  | 'NEAR_MISS_OUTCOME'
  | 'COUNTERFACTUAL_LEDGER'
  | 'PAPER_OBSERVATIONAL_ENTRY'
  | 'SHADOW_PROMOTION_AUDIT'
  | 'PRE_BREAKOUT_OBSERVATION';

export type UnifiedForwardOutcomeHorizon = 'D1' | 'D3' | 'D5' | 'D10';
export type UnifiedForwardOutcomeEvidenceStatus = 'PENDING' | 'PARTIAL' | 'LABELED' | 'DATA_INSUFFICIENT';
export type UnifiedForwardOutcomeHorizonStatus = 'PENDING' | 'UPDATED' | 'NOT_DUE' | 'UNSUPPORTED';

export interface UnifiedForwardOutcomeSourceRegistryEntry {
  sourceType: UnifiedForwardOutcomeSourceType;
  sourceTableOrRepo: string;
  enabled: boolean;
  diagnosticOnly: boolean;
  includeInExecutablePnL: boolean;
  includeInForwardEvidence: boolean;
  includeInGateCalibration: boolean;
  includeInNearMissAnalytics: boolean;
  includeInGate3Evidence?: boolean;
  includeInGate1Calibration?: boolean;
  includeInCounterfactualEvidence?: boolean;
  executionImpact: 'NONE';
}

export interface UnifiedPaperObservationalEntry {
  outcomeId: string;
  symbol: string;
  decisionType: string;
  entryReferencePrice?: number;
  createdAt: string;
  sourceSnapshotId?: string;
  gateScoreInputSnapshotId?: string;
}

export interface UnifiedForwardOutcomeRow {
  outcomeId: string;
  sourceType: UnifiedForwardOutcomeSourceType;
  sourceLedgerId: string;
  symbol: string;
  symbolName: string | null;
  decisionType: string;
  decisionLabel: string | null;
  entryReferencePrice: number | null;
  entryReferenceTime: string | null;
  createdAt: string;
  tradeDate: string | null;
  sourceSnapshotId: string | null;
  gateScoreInputSnapshotId: string | null;
  candidateSetId: string | null;
  marketSession: string | null;
  engineMode: string | null;
  regime: string | null;
  policyView: string | null;
  liveExecutionAllowedAtCreation: boolean;
  shadowAllowedAtCreation: boolean;
  counterfactualAllowedAtCreation: boolean;
  horizonStatus: Record<UnifiedForwardOutcomeHorizon, UnifiedForwardOutcomeHorizonStatus>;
  horizonStatusD1: UnifiedForwardOutcomeHorizonStatus;
  horizonStatusD3: UnifiedForwardOutcomeHorizonStatus;
  horizonStatusD5: UnifiedForwardOutcomeHorizonStatus;
  horizonStatusD10: UnifiedForwardOutcomeHorizonStatus;
  forwardReturnD1: number | null;
  forwardReturnD3: number | null;
  forwardReturnD5: number | null;
  forwardReturnD10: number | null;
  priceAtD1: number | null;
  priceAtD3: number | null;
  priceAtD5: number | null;
  priceAtD10: number | null;
  labelD1: string | null;
  labelD3: string | null;
  labelD5: string | null;
  labelD10: string | null;
  label: string | null;
  evidenceStatus: UnifiedForwardOutcomeEvidenceStatus;
  dataUnavailableReason: string | null;
  duplicateKey: string;
  lastUpdatedAt: string | null;
  executionImpact: 'NONE';
  marketSignal: false;
}

export interface UnifiedForwardOutcomeLabelerSummary {
  unifiedOutcomeLabelerHealthy: boolean;
  sourceRowsScanned: number;
  rowsUpdatedD1: number;
  rowsUpdatedD3: number;
  rowsUpdatedD5: number;
  rowsUpdatedD10: number;
  dataUnavailable: number;
  duplicateSuppressed: number;
  stalePending: number;
  sourceRowsByType: Partial<Record<UnifiedForwardOutcomeSourceType, number>>;
  gate3EvidenceSampleSize: number;
  gate1CalibrationSampleSize: number;
  nearMissEvidenceSampleSize: number;
  counterfactualEvidenceSampleSize: number;
  paperObservationalEvidenceSampleSize: number;
  lastLabelingRunAt: string | null;
  lastLabelingErrorSanitized: string | null;
  liveExecutionAllowed: false;
  executionImpact: 'NONE';
  shadowLearning: true;
  counterfactualAllowed: true;
  thresholdAutoChanged: false;
}

export type UnifiedForwardOutcomePriceFetcher = (
  symbol: string,
  asOf: Date,
  row: UnifiedForwardOutcomeRow,
) => Promise<number | null | undefined>;

export interface UnifiedForwardOutcomeLabelerOptions {
  now?: Date;
  priceFetcher?: UnifiedForwardOutcomePriceFetcher;
  gate3Seeds?: readonly Gate3OutcomeSeed[];
  gate1Rows?: readonly Gate1DryRunObservationRow[];
  nearMissEntries?: readonly NearMissOutcomeEntry[];
  counterfactualEntries?: readonly CounterfactualShadowLearningLedgerEntry[];
  paperEntries?: readonly UnifiedPaperObservationalEntry[];
  persist?: boolean;
}

export const UNIFIED_FORWARD_OUTCOME_LABELER_STATUS_FILE = path.join(
  DATA_DIR,
  'unified-forward-outcome-labeler-status.json',
);

export const UNIFIED_FORWARD_OUTCOME_SOURCE_REGISTRY: readonly UnifiedForwardOutcomeSourceRegistryEntry[] = Object.freeze([
  {
    sourceType: 'GATE3_OUTCOME_SEED',
    sourceTableOrRepo: 'gate3OutcomeRepo',
    enabled: true,
    diagnosticOnly: true,
    includeInExecutablePnL: false,
    includeInForwardEvidence: true,
    includeInGateCalibration: true,
    includeInNearMissAnalytics: false,
    includeInGate3Evidence: true,
    executionImpact: 'NONE',
  },
  {
    sourceType: 'GATE3_THRESHOLD_EVIDENCE',
    sourceTableOrRepo: 'buildGate3EvidenceScore',
    enabled: true,
    diagnosticOnly: true,
    includeInExecutablePnL: false,
    includeInForwardEvidence: true,
    includeInGateCalibration: true,
    includeInNearMissAnalytics: false,
    includeInGate3Evidence: true,
    executionImpact: 'NONE',
  },
  {
    sourceType: 'GATE1_DRY_RUN_OBSERVATION',
    sourceTableOrRepo: 'gate1DryRunObservationLedgerAdr0476',
    enabled: true,
    diagnosticOnly: true,
    includeInExecutablePnL: false,
    includeInForwardEvidence: true,
    includeInGateCalibration: true,
    includeInNearMissAnalytics: false,
    includeInGate1Calibration: true,
    executionImpact: 'NONE',
  },
  {
    sourceType: 'NEAR_MISS_OUTCOME',
    sourceTableOrRepo: 'nearMissOutcomeLedger',
    enabled: true,
    diagnosticOnly: true,
    includeInExecutablePnL: false,
    includeInForwardEvidence: true,
    includeInGateCalibration: false,
    includeInNearMissAnalytics: true,
    executionImpact: 'NONE',
  },
  {
    sourceType: 'COUNTERFACTUAL_LEDGER',
    sourceTableOrRepo: 'counterfactualShadowLearningRepo',
    enabled: true,
    diagnosticOnly: true,
    includeInExecutablePnL: false,
    includeInForwardEvidence: true,
    includeInGateCalibration: false,
    includeInNearMissAnalytics: false,
    includeInCounterfactualEvidence: true,
    executionImpact: 'NONE',
  },
  {
    sourceType: 'PAPER_OBSERVATIONAL_ENTRY',
    sourceTableOrRepo: 'paperEntryForensic.observational',
    enabled: true,
    diagnosticOnly: true,
    includeInExecutablePnL: false,
    includeInForwardEvidence: true,
    includeInGateCalibration: false,
    includeInNearMissAnalytics: false,
    executionImpact: 'NONE',
  },
  {
    sourceType: 'SHADOW_PROMOTION_AUDIT',
    sourceTableOrRepo: 'shadowPromotionAudit.optional',
    enabled: false,
    diagnosticOnly: true,
    includeInExecutablePnL: false,
    includeInForwardEvidence: true,
    includeInGateCalibration: false,
    includeInNearMissAnalytics: false,
    executionImpact: 'NONE',
  },
  {
    sourceType: 'PRE_BREAKOUT_OBSERVATION',
    sourceTableOrRepo: 'preBreakoutObservation.optional',
    enabled: false,
    diagnosticOnly: true,
    includeInExecutablePnL: false,
    includeInForwardEvidence: true,
    includeInGateCalibration: false,
    includeInNearMissAnalytics: true,
    executionImpact: 'NONE',
  },
]);

const GATE3_HORIZONS: Array<{ key: Gate3ForwardHorizon; label: UnifiedForwardOutcomeHorizon; days: number }> = [
  { key: 'd1', label: 'D1', days: 1 },
  { key: 'd3', label: 'D3', days: 3 },
  { key: 'd5', label: 'D5', days: 5 },
  { key: 'd10', label: 'D10', days: 10 },
];

export function isUnifiedForwardOutcomeLabelerEnabled(): boolean {
  return process.env.UNIFIED_FORWARD_OUTCOME_LABELER_ENABLED !== 'false';
}

function positiveFinite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toUtcDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

function nowKstYmd(now: Date): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

function sanitizeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/[\r\n]+/g, ' ').slice(0, 180);
}

function defaultSummary(error: string | null = null): UnifiedForwardOutcomeLabelerSummary {
  return {
    unifiedOutcomeLabelerHealthy: error === null,
    sourceRowsScanned: 0,
    rowsUpdatedD1: 0,
    rowsUpdatedD3: 0,
    rowsUpdatedD5: 0,
    rowsUpdatedD10: 0,
    dataUnavailable: 0,
    duplicateSuppressed: 0,
    stalePending: 0,
    sourceRowsByType: {},
    gate3EvidenceSampleSize: 0,
    gate1CalibrationSampleSize: 0,
    nearMissEvidenceSampleSize: 0,
    counterfactualEvidenceSampleSize: 0,
    paperObservationalEvidenceSampleSize: 0,
    lastLabelingRunAt: null,
    lastLabelingErrorSanitized: error,
    liveExecutionAllowed: false,
    executionImpact: 'NONE',
    shadowLearning: true,
    counterfactualAllowed: true,
    thresholdAutoChanged: false,
  };
}

function writeStatus(summary: UnifiedForwardOutcomeLabelerSummary): void {
  ensureDataDir();
  fs.writeFileSync(UNIFIED_FORWARD_OUTCOME_LABELER_STATUS_FILE, JSON.stringify(summary, null, 2));
}

function readStatus(): UnifiedForwardOutcomeLabelerSummary | null {
  if (!fs.existsSync(UNIFIED_FORWARD_OUTCOME_LABELER_STATUS_FILE)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(UNIFIED_FORWARD_OUTCOME_LABELER_STATUS_FILE, 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed as UnifiedForwardOutcomeLabelerSummary : null;
  } catch {
    return null;
  }
}

export function getLastUnifiedForwardOutcomeLabelerSummary(): UnifiedForwardOutcomeLabelerSummary | null {
  return readStatus();
}

export function horizonIdempotencyKey(
  row: Pick<UnifiedForwardOutcomeRow, 'sourceType' | 'outcomeId' | 'symbol'> & { sourceLedgerId?: string },
  horizon: UnifiedForwardOutcomeHorizon,
): string {
  return `${row.sourceType}:${row.sourceLedgerId ?? row.outcomeId}:${row.symbol}:${horizon}`;
}

function horizonStatus(returnValue: number | null, supported: boolean, due: boolean): UnifiedForwardOutcomeHorizonStatus {
  if (!supported) return 'UNSUPPORTED';
  if (returnValue !== null) return 'UPDATED';
  return due ? 'PENDING' : 'NOT_DUE';
}

function duplicateKey(row: Pick<UnifiedForwardOutcomeRow, 'sourceType' | 'sourceLedgerId' | 'symbol'>): string {
  return `${row.sourceType}:${row.sourceLedgerId}:${row.symbol}`;
}

function priceFromReturn(entryReferencePrice: number | null, forwardReturn: number | null): number | null {
  if (entryReferencePrice === null || forwardReturn === null) return null;
  return Math.round(entryReferencePrice * (1 + forwardReturn / 100) * 100) / 100;
}

function dataUnavailableReasonFor(statuses: Record<UnifiedForwardOutcomeHorizon, UnifiedForwardOutcomeHorizonStatus>): string | null {
  return Object.values(statuses).some((status) => status === 'PENDING') ? 'DATA_UNAVAILABLE' : null;
}

function completeRow(
  row: Omit<
    UnifiedForwardOutcomeRow,
    | 'horizonStatusD1'
    | 'horizonStatusD3'
    | 'horizonStatusD5'
    | 'horizonStatusD10'
    | 'priceAtD1'
    | 'priceAtD3'
    | 'priceAtD5'
    | 'priceAtD10'
    | 'dataUnavailableReason'
    | 'duplicateKey'
  >,
): UnifiedForwardOutcomeRow {
  return {
    ...row,
    horizonStatusD1: row.horizonStatus.D1,
    horizonStatusD3: row.horizonStatus.D3,
    horizonStatusD5: row.horizonStatus.D5,
    horizonStatusD10: row.horizonStatus.D10,
    priceAtD1: priceFromReturn(row.entryReferencePrice, row.forwardReturnD1),
    priceAtD3: priceFromReturn(row.entryReferencePrice, row.forwardReturnD3),
    priceAtD5: priceFromReturn(row.entryReferencePrice, row.forwardReturnD5),
    priceAtD10: priceFromReturn(row.entryReferencePrice, row.forwardReturnD10),
    dataUnavailableReason: dataUnavailableReasonFor(row.horizonStatus),
    duplicateKey: duplicateKey(row),
  };
}

function gate3Row(seed: Gate3OutcomeSeed, now: Date): UnifiedForwardOutcomeRow {
  const today = nowKstYmd(now);
  const isDue = (days: number) => today >= addBusinessDaysFromKstDate(seed.tradeDate, days);
  const horizonStatusByKey = {
    D1: horizonStatus(finite(seed.forwardReturns.d1), true, isDue(1)),
    D3: horizonStatus(finite(seed.forwardReturns.d3), true, isDue(3)),
    D5: horizonStatus(finite(seed.forwardReturns.d5), true, isDue(5)),
    D10: horizonStatus(finite(seed.forwardReturns.d10), true, isDue(10)),
  } satisfies Record<UnifiedForwardOutcomeHorizon, UnifiedForwardOutcomeHorizonStatus>;
  return completeRow({
    outcomeId: seed.id,
    sourceType: 'GATE3_OUTCOME_SEED',
    sourceLedgerId: seed.id,
    symbol: seed.symbol,
    symbolName: null,
    decisionType: seed.readiness,
    decisionLabel: seed.learningLabel,
    entryReferencePrice: seed.entryReferencePrice,
    entryReferenceTime: seed.asOf,
    createdAt: seed.asOf,
    tradeDate: seed.tradeDate,
    sourceSnapshotId: seed.sourceSnapshotId,
    gateScoreInputSnapshotId: seed.gate3SnapshotId,
    candidateSetId: null,
    marketSession: null,
    engineMode: null,
    regime: null,
    policyView: seed.route,
    liveExecutionAllowedAtCreation: false,
    shadowAllowedAtCreation: seed.route === 'SHADOW_ENTRY_ALLOWED',
    counterfactualAllowedAtCreation: seed.route === 'COUNTERFACTUAL_ONLY',
    horizonStatus: horizonStatusByKey,
    forwardReturnD1: finite(seed.forwardReturns.d1),
    forwardReturnD3: finite(seed.forwardReturns.d3),
    forwardReturnD5: finite(seed.forwardReturns.d5),
    forwardReturnD10: finite(seed.forwardReturns.d10),
    labelD1: finite(seed.forwardReturns.d1) !== null ? seed.outcomeLabel : null,
    labelD3: finite(seed.forwardReturns.d3) !== null ? seed.outcomeLabel : null,
    labelD5: finite(seed.forwardReturns.d5) !== null ? seed.outcomeLabel : null,
    labelD10: finite(seed.forwardReturns.d10) !== null ? seed.outcomeLabel : null,
    label: seed.outcomeLabel,
    evidenceStatus: seed.outcomeStatus === 'LABELED' ? 'LABELED' : seed.outcomeStatus === 'DATA_INSUFFICIENT' ? 'DATA_INSUFFICIENT' : seed.outcomeStatus === 'PARTIAL' ? 'PARTIAL' : 'PENDING',
    lastUpdatedAt: seed.outcomeStatus === 'LABELED' ? now.toISOString() : null,
    executionImpact: 'NONE',
    marketSignal: false,
  });
}

function gate1Row(row: Gate1DryRunObservationRow, now: Date): UnifiedForwardOutcomeRow {
  const today = nowKstYmd(now);
  const due = (days: number) => today >= addBusinessDaysFromKstDate(row.forDate, days);
  const horizonStatusByKey = {
    D1: horizonStatus(finite(row.forwardReturn1D), true, due(1)),
    D3: horizonStatus(finite(row.forwardReturn3D), true, due(3)),
    D5: horizonStatus(finite(row.forwardReturn5D), true, due(5)),
    D10: 'UNSUPPORTED',
  } satisfies Record<UnifiedForwardOutcomeHorizon, UnifiedForwardOutcomeHorizonStatus>;
  return completeRow({
    outcomeId: row.id,
    sourceType: 'GATE1_DRY_RUN_OBSERVATION',
    sourceLedgerId: row.id,
    symbol: row.symbol,
    symbolName: row.name ?? null,
    decisionType: row.dryRunDecision,
    decisionLabel: row.dryRunScenario,
    entryReferencePrice: positiveFinite(row.entryReferencePrice),
    entryReferenceTime: row.createdAt,
    createdAt: row.createdAt,
    tradeDate: row.forDate,
    sourceSnapshotId: row.forDate,
    gateScoreInputSnapshotId: null,
    candidateSetId: null,
    marketSession: row.sellOnly ? 'CLOSED_OR_SELL_ONLY' : null,
    engineMode: row.policyPromotionMode,
    regime: null,
    policyView: row.policyPromotionMode,
    liveExecutionAllowedAtCreation: false,
    shadowAllowedAtCreation: true,
    counterfactualAllowedAtCreation: true,
    horizonStatus: horizonStatusByKey,
    forwardReturnD1: finite(row.forwardReturn1D),
    forwardReturnD3: finite(row.forwardReturn3D),
    forwardReturnD5: finite(row.forwardReturn5D),
    forwardReturnD10: null,
    labelD1: finite(row.forwardReturn1D) !== null ? row.status : null,
    labelD3: finite(row.forwardReturn3D) !== null ? row.status : null,
    labelD5: finite(row.forwardReturn5D) !== null ? row.status : null,
    labelD10: null,
    label: row.status,
    evidenceStatus: row.status.startsWith('MATURED') ? 'LABELED' : row.status === 'OBSERVING' ? 'PARTIAL' : 'PENDING',
    lastUpdatedAt: row.status.startsWith('MATURED') ? now.toISOString() : null,
    executionImpact: 'NONE',
    marketSignal: false,
  });
}

function nearMissRow(entry: NearMissOutcomeEntry): UnifiedForwardOutcomeRow {
  const point = (days: 3 | 5 | 10) => entry.horizons.find((item) => item.horizonDays === days);
  const d3 = point(3);
  const d5 = point(5);
  const d10 = point(10);
  const horizonStatusByKey = {
    D1: 'UNSUPPORTED',
    D3: d3 ? horizonStatus(finite(d3.returnPct), true, d3.status === 'PENDING') : 'UNSUPPORTED',
    D5: d5 ? horizonStatus(finite(d5.returnPct), true, d5.status === 'PENDING') : 'UNSUPPORTED',
    D10: d10 ? horizonStatus(finite(d10.returnPct), true, d10.status === 'PENDING') : 'UNSUPPORTED',
  } satisfies Record<UnifiedForwardOutcomeHorizon, UnifiedForwardOutcomeHorizonStatus>;
  return completeRow({
    outcomeId: entry.id,
    sourceType: 'NEAR_MISS_OUTCOME',
    sourceLedgerId: entry.id,
    symbol: entry.stockCode,
    symbolName: entry.stockName,
    decisionType: entry.bucket,
    decisionLabel: entry.diagnosticReason,
    entryReferencePrice: entry.signalPriceKrw,
    entryReferenceTime: entry.createdAt,
    createdAt: entry.createdAt,
    tradeDate: entry.signalDate,
    sourceSnapshotId: entry.signalDate,
    gateScoreInputSnapshotId: null,
    candidateSetId: null,
    marketSession: null,
    engineMode: null,
    regime: null,
    policyView: 'DIAGNOSTIC_ONLY',
    liveExecutionAllowedAtCreation: false,
    shadowAllowedAtCreation: true,
    counterfactualAllowedAtCreation: true,
    horizonStatus: horizonStatusByKey,
    forwardReturnD1: null,
    forwardReturnD3: finite(d3?.returnPct),
    forwardReturnD5: finite(d5?.returnPct),
    forwardReturnD10: finite(d10?.returnPct),
    labelD1: null,
    labelD3: d3?.status === 'OBSERVED' ? 'OBSERVED' : null,
    labelD5: d5?.status === 'OBSERVED' ? 'OBSERVED' : null,
    labelD10: d10?.status === 'OBSERVED' ? 'OBSERVED' : null,
    label: entry.closed ? 'CLOSED' : 'ACTIVE',
    evidenceStatus: entry.closed ? 'LABELED' : entry.horizons.some((item) => item.status === 'OBSERVED') ? 'PARTIAL' : 'PENDING',
    lastUpdatedAt: entry.horizons.map((item) => item.observedAt).filter(Boolean).sort().at(-1) ?? null,
    executionImpact: 'NONE',
    marketSignal: false,
  });
}

function counterfactualRow(entry: CounterfactualShadowLearningLedgerEntry, now: Date): UnifiedForwardOutcomeRow {
  const createdYmd = entry.createdAtKst.slice(0, 10);
  const today = nowKstYmd(now);
  const due = (days: number) => today >= addBusinessDaysFromKstDate(createdYmd, days);
  const horizonStatusByKey = {
    D1: horizonStatus(null, true, due(1)),
    D3: horizonStatus(null, true, due(3)),
    D5: horizonStatus(null, true, due(5)),
    D10: horizonStatus(null, true, due(10)),
  } satisfies Record<UnifiedForwardOutcomeHorizon, UnifiedForwardOutcomeHorizonStatus>;
  return completeRow({
    outcomeId: entry.scanId ? `${entry.scanId}:${entry.symbol}:ADR-0430` : `${entry.createdAtKst}:${entry.symbol}:ADR-0430`,
    sourceType: 'COUNTERFACTUAL_LEDGER',
    sourceLedgerId: entry.scanId ? `${entry.scanId}:${entry.symbol}:ADR-0430` : `${entry.createdAtKst}:${entry.symbol}:ADR-0430`,
    symbol: entry.symbol,
    symbolName: entry.name ?? null,
    decisionType: entry.label,
    decisionLabel: entry.outcomeLabel ?? entry.outcomeStatus ?? entry.entryReason ?? null,
    entryReferencePrice: positiveFinite(entry.entryPriceHint),
    entryReferenceTime: entry.createdAtKst,
    createdAt: entry.createdAtKst,
    tradeDate: createdYmd,
    sourceSnapshotId: entry.scanId ?? null,
    gateScoreInputSnapshotId: null,
    candidateSetId: null,
    marketSession: entry.marketSession ?? null,
    engineMode: entry.engineMode ?? null,
    regime: entry.regime ?? entry.effectiveRegime ?? null,
    policyView: 'COUNTERFACTUAL_ONLY',
    liveExecutionAllowedAtCreation: false,
    shadowAllowedAtCreation: entry.executionShadowAllowed,
    counterfactualAllowedAtCreation: true,
    horizonStatus: horizonStatusByKey,
    forwardReturnD1: null,
    forwardReturnD3: null,
    forwardReturnD5: null,
    forwardReturnD10: null,
    labelD1: null,
    labelD3: null,
    labelD5: null,
    labelD10: null,
    label: entry.outcomeLabel ?? entry.outcomeStatus ?? null,
    evidenceStatus: entry.outcomeLabel ? 'LABELED' : 'PENDING',
    lastUpdatedAt: entry.resolvedAt ?? null,
    executionImpact: 'NONE',
    marketSignal: false,
  });
}

function paperRow(entry: UnifiedPaperObservationalEntry, now: Date): UnifiedForwardOutcomeRow {
  const createdYmd = entry.createdAt.slice(0, 10);
  const today = nowKstYmd(now);
  const due = (days: number) => today >= addBusinessDaysFromKstDate(createdYmd, days);
  const horizonStatusByKey = {
    D1: horizonStatus(null, true, due(1)),
    D3: horizonStatus(null, true, due(3)),
    D5: horizonStatus(null, true, due(5)),
    D10: horizonStatus(null, true, due(10)),
  } satisfies Record<UnifiedForwardOutcomeHorizon, UnifiedForwardOutcomeHorizonStatus>;
  return completeRow({
    outcomeId: entry.outcomeId,
    sourceType: 'PAPER_OBSERVATIONAL_ENTRY',
    sourceLedgerId: entry.outcomeId,
    symbol: entry.symbol,
    symbolName: null,
    decisionType: entry.decisionType,
    decisionLabel: entry.decisionType,
    entryReferencePrice: positiveFinite(entry.entryReferencePrice),
    entryReferenceTime: entry.createdAt,
    createdAt: entry.createdAt,
    tradeDate: createdYmd,
    sourceSnapshotId: entry.sourceSnapshotId ?? null,
    gateScoreInputSnapshotId: entry.gateScoreInputSnapshotId ?? null,
    candidateSetId: null,
    marketSession: null,
    engineMode: 'PAPER_OBSERVATIONAL',
    regime: null,
    policyView: 'OBSERVATIONAL_ONLY',
    liveExecutionAllowedAtCreation: false,
    shadowAllowedAtCreation: true,
    counterfactualAllowedAtCreation: true,
    horizonStatus: horizonStatusByKey,
    forwardReturnD1: null,
    forwardReturnD3: null,
    forwardReturnD5: null,
    forwardReturnD10: null,
    labelD1: null,
    labelD3: null,
    labelD5: null,
    labelD10: null,
    label: null,
    evidenceStatus: 'PENDING',
    lastUpdatedAt: null,
    executionImpact: 'NONE',
    marketSignal: false,
  });
}

export function normalizeUnifiedForwardOutcomeRows(input: {
  now?: Date;
  gate3Seeds?: readonly Gate3OutcomeSeed[];
  gate1Rows?: readonly Gate1DryRunObservationRow[];
  nearMissEntries?: readonly NearMissOutcomeEntry[];
  counterfactualEntries?: readonly CounterfactualShadowLearningLedgerEntry[];
  paperEntries?: readonly UnifiedPaperObservationalEntry[];
}): UnifiedForwardOutcomeRow[] {
  const now = input.now ?? new Date();
  return [
    ...(input.gate3Seeds ?? []).map((seed) => gate3Row(seed, now)),
    ...(input.gate1Rows ?? []).map((row) => gate1Row(row, now)),
    ...(input.nearMissEntries ?? []).map(nearMissRow),
    ...(input.counterfactualEntries ?? []).map((entry) => counterfactualRow(entry, now)),
    ...(input.paperEntries ?? []).map((entry) => paperRow(entry, now)),
  ];
}

function observedGate1Rows(rows: readonly Gate1DryRunObservationRow[]): number {
  return rows.filter((row) =>
    finite(row.forwardReturn1D) !== null ||
    finite(row.forwardReturn3D) !== null ||
    finite(row.forwardReturn5D) !== null,
  ).length;
}

function observedNearMissRows(entries: readonly NearMissOutcomeEntry[]): number {
  return entries.filter((entry) => entry.horizons.some((point) => point.status === 'OBSERVED' && finite(point.returnPct) !== null)).length;
}

function counterfactualEvidenceRows(entries: readonly CounterfactualShadowLearningLedgerEntry[]): number {
  return entries.filter((entry) => entry.outcomeLabel || entry.outcomeStatus || entry.resolvedAt).length || entries.length;
}

function stalePendingRows(rows: readonly UnifiedForwardOutcomeRow[], now: Date): number {
  return rows.filter((row) => {
    if (row.evidenceStatus === 'LABELED') return false;
    const createdYmd = row.createdAt.slice(0, 10);
    return tradingDaysBetween(createdYmd, now) >= 10;
  }).length;
}

function dataUnavailableHorizons(rows: readonly UnifiedForwardOutcomeRow[]): number {
  return rows.reduce((total, row) =>
    total + (['D1', 'D3', 'D5', 'D10'] as const).filter((horizon) => row.horizonStatus[horizon] === 'PENDING').length,
  0);
}

function sourceRowsByType(input: {
  gate3Seeds: readonly Gate3OutcomeSeed[];
  gate3EvidenceSampleSize: number;
  gate1Rows: readonly Gate1DryRunObservationRow[];
  nearMissEntries: readonly NearMissOutcomeEntry[];
  counterfactualEntries: readonly CounterfactualShadowLearningLedgerEntry[];
  paperEntries: readonly UnifiedPaperObservationalEntry[];
}): Partial<Record<UnifiedForwardOutcomeSourceType, number>> {
  return {
    GATE3_OUTCOME_SEED: input.gate3Seeds.length,
    GATE3_THRESHOLD_EVIDENCE: input.gate3EvidenceSampleSize,
    GATE1_DRY_RUN_OBSERVATION: input.gate1Rows.length,
    NEAR_MISS_OUTCOME: input.nearMissEntries.length,
    COUNTERFACTUAL_LEDGER: input.counterfactualEntries.length,
    PAPER_OBSERVATIONAL_ENTRY: input.paperEntries.length,
    SHADOW_PROMOTION_AUDIT: 0,
    PRE_BREAKOUT_OBSERVATION: 0,
  };
}

async function updateGate3Seeds(input: {
  seeds: readonly Gate3OutcomeSeed[];
  now: Date;
  priceFetcher: UnifiedForwardOutcomePriceFetcher;
  persist: boolean;
}): Promise<{ seeds: Gate3OutcomeSeed[]; updatedD1: number; updatedD3: number; updatedD5: number; updatedD10: number; duplicateSuppressed: number }> {
  const today = nowKstYmd(input.now);
  const next: Gate3OutcomeSeed[] = [];
  let updatedD1 = 0;
  let updatedD3 = 0;
  let updatedD5 = 0;
  let updatedD10 = 0;
  let duplicateSuppressed = 0;

  for (const seed of input.seeds) {
    if (seed.outcomeStatus === 'LABELED' || seed.outcomeStatus === 'EXPIRED' || seed.outcomeStatus === 'DATA_INSUFFICIENT') {
      next.push(seed);
      continue;
    }
    const row = gate3Row(seed, input.now);
    const snapshots: Gate3ForwardPriceSnapshot[] = [];
    for (const horizon of GATE3_HORIZONS) {
      const target = addBusinessDaysFromKstDate(seed.tradeDate, horizon.days);
      if (today < target) continue;
      if (finite(seed.forwardReturns[horizon.key]) !== null) {
        duplicateSuppressed += 1;
        continue;
      }
      const price = await input.priceFetcher(seed.symbol, toUtcDate(target), row);
      if (positiveFinite(price) === null) continue;
      snapshots.push({ symbol: seed.symbol, horizon: horizon.key, price: price ?? null });
      if (horizon.label === 'D1') updatedD1 += 1;
      else if (horizon.label === 'D3') updatedD3 += 1;
      else if (horizon.label === 'D5') updatedD5 += 1;
      else updatedD10 += 1;
    }
    if (snapshots.length === 0) {
      next.push(seed);
      continue;
    }
    const [updated] = updatePendingGate3Outcomes([seed], snapshots, {
      elapsedTradingDays: tradingDaysBetween(seed.tradeDate, input.now),
    });
    next.push(updated ?? seed);
    if (input.persist && updated && updated !== seed) persistGate3OutcomeSeed(updated);
  }

  return { seeds: next, updatedD1, updatedD3, updatedD5, updatedD10, duplicateSuppressed };
}

async function defaultPriceFetcher(symbol: string, asOf: Date): Promise<number | null> {
  return fetchHistoricalClosePrice(symbol, asOf);
}

export async function runUnifiedForwardOutcomeLabeler(
  options: UnifiedForwardOutcomeLabelerOptions = {},
): Promise<UnifiedForwardOutcomeLabelerSummary> {
  const now = options.now ?? new Date();
  const runAt = now.toISOString();
  const persist = options.persist ?? (
    options.gate3Seeds === undefined &&
    options.gate1Rows === undefined &&
    options.nearMissEntries === undefined &&
    options.counterfactualEntries === undefined &&
    options.paperEntries === undefined
  );

  if (!isUnifiedForwardOutcomeLabelerEnabled()) {
    const disabled = { ...defaultSummary('UNIFIED_FORWARD_OUTCOME_LABELER_DISABLED'), lastLabelingRunAt: runAt };
    if (persist) writeStatus(disabled);
    return disabled;
  }

  try {
    const priceFetcher = options.priceFetcher ?? defaultPriceFetcher;
    const gate3Seeds = [...(options.gate3Seeds ?? loadGate3OutcomeSeeds())];
    const gate1Rows = [...(options.gate1Rows ?? await listGate1DryRunObservationRows())];
    const nearMissEntriesBefore = [...(options.nearMissEntries ?? getAllNearMissOutcomes())];
    const counterfactualEntries = [...(options.counterfactualEntries ?? loadCounterfactualShadowLearningLedger())];
    const paperEntries = [...(options.paperEntries ?? [])];

    const gate3Update = await updateGate3Seeds({ seeds: gate3Seeds, now, priceFetcher, persist });
    const gate1Update = await updateGate1DryRunObservationOutcomes({
      now,
      rows: options.gate1Rows ? gate1Rows : undefined,
      priceFetcher: (symbol, asOf, row) => priceFetcher(symbol, asOf, gate1Row(row, now)),
    });
    const gate1RowsAfter = options.gate1Rows ? gate1Rows : await listGate1DryRunObservationRows();

    const nearMissUpdate = options.nearMissEntries
      ? { updated: 0, updated3d: 0, updated5d: 0, updated10d: 0, skipped: 0, closed: 0 }
      : await refreshNearMissOutcomeLedger({
          now,
          priceFetcher: async (symbol, asOf) => (await priceFetcher(symbol, asOf ?? now, {
            outcomeId: `near-miss:${symbol}:${asOf?.toISOString().slice(0, 10) ?? runAt}`,
            sourceType: 'NEAR_MISS_OUTCOME',
            sourceLedgerId: `near-miss:${symbol}:${asOf?.toISOString().slice(0, 10) ?? runAt}`,
            symbol,
            symbolName: null,
            decisionType: 'NEAR_MISS',
            decisionLabel: null,
            entryReferencePrice: null,
            entryReferenceTime: null,
            createdAt: runAt,
            tradeDate: asOf?.toISOString().slice(0, 10) ?? null,
            sourceSnapshotId: null,
            gateScoreInputSnapshotId: null,
            candidateSetId: null,
            marketSession: null,
            engineMode: null,
            regime: null,
            policyView: 'DIAGNOSTIC_ONLY',
            liveExecutionAllowedAtCreation: false,
            shadowAllowedAtCreation: true,
            counterfactualAllowedAtCreation: true,
            horizonStatus: { D1: 'UNSUPPORTED', D3: 'PENDING', D5: 'PENDING', D10: 'PENDING' },
            horizonStatusD1: 'UNSUPPORTED',
            horizonStatusD3: 'PENDING',
            horizonStatusD5: 'PENDING',
            horizonStatusD10: 'PENDING',
            forwardReturnD1: null,
            forwardReturnD3: null,
            forwardReturnD5: null,
            forwardReturnD10: null,
            priceAtD1: null,
            priceAtD3: null,
            priceAtD5: null,
            priceAtD10: null,
            labelD1: null,
            labelD3: null,
            labelD5: null,
            labelD10: null,
            label: null,
            evidenceStatus: 'PENDING',
            dataUnavailableReason: null,
            duplicateKey: `NEAR_MISS_OUTCOME:near-miss:${symbol}:${asOf?.toISOString().slice(0, 10) ?? runAt}:${symbol}`,
            lastUpdatedAt: null,
            executionImpact: 'NONE',
            marketSignal: false,
          })) ?? null,
        });
    const nearMissEntriesAfter = options.nearMissEntries ? nearMissEntriesBefore : getAllNearMissOutcomes();

    const rows = normalizeUnifiedForwardOutcomeRows({
      now,
      gate3Seeds: gate3Update.seeds,
      gate1Rows: gate1RowsAfter,
      nearMissEntries: nearMissEntriesAfter,
      counterfactualEntries,
      paperEntries,
    });
    const idempotencyKeys = new Set<string>();
    let duplicateSuppressed = gate3Update.duplicateSuppressed + gate1Update.duplicateSuppressed;
    for (const row of rows) {
      for (const horizon of ['D1', 'D3', 'D5', 'D10'] as const) {
        if (row.horizonStatus[horizon] === 'UNSUPPORTED') continue;
        const key = horizonIdempotencyKey(row, horizon);
        if (idempotencyKeys.has(key)) duplicateSuppressed += 1;
        idempotencyKeys.add(key);
      }
    }

    const gate3EvidenceSampleSize = buildGate3EvidenceScore(gate3Update.seeds).sampleSize;
    const summary: UnifiedForwardOutcomeLabelerSummary = {
      unifiedOutcomeLabelerHealthy: true,
      sourceRowsScanned: rows.length,
      rowsUpdatedD1: gate3Update.updatedD1 + gate1Update.updatedD1,
      rowsUpdatedD3: gate3Update.updatedD3 + gate1Update.updatedD3 + nearMissUpdate.updated3d,
      rowsUpdatedD5: gate3Update.updatedD5 + gate1Update.updatedD5 + nearMissUpdate.updated5d,
      rowsUpdatedD10: gate3Update.updatedD10 + nearMissUpdate.updated10d,
      dataUnavailable: dataUnavailableHorizons(rows),
      duplicateSuppressed,
      stalePending: stalePendingRows(rows, now),
      sourceRowsByType: sourceRowsByType({
        gate3Seeds: gate3Update.seeds,
        gate3EvidenceSampleSize,
        gate1Rows: gate1RowsAfter,
        nearMissEntries: nearMissEntriesAfter,
        counterfactualEntries,
        paperEntries,
      }),
      gate3EvidenceSampleSize,
      gate1CalibrationSampleSize: gate1RowsAfter.length,
      nearMissEvidenceSampleSize: observedNearMissRows(nearMissEntriesAfter),
      counterfactualEvidenceSampleSize: counterfactualEvidenceRows(counterfactualEntries),
      paperObservationalEvidenceSampleSize: paperEntries.length,
      lastLabelingRunAt: runAt,
      lastLabelingErrorSanitized: 'NONE',
      liveExecutionAllowed: false,
      executionImpact: 'NONE',
      shadowLearning: true,
      counterfactualAllowed: true,
      thresholdAutoChanged: false,
    };
    if (persist) writeStatus(summary);
    return summary;
  } catch (error) {
    const summary = { ...defaultSummary(sanitizeError(error)), lastLabelingRunAt: runAt };
    if (persist) writeStatus(summary);
    return summary;
  }
}

export function buildUnifiedForwardOutcomeLabelerStatusForScan(): UnifiedForwardOutcomeLabelerSummary {
  return getLastUnifiedForwardOutcomeLabelerSummary() ?? defaultSummary('NO_LABELING_RUN_RECORDED');
}

function formatSourceRowsByType(sourceRowsByType: Partial<Record<UnifiedForwardOutcomeSourceType, number>> | undefined): string {
  const source = sourceRowsByType ?? {};
  const gate3 = Math.max(source.GATE3_OUTCOME_SEED ?? 0, source.GATE3_THRESHOLD_EVIDENCE ?? 0);
  return [
    `GATE3=${gate3}`,
    `GATE1_DRY_RUN=${source.GATE1_DRY_RUN_OBSERVATION ?? 0}`,
    `NEAR_MISS=${source.NEAR_MISS_OUTCOME ?? 0}`,
    `COUNTERFACTUAL=${source.COUNTERFACTUAL_LEDGER ?? 0}`,
    `PAPER_OBSERVATIONAL=${source.PAPER_OBSERVATIONAL_ENTRY ?? 0}`,
  ].join(', ');
}

export function formatUnifiedForwardOutcomeLabelerSection(
  summary: UnifiedForwardOutcomeLabelerSummary | null | undefined,
): string | null {
  if (!summary) return null;
  return [
    'Unified Forward Outcome Labeler',
    '-------------------------------',
    `unifiedOutcomeLabelerHealthy: ${summary.unifiedOutcomeLabelerHealthy}`,
    `sourceRowsScanned: ${summary.sourceRowsScanned}`,
    `sourceRowsByType: ${formatSourceRowsByType(summary.sourceRowsByType)}`,
    `rowsUpdatedD1: ${summary.rowsUpdatedD1}`,
    `rowsUpdatedD3: ${summary.rowsUpdatedD3}`,
    `rowsUpdatedD5: ${summary.rowsUpdatedD5}`,
    `rowsUpdatedD10: ${summary.rowsUpdatedD10}`,
    `dataUnavailable: ${summary.dataUnavailable ?? 0}`,
    `duplicateSuppressed: ${summary.duplicateSuppressed}`,
    `stalePending: ${summary.stalePending}`,
    `gate3EvidenceSampleSize: ${summary.gate3EvidenceSampleSize}`,
    `gate1CalibrationSampleSize: ${summary.gate1CalibrationSampleSize}`,
    `nearMissEvidenceSampleSize: ${summary.nearMissEvidenceSampleSize}`,
    `counterfactualEvidenceSampleSize: ${summary.counterfactualEvidenceSampleSize ?? 0}`,
    `paperObservationalEvidenceSampleSize: ${summary.paperObservationalEvidenceSampleSize ?? 0}`,
    `lastLabelingRunAt: ${summary.lastLabelingRunAt ?? 'N/A'}`,
    `lastLabelingErrorSanitized: ${summary.lastLabelingErrorSanitized ?? 'NONE'}`,
    `liveExecutionAllowed=${summary.liveExecutionAllowed} executionImpact=${summary.executionImpact} shadowLearning=${summary.shadowLearning} counterfactualAllowed=${summary.counterfactualAllowed ?? true} thresholdAutoChanged=${summary.thresholdAutoChanged}`,
  ].join('\n');
}
