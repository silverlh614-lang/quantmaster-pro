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
  | 'GATE1_DRY_RUN_OBSERVATION'
  | 'NEAR_MISS_OUTCOME'
  | 'COUNTERFACTUAL_LEDGER'
  | 'PAPER_OBSERVATIONAL_ENTRY';

export type UnifiedForwardOutcomeHorizon = 'D1' | 'D3' | 'D5' | 'D10';
export type UnifiedForwardOutcomeEvidenceStatus = 'PENDING' | 'PARTIAL' | 'LABELED' | 'DATA_INSUFFICIENT';

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
  symbol: string;
  decisionType: string;
  entryReferencePrice: number | null;
  createdAt: string;
  sourceSnapshotId: string | null;
  gateScoreInputSnapshotId: string | null;
  horizonStatus: Record<UnifiedForwardOutcomeHorizon, 'PENDING' | 'UPDATED' | 'NOT_DUE' | 'UNSUPPORTED'>;
  forwardReturnD1: number | null;
  forwardReturnD3: number | null;
  forwardReturnD5: number | null;
  forwardReturnD10: number | null;
  label: string | null;
  evidenceStatus: UnifiedForwardOutcomeEvidenceStatus;
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
  duplicateSuppressed: number;
  stalePending: number;
  gate3EvidenceSampleSize: number;
  gate1CalibrationSampleSize: number;
  nearMissEvidenceSampleSize: number;
  lastLabelingRunAt: string | null;
  lastLabelingErrorSanitized: string | null;
  liveExecutionAllowed: false;
  executionImpact: 'NONE';
  shadowLearning: true;
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
    duplicateSuppressed: 0,
    stalePending: 0,
    gate3EvidenceSampleSize: 0,
    gate1CalibrationSampleSize: 0,
    nearMissEvidenceSampleSize: 0,
    lastLabelingRunAt: null,
    lastLabelingErrorSanitized: error,
    liveExecutionAllowed: false,
    executionImpact: 'NONE',
    shadowLearning: true,
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

export function horizonIdempotencyKey(row: Pick<UnifiedForwardOutcomeRow, 'sourceType' | 'outcomeId' | 'symbol'>, horizon: UnifiedForwardOutcomeHorizon): string {
  return `${row.sourceType}:${row.outcomeId}:${row.symbol}:${horizon}`;
}

function horizonStatus(returnValue: number | null, supported: boolean, due: boolean): 'PENDING' | 'UPDATED' | 'NOT_DUE' | 'UNSUPPORTED' {
  if (!supported) return 'UNSUPPORTED';
  if (returnValue !== null) return 'UPDATED';
  return due ? 'PENDING' : 'NOT_DUE';
}

function gate3Row(seed: Gate3OutcomeSeed, now: Date): UnifiedForwardOutcomeRow {
  const today = nowKstYmd(now);
  const isDue = (days: number) => today >= addBusinessDaysFromKstDate(seed.tradeDate, days);
  return {
    outcomeId: seed.id,
    sourceType: 'GATE3_OUTCOME_SEED',
    symbol: seed.symbol,
    decisionType: seed.readiness,
    entryReferencePrice: seed.entryReferencePrice,
    createdAt: seed.asOf,
    sourceSnapshotId: seed.sourceSnapshotId,
    gateScoreInputSnapshotId: seed.gate3SnapshotId,
    horizonStatus: {
      D1: horizonStatus(finite(seed.forwardReturns.d1), true, isDue(1)),
      D3: horizonStatus(finite(seed.forwardReturns.d3), true, isDue(3)),
      D5: horizonStatus(finite(seed.forwardReturns.d5), true, isDue(5)),
      D10: horizonStatus(finite(seed.forwardReturns.d10), true, isDue(10)),
    },
    forwardReturnD1: finite(seed.forwardReturns.d1),
    forwardReturnD3: finite(seed.forwardReturns.d3),
    forwardReturnD5: finite(seed.forwardReturns.d5),
    forwardReturnD10: finite(seed.forwardReturns.d10),
    label: seed.outcomeLabel,
    evidenceStatus: seed.outcomeStatus === 'LABELED' ? 'LABELED' : seed.outcomeStatus === 'DATA_INSUFFICIENT' ? 'DATA_INSUFFICIENT' : seed.outcomeStatus === 'PARTIAL' ? 'PARTIAL' : 'PENDING',
    executionImpact: 'NONE',
    marketSignal: false,
  };
}

