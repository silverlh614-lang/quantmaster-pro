/**
 * @responsibility ADR-454 Near-Miss Outcome Ledger — diagnostic-only gate near-miss 사후 성과 추적
 *
 * DATA_BLOCKED_NEAR_MISS / PROBING / SHADOW_ONLY 후보를 실매수로 승격하지 않고
 * 3/5/10영업일 뒤 수익률만 관측한다. Kelly, Gate threshold, KIS 주문, entryEngine 과
 * 완전 분리된 학습/진단 전용 원장이다.
 */
import fs from 'fs';
import { fetchCurrentPrice } from '../clients/kisClient.js';
import { ensureDataDir, NEAR_MISS_OUTCOME_LEDGER_FILE } from './paths.js';
import { addWeekdaysApprox } from './businessDayApprox.js';
import type { GateScoreCandidateBucket } from '../trading/signalScanner/gateScoreCandidateBucket.js';

export const NEAR_MISS_OUTCOME_HORIZONS = [3, 5, 10] as const;
export type NearMissOutcomeHorizon = typeof NEAR_MISS_OUTCOME_HORIZONS[number];
export type NearMissOutcomeTrackedBucket = Extract<
  GateScoreCandidateBucket,
  'DATA_BLOCKED_NEAR_MISS' | 'PROBING' | 'SHADOW_ONLY'
>;

export const NEAR_MISS_OUTCOME_LEDGER_MAX = 2_000;

export interface NearMissOutcomePoint {
  horizonDays: NearMissOutcomeHorizon;
  targetDate: string;
  status: 'PENDING' | 'OBSERVED' | 'SKIPPED';
  priceKrw?: number;
  returnPct?: number;
  observedAt?: string;
  skipReason?: string;
}

export interface NearMissOutcomeEntry {
  id: string;
  stockCode: string;
  stockName: string;
  signalDate: string;
  signalPriceKrw: number;
  bucket: NearMissOutcomeTrackedBucket;
  diagnosticReason: string;
  gateScore: number;
  rawScore?: number;
  availableMaxScore?: number;
  normalizedGateScore?: number;
  normalThreshold: number;
  unavailableConditions?: string[];
  thresholdNotMetConditions?: string[];
  providerDegradedConditions?: string[];
  horizons: NearMissOutcomePoint[];
  createdAt: string;
  closed?: boolean;
  /** Safety marker: this ledger is never an order/position promotion lane. */
  executionImpact: 'NONE';
}

export interface NearMissOutcomeRecordInput {
  stockCode: string;
  stockName: string;
  signalDate: string;
  signalPriceKrw: number;
  bucket: GateScoreCandidateBucket;
  diagnosticReason: string;
  gateScore: number;
  rawScore?: number;
  availableMaxScore?: number;
  normalizedGateScore?: number;
  normalThreshold: number;
  unavailableConditions?: readonly string[];
  thresholdNotMetConditions?: readonly string[];
  providerDegradedConditions?: readonly string[];
  now?: Date;
}

export interface NearMissOutcomeSummary {
  totalCount: number;
  activeCount: number;
  closedCount: number;
  observedCountByHorizon: Record<NearMissOutcomeHorizon, number>;
  avgReturnPctByHorizon: Record<NearMissOutcomeHorizon, number>;
}

function isTrackedBucket(bucket: GateScoreCandidateBucket): bucket is NearMissOutcomeTrackedBucket {
  return bucket === 'DATA_BLOCKED_NEAR_MISS' || bucket === 'PROBING' || bucket === 'SHADOW_ONLY';
}

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * 주말만 건너뛰는 영업일 근사 가산(공휴일 미반영 — 휴일-인식은 별도 마이그레이션 #2-B).
 * 공유 helper(addWeekdaysApprox)로 위임. 기존 인라인과 byte-equivalent(주말만 스킵).
 * krxHolidays.addBusinessDaysFromKstDate(휴일+주말 SSOT)와 혼동 금지.
 */
export function addBusinessDays(yyyymmdd: string, businessDays: number): string {
  return addWeekdaysApprox(yyyymmdd, businessDays);
}

function loadEntries(): NearMissOutcomeEntry[] {
  ensureDataDir();
  if (!fs.existsSync(NEAR_MISS_OUTCOME_LEDGER_FILE)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(NEAR_MISS_OUTCOME_LEDGER_FILE, 'utf-8'));
    return Array.isArray(parsed) ? (parsed as NearMissOutcomeEntry[]) : [];
  } catch {
    return [];
  }
}

function saveEntries(entries: NearMissOutcomeEntry[]): void {
  ensureDataDir();
  fs.writeFileSync(
    NEAR_MISS_OUTCOME_LEDGER_FILE,
    JSON.stringify(entries.slice(-NEAR_MISS_OUTCOME_LEDGER_MAX), null, 2),
  );
}