function gate1Row(row: Gate1DryRunObservationRow, now: Date): UnifiedForwardOutcomeRow {
  const today = nowKstYmd(now);
  const due = (days: number) => today >= addBusinessDaysFromKstDate(row.forDate, days);
  return {
    outcomeId: row.id,
    sourceType: 'GATE1_DRY_RUN_OBSERVATION',
    symbol: row.symbol,
    decisionType: row.dryRunDecision,
    entryReferencePrice: positiveFinite(row.entryReferencePrice),
    createdAt: row.createdAt,
    sourceSnapshotId: row.forDate,
    gateScoreInputSnapshotId: null,
    horizonStatus: {
      D1: horizonStatus(finite(row.forwardReturn1D), true, due(1)),
      D3: horizonStatus(finite(row.forwardReturn3D), true, due(3)),
      D5: horizonStatus(finite(row.forwardReturn5D), true, due(5)),
      D10: 'UNSUPPORTED',
    },
    forwardReturnD1: finite(row.forwardReturn1D),
    forwardReturnD3: finite(row.forwardReturn3D),
    forwardReturnD5: finite(row.forwardReturn5D),
    forwardReturnD10: null,
    label: row.status,
    evidenceStatus: row.status.startsWith('MATURED') ? 'LABELED' : row.status === 'OBSERVING' ? 'PARTIAL' : 'PENDING',
    executionImpact: 'NONE',
    marketSignal: false,
  };
}

function nearMissRow(entry: NearMissOutcomeEntry): UnifiedForwardOutcomeRow {
  const point = (days: 3 | 5 | 10) => entry.horizons.find((item) => item.horizonDays === days);
  const d3 = point(3);
  const d5 = point(5);
  const d10 = point(10);
  return {
    outcomeId: entry.id,
    sourceType: 'NEAR_MISS_OUTCOME',
    symbol: entry.stockCode,
    decisionType: entry.bucket,
    entryReferencePrice: entry.signalPriceKrw,
    createdAt: entry.createdAt,
    sourceSnapshotId: entry.signalDate,
    gateScoreInputSnapshotId: null,
    horizonStatus: {
      D1: 'UNSUPPORTED',
      D3: d3 ? horizonStatus(finite(d3.returnPct), true, d3.status === 'PENDING') : 'UNSUPPORTED',
      D5: d5 ? horizonStatus(finite(d5.returnPct), true, d5.status === 'PENDING') : 'UNSUPPORTED',
      D10: d10 ? horizonStatus(finite(d10.returnPct), true, d10.status === 'PENDING') : 'UNSUPPORTED',
    },
    forwardReturnD1: null,
    forwardReturnD3: finite(d3?.returnPct),
    forwardReturnD5: finite(d5?.returnPct),
    forwardReturnD10: finite(d10?.returnPct),
    label: entry.closed ? 'CLOSED' : 'ACTIVE',
    evidenceStatus: entry.closed ? 'LABELED' : entry.horizons.some((item) => item.status === 'OBSERVED') ? 'PARTIAL' : 'PENDING',
    executionImpact: 'NONE',
    marketSignal: false,
  };
}

function counterfactualRow(entry: CounterfactualShadowLearningLedgerEntry): UnifiedForwardOutcomeRow {
  return {
    outcomeId: entry.scanId ? `${entry.scanId}:${entry.symbol}:ADR-0430` : `${entry.createdAtKst}:${entry.symbol}:ADR-0430`,
    sourceType: 'COUNTERFACTUAL_LEDGER',
    symbol: entry.symbol,
    decisionType: entry.label,
    entryReferencePrice: positiveFinite(entry.entryPriceHint),
    createdAt: entry.createdAtKst,
    sourceSnapshotId: entry.scanId ?? null,
    gateScoreInputSnapshotId: null,
    horizonStatus: { D1: 'PENDING', D3: 'PENDING', D5: 'PENDING', D10: 'PENDING' },
    forwardReturnD1: null,
    forwardReturnD3: null,
    forwardReturnD5: null,
    forwardReturnD10: null,
    label: entry.outcomeLabel ?? entry.outcomeStatus ?? null,
    evidenceStatus: entry.outcomeLabel ? 'LABELED' : 'PENDING',
    executionImpact: 'NONE',
    marketSignal: false,
  };
}

function paperRow(entry: UnifiedPaperObservationalEntry): UnifiedForwardOutcomeRow {
  return {
    outcomeId: entry.outcomeId,
    sourceType: 'PAPER_OBSERVATIONAL_ENTRY',
    symbol: entry.symbol,
    decisionType: entry.decisionType,
    entryReferencePrice: positiveFinite(entry.entryReferencePrice),
    createdAt: entry.createdAt,
    sourceSnapshotId: entry.sourceSnapshotId ?? null,
    gateScoreInputSnapshotId: entry.gateScoreInputSnapshotId ?? null,
    horizonStatus: { D1: 'PENDING', D3: 'PENDING', D5: 'PENDING', D10: 'PENDING' },
    forwardReturnD1: null,
    forwardReturnD3: null,
    forwardReturnD5: null,
    forwardReturnD10: null,
    label: null,
    evidenceStatus: 'PENDING',
    executionImpact: 'NONE',
    marketSignal: false,
  };
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
    ...(input.counterfactualEntries ?? []).map(counterfactualRow),
    ...(input.paperEntries ?? []).map(paperRow),
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

function stalePendingRows(rows: readonly UnifiedForwardOutcomeRow[], now: Date): number {
  return rows.filter((row) => {
    if (row.evidenceStatus === 'LABELED') return false;
    const createdYmd = row.createdAt.slice(0, 10);
    return tradingDaysBetween(createdYmd, now) >= 10;
  }).length;
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
            symbol,
            decisionType: 'NEAR_MISS',
            entryReferencePrice: null,
            createdAt: runAt,
            sourceSnapshotId: null,
            gateScoreInputSnapshotId: null,
            horizonStatus: { D1: 'UNSUPPORTED', D3: 'PENDING', D5: 'PENDING', D10: 'PENDING' },
            forwardReturnD1: null,
            forwardReturnD3: null,
            forwardReturnD5: null,
            forwardReturnD10: null,
            label: null,
            evidenceStatus: 'PENDING',
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

    const summary: UnifiedForwardOutcomeLabelerSummary = {
      unifiedOutcomeLabelerHealthy: true,
      sourceRowsScanned: rows.length,
      rowsUpdatedD1: gate3Update.updatedD1 + gate1Update.updatedD1,
      rowsUpdatedD3: gate3Update.updatedD3 + gate1Update.updatedD3 + nearMissUpdate.updated3d,
      rowsUpdatedD5: gate3Update.updatedD5 + gate1Update.updatedD5 + nearMissUpdate.updated5d,
      rowsUpdatedD10: gate3Update.updatedD10 + nearMissUpdate.updated10d,
      duplicateSuppressed,
      stalePending: stalePendingRows(rows, now),
      gate3EvidenceSampleSize: buildGate3EvidenceScore(gate3Update.seeds).sampleSize,
      gate1CalibrationSampleSize: observedGate1Rows(gate1RowsAfter),
      nearMissEvidenceSampleSize: observedNearMissRows(nearMissEntriesAfter),
      lastLabelingRunAt: runAt,
      lastLabelingErrorSanitized: null,
      liveExecutionAllowed: false,
      executionImpact: 'NONE',
      shadowLearning: true,
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

export function formatUnifiedForwardOutcomeLabelerSection(
  summary: UnifiedForwardOutcomeLabelerSummary | null | undefined,
): string | null {
  if (!summary) return null;
  return [
    'Unified Forward Outcome Labeler',
    '-------------------------------',
    `unifiedOutcomeLabelerHealthy: ${summary.unifiedOutcomeLabelerHealthy}`,
    `sourceRowsScanned: ${summary.sourceRowsScanned}`,
    `rowsUpdatedD1: ${summary.rowsUpdatedD1}`,
    `rowsUpdatedD3: ${summary.rowsUpdatedD3}`,
    `rowsUpdatedD5: ${summary.rowsUpdatedD5}`,
    `rowsUpdatedD10: ${summary.rowsUpdatedD10}`,
    `duplicateSuppressed: ${summary.duplicateSuppressed}`,
    `stalePending: ${summary.stalePending}`,
    `gate3EvidenceSampleSize: ${summary.gate3EvidenceSampleSize}`,
    `gate1CalibrationSampleSize: ${summary.gate1CalibrationSampleSize}`,
    `nearMissEvidenceSampleSize: ${summary.nearMissEvidenceSampleSize}`,
    `lastLabelingRunAt: ${summary.lastLabelingRunAt ?? 'N/A'}`,
    `lastLabelingErrorSanitized: ${summary.lastLabelingErrorSanitized ?? 'none'}`,
    `liveExecutionAllowed=${summary.liveExecutionAllowed} executionImpact=${summary.executionImpact} shadowLearning=${summary.shadowLearning} thresholdAutoChanged=${summary.thresholdAutoChanged}`,
  ].join('\n');
}