export function recordNearMissOutcome(input: NearMissOutcomeRecordInput): { recorded: boolean; reason: string } {
  if (!isTrackedBucket(input.bucket)) {
    return { recorded: false, reason: 'bucket_not_tracked' };
  }
  if (!isFinitePositive(input.signalPriceKrw)) {
    return { recorded: false, reason: 'invalid_signal_price' };
  }
  if (!Number.isFinite(input.gateScore) || !Number.isFinite(input.normalThreshold)) {
    return { recorded: false, reason: 'invalid_gate_score' };
  }

  const entries = loadEntries();
  const dedupeKey = `${input.stockCode}|${input.signalDate}|${input.bucket}`;
  if (entries.some((e) => `${e.stockCode}|${e.signalDate}|${e.bucket}` === dedupeKey)) {
    return { recorded: false, reason: 'duplicate' };
  }

  const now = input.now ?? new Date();
  const horizons = NEAR_MISS_OUTCOME_HORIZONS.map((horizonDays) => ({
    horizonDays,
    targetDate: addBusinessDays(input.signalDate, horizonDays),
    status: 'PENDING' as const,
  }));

  entries.push({
    id: `near-miss-${input.signalDate}-${input.stockCode}-${input.bucket}`,
    stockCode: input.stockCode,
    stockName: input.stockName,
    signalDate: input.signalDate,
    signalPriceKrw: input.signalPriceKrw,
    bucket: input.bucket,
    diagnosticReason: input.diagnosticReason,
    gateScore: input.gateScore,
    ...(Number.isFinite(input.rawScore) ? { rawScore: input.rawScore } : {}),
    ...(Number.isFinite(input.availableMaxScore) ? { availableMaxScore: input.availableMaxScore } : {}),
    ...(Number.isFinite(input.normalizedGateScore) ? { normalizedGateScore: input.normalizedGateScore } : {}),
    normalThreshold: input.normalThreshold,
    ...(input.unavailableConditions ? { unavailableConditions: [...input.unavailableConditions] } : {}),
    ...(input.thresholdNotMetConditions ? { thresholdNotMetConditions: [...input.thresholdNotMetConditions] } : {}),
    ...(input.providerDegradedConditions ? { providerDegradedConditions: [...input.providerDegradedConditions] } : {}),
    horizons,
    createdAt: now.toISOString(),
    closed: false,
    executionImpact: 'NONE',
  });

  saveEntries(entries);
  return { recorded: true, reason: 'recorded' };
}

export async function refreshNearMissOutcomeLedger(opts: {
  now?: Date;
  priceFetcher?: (code: string, asOf?: Date) => Promise<number | null>;
} = {}): Promise<{ updated: number; updated3d: number; updated5d: number; updated10d: number; skipped: number; closed: number }> {
  const now = opts.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const fetcher: (code: string, asOf?: Date) => Promise<number | null> =
    opts.priceFetcher ?? ((code: string) => fetchCurrentPrice(code));
  const entries = loadEntries();
  let updated = 0;
  let updated3d = 0;
  let updated5d = 0;
  let updated10d = 0;
  let skipped = 0;
  let closed = 0;

  for (const entry of entries) {
    if (entry.closed) continue;
    const due = entry.horizons.filter((point) => point.status === 'PENDING' && today >= point.targetDate);
    if (due.length === 0) continue;

    for (const point of due) {
      let price: number | null = null;
      try {
        price = await fetcher(entry.stockCode, new Date(`${point.targetDate}T00:00:00.000Z`));
      } catch {
        price = null;
      }

      if (!isFinitePositive(price ?? NaN)) {
        point.status = 'SKIPPED';
        point.skipReason = 'price_unavailable';
        point.observedAt = now.toISOString();
        skipped += 1;
        continue;
      }

      point.status = 'OBSERVED';
      point.priceKrw = price ?? undefined;
      point.returnPct = Number(((((price ?? 0) - entry.signalPriceKrw) / entry.signalPriceKrw) * 100).toFixed(2));
      point.observedAt = now.toISOString();
      updated += 1;
      if (point.horizonDays === 3) updated3d += 1;
      else if (point.horizonDays === 5) updated5d += 1;
      else updated10d += 1;
    }

    if (entry.horizons.every((point) => point.status !== 'PENDING')) {
      entry.closed = true;
      closed += 1;
    }
  }

  saveEntries(entries);
  return { updated, updated3d, updated5d, updated10d, skipped, closed };
}

export function summarizeNearMissOutcomeLedger(): NearMissOutcomeSummary {
  const entries = loadEntries();
  const observedCountByHorizon = Object.fromEntries(
    NEAR_MISS_OUTCOME_HORIZONS.map((horizon) => [horizon, 0]),
  ) as Record<NearMissOutcomeHorizon, number>;
  const sumByHorizon = Object.fromEntries(
    NEAR_MISS_OUTCOME_HORIZONS.map((horizon) => [horizon, 0]),
  ) as Record<NearMissOutcomeHorizon, number>;

  for (const entry of entries) {
    for (const point of entry.horizons) {
      if (point.status !== 'OBSERVED' || point.returnPct === undefined) continue;
      observedCountByHorizon[point.horizonDays] += 1;
      sumByHorizon[point.horizonDays] += point.returnPct;
    }
  }

  const avgReturnPctByHorizon = Object.fromEntries(
    NEAR_MISS_OUTCOME_HORIZONS.map((horizon) => {
      const count = observedCountByHorizon[horizon];
      return [horizon, count > 0 ? Number((sumByHorizon[horizon] / count).toFixed(2)) : 0];
    }),
  ) as Record<NearMissOutcomeHorizon, number>;

  return {
    totalCount: entries.length,
    activeCount: entries.filter((entry) => !entry.closed).length,
    closedCount: entries.filter((entry) => entry.closed).length,
    observedCountByHorizon,
    avgReturnPctByHorizon,
  };
}

export function getAllNearMissOutcomes(): NearMissOutcomeEntry[] {
  return loadEntries();
}

export function __resetNearMissOutcomeLedgerForTests(): void {
  try {
    if (fs.existsSync(NEAR_MISS_OUTCOME_LEDGER_FILE)) fs.unlinkSync(NEAR_MISS_OUTCOME_LEDGER_FILE);
  } catch {
    /* ignore */
  }
}
