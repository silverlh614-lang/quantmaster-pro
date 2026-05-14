// @responsibility Internal snapshot-grouped SectorEnergy shadow/advisory calculator (no external calls).

import { SECTOR_INDEX_MASTER } from './sectorEnergyMaster.js';
import {
  evaluateSectorClassificationSnapshotCoverage,
  getSymbolSectorSnapshotRow,
  groupSymbolsBySnapshotSector,
  normalizeKrxSymbol,
  type SectorClassificationConfidence,
  type SectorClassificationSource,
  type StandardSectorKey,
} from './sectorClassificationSnapshot.js';

const GROUPED_SECTOR_REPORTING_COUNT = 12;

export type GroupedSectorEnergyStatus =
  | 'GROUPED_ENERGY_OK'
  | 'GROUPED_ENERGY_PARTIAL'
  | 'GROUPED_ENERGY_STALE'
  | 'GROUPED_ENERGY_NOT_EVALUATED';

export type SectorBenchmarkStatus =
  | 'KRX_BENCHMARK_OK'
  | 'KRX_BENCHMARK_UNAVAILABLE'
  | 'KRX_BENCHMARK_PARTIAL'
  | 'KIS_PROXY_ONLY';

export type GroupedSectorEnergyResult = {
  sectorKey: StandardSectorKey;
  sectorName: string;
  constituentCount: number;
  evaluatedCount: number;

  return1d?: number;
  return5d?: number;
  return20d?: number;
  tradingValueChangePct?: number;
  advancingBreadthPct?: number;
  aboveMa20BreadthPct?: number;
  newHighNearPct?: number;
  volumeSurgeBreadthPct?: number;
  topConstituentMomentum?: number;

  groupedEnergyScore: number;
  status: GroupedSectorEnergyStatus;

  classificationSource: SectorClassificationSource;
  classificationConfidence: SectorClassificationConfidence;

  benchmarkStatus: SectorBenchmarkStatus;
  krxIndexCode?: string;
  krxBenchmarkReturn20d?: number;

  sourceTier: 'INTERNAL_GROUPED_SNAPSHOT' | 'KRX_OFFICIAL_INDEX' | 'KIS_BASKET_PROXY';
  leadershipConfidence: 'OBSERVE' | 'SHADOW_SCORE' | 'ADVISORY' | 'BLOCKED';

  sectorBoostAllowed: false;
  strongBuyAllowed: false;
  executionImpact: 'NONE';
  marketSignal: false;
};

export interface SymbolGroupedEnergyQuote {
  symbol: string;
  close?: number;
  previousClose?: number;
  close5dAgo?: number;
  close20dAgo?: number;
  tradingValue?: number;
  tradingValue20dAvg?: number;
  volume?: number;
  volume20dAvg?: number;
  ma20?: number;
  high20d?: number;
}

export interface GroupedSectorEnergySnapshot {
  classification: ReturnType<typeof evaluateSectorClassificationSnapshotCoverage>;
  results: GroupedSectorEnergyResult[];
  groupedValidSectorCount: number;
  expectedSectorCount: number;
  benchmarkStatus: SectorBenchmarkStatus;
  sourceTier: 'INTERNAL_GROUPED_SNAPSHOT';
  leadershipConfidence: 'OBSERVE' | 'SHADOW_SCORE' | 'ADVISORY' | 'BLOCKED';
  sectorBoostAllowed: false;
  strongBuyAllowed: false;
  executionImpact: 'NONE';
  marketSignal: false;
  topGroupedSectors: string[];
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function avg(values: number[]): number | undefined {
  const finiteValues = values.filter(finite);
  if (finiteValues.length === 0) return undefined;
  return finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length;
}

function pct(from: number | undefined, to: number | undefined): number | undefined {
  if (!finite(from) || from <= 0 || !finite(to)) return undefined;
  return ((to - from) / from) * 100;
}

function scorePct(value: number | undefined, min = -10, max = 10): number {
  if (!finite(value)) return 0;
  return clamp(((value - min) / (max - min)) * 100, 0, 100);
}

function scoreBreadth(value: number | undefined): number {
  if (!finite(value)) return 0;
  return clamp(value, 0, 100);
}

function benchmarkForSector(sectorKey: StandardSectorKey): { status: SectorBenchmarkStatus; krxIndexCode?: string } {
  const entry = SECTOR_INDEX_MASTER.find((item) => item.sectorKey === sectorKey);
  return entry?.krxIndexCode
    ? { status: 'KRX_BENCHMARK_OK', krxIndexCode: entry.krxIndexCode }
    : { status: 'KRX_BENCHMARK_UNAVAILABLE' };
}

function statusForCounts(constituentCount: number, evaluatedCount: number): GroupedSectorEnergyStatus {
  if (constituentCount <= 0) return 'GROUPED_ENERGY_NOT_EVALUATED';
  if (evaluatedCount <= 0) return 'GROUPED_ENERGY_NOT_EVALUATED';
  if (evaluatedCount < 2) return 'GROUPED_ENERGY_PARTIAL';
  if (evaluatedCount < constituentCount) return 'GROUPED_ENERGY_PARTIAL';
  return 'GROUPED_ENERGY_OK';
}

function buildSectorResult(
  sectorKey: StandardSectorKey,
  sectorName: string,
  constituentCount: number,
  quotes: SymbolGroupedEnergyQuote[],
  classificationConfidence: SectorClassificationConfidence,
): GroupedSectorEnergyResult {
  const evaluated = quotes.filter((quote) => finite(quote.close) && quote.close > 0);
  const evaluatedCount = evaluated.length;
  const return1d = avg(evaluated.map((quote) => pct(quote.previousClose, quote.close)).filter(finite));
  const return5d = avg(evaluated.map((quote) => pct(quote.close5dAgo, quote.close)).filter(finite));
  const return20d = avg(evaluated.map((quote) => pct(quote.close20dAgo, quote.close)).filter(finite));
  const tradingValueChangePct = avg(evaluated.map((quote) => pct(quote.tradingValue20dAvg, quote.tradingValue)).filter(finite));
  const advancingBreadthPct = evaluatedCount > 0
    ? (evaluated.filter((quote) => finite(pct(quote.previousClose, quote.close)) && (pct(quote.previousClose, quote.close) ?? 0) > 0).length / evaluatedCount) * 100
    : undefined;
  const aboveMa20BreadthPct = evaluatedCount > 0
    ? (evaluated.filter((quote) => finite(quote.ma20) && finite(quote.close) && quote.close > (quote.ma20 ?? 0)).length / evaluatedCount) * 100
    : undefined;
  const newHighNearPct = evaluatedCount > 0
    ? (evaluated.filter((quote) => finite(quote.high20d) && finite(quote.close) && quote.close >= (quote.high20d ?? 0) * 0.97).length / evaluatedCount) * 100
    : undefined;
  const volumeSurgeBreadthPct = evaluatedCount > 0
    ? (evaluated.filter((quote) => finite(quote.volume) && finite(quote.volume20dAvg) && (quote.volume20dAvg ?? 0) > 0 && (quote.volume ?? 0) >= (quote.volume20dAvg ?? 0) * 1.5).length / evaluatedCount) * 100
    : undefined;
  const topConstituentMomentum = evaluated
    .map((quote) => pct(quote.close20dAgo, quote.close))
    .filter(finite)
    .sort((a, b) => b - a)[0];

  const returnRankScore = scorePct(return20d ?? return5d ?? return1d);
  const tradingValueRankScore = scorePct(tradingValueChangePct, -30, 80);
  const advancingBreadthScore = scoreBreadth(advancingBreadthPct);
  const newHighBreadthScore = scoreBreadth(newHighNearPct);
  const volumeSurgeBreadthScore = scoreBreadth(volumeSurgeBreadthPct);
  const groupedEnergyScore = clamp(
    returnRankScore * 0.25 +
    tradingValueRankScore * 0.25 +
    advancingBreadthScore * 0.20 +
    newHighBreadthScore * 0.15 +
    volumeSurgeBreadthScore * 0.15,
    0,
    100,
  );
  const benchmark = benchmarkForSector(sectorKey);
  const status = statusForCounts(constituentCount, evaluatedCount);
  const leadershipConfidence: GroupedSectorEnergyResult['leadershipConfidence'] = status === 'GROUPED_ENERGY_OK'
    ? 'SHADOW_SCORE'
    : status === 'GROUPED_ENERGY_PARTIAL' ? 'OBSERVE' : 'BLOCKED';

  return {
    sectorKey,
    sectorName,
    constituentCount,
    evaluatedCount,
    ...(return1d !== undefined ? { return1d } : {}),
    ...(return5d !== undefined ? { return5d } : {}),
    ...(return20d !== undefined ? { return20d } : {}),
    ...(tradingValueChangePct !== undefined ? { tradingValueChangePct } : {}),
    ...(advancingBreadthPct !== undefined ? { advancingBreadthPct } : {}),
    ...(aboveMa20BreadthPct !== undefined ? { aboveMa20BreadthPct } : {}),
    ...(newHighNearPct !== undefined ? { newHighNearPct } : {}),
    ...(volumeSurgeBreadthPct !== undefined ? { volumeSurgeBreadthPct } : {}),
    ...(topConstituentMomentum !== undefined ? { topConstituentMomentum } : {}),
    groupedEnergyScore,
    status,
    classificationSource: 'INTERNAL_SNAPSHOT',
    classificationConfidence,
    benchmarkStatus: benchmark.status,
    ...(benchmark.krxIndexCode ? { krxIndexCode: benchmark.krxIndexCode } : {}),
    sourceTier: 'INTERNAL_GROUPED_SNAPSHOT',
    leadershipConfidence,
    sectorBoostAllowed: false,
    strongBuyAllowed: false,
    executionImpact: 'NONE',
    marketSignal: false,
  };
}

export function buildGroupedSectorEnergyFromSnapshotQuotes(
  quotes: readonly SymbolGroupedEnergyQuote[],
): GroupedSectorEnergySnapshot {
  const quoteBySymbol = new Map(quotes.map((quote) => [normalizeKrxSymbol(quote.symbol), quote]));
  const symbols = Array.from(quoteBySymbol.keys());
  const classification = evaluateSectorClassificationSnapshotCoverage(symbols);
  const grouped = groupSymbolsBySnapshotSector(symbols);
  const results: GroupedSectorEnergyResult[] = [];

  for (const [sectorKey, rows] of grouped.entries()) {
    const sectorQuotes = rows
      .map((row) => quoteBySymbol.get(row.symbol))
      .filter((quote): quote is SymbolGroupedEnergyQuote => Boolean(quote));
    results.push(buildSectorResult(
      sectorKey,
      rows[0]?.sectorName ?? sectorKey,
      rows.length,
      sectorQuotes,
      classification.confidence,
    ));
  }

  const rawGroupedValidSectorCount = results.filter((result) => result.status === 'GROUPED_ENERGY_OK' || result.status === 'GROUPED_ENERGY_PARTIAL').length;
  const groupedValidSectorCount = Math.min(rawGroupedValidSectorCount, GROUPED_SECTOR_REPORTING_COUNT);
  const topGroupedSectors = [...results]
    .sort((a, b) => b.groupedEnergyScore - a.groupedEnergyScore)
    .slice(0, 3)
    .map((result) => result.sectorKey);
  const hasKrxBenchmark = results.some((result) => result.benchmarkStatus === 'KRX_BENCHMARK_OK');
  const benchmarkStatus: SectorBenchmarkStatus = hasKrxBenchmark ? 'KRX_BENCHMARK_PARTIAL' : 'KRX_BENCHMARK_UNAVAILABLE';
  const leadershipConfidence: GroupedSectorEnergySnapshot['leadershipConfidence'] = groupedValidSectorCount >= 3
    ? 'SHADOW_SCORE'
    : groupedValidSectorCount > 0 ? 'OBSERVE' : 'BLOCKED';

  return {
    classification,
    results,
    groupedValidSectorCount,
    expectedSectorCount: GROUPED_SECTOR_REPORTING_COUNT,
    benchmarkStatus,
    sourceTier: 'INTERNAL_GROUPED_SNAPSHOT',
    leadershipConfidence,
    sectorBoostAllowed: false,
    strongBuyAllowed: false,
    executionImpact: 'NONE',
    marketSignal: false,
    topGroupedSectors,
  };
}

export function buildGroupedSectorEnergyFromSectorInputs(input: {
  symbols: readonly string[];
  returnBySymbol?: ReadonlyMap<string, Pick<SymbolGroupedEnergyQuote, 'close' | 'previousClose' | 'close5dAgo' | 'close20dAgo' | 'tradingValue' | 'tradingValue20dAvg' | 'volume' | 'volume20dAvg' | 'ma20' | 'high20d'>>;
}): GroupedSectorEnergySnapshot {
  const quotes = Array.from(new Set(input.symbols.map(normalizeKrxSymbol))).map((symbol) => ({
    symbol,
    ...(input.returnBySymbol?.get(symbol) ?? {}),
  }));
  return buildGroupedSectorEnergyFromSnapshotQuotes(quotes);
}

export function formatGroupedSectorEnergyDiagnosticSection(snapshot: GroupedSectorEnergySnapshot | null | undefined): string | null {
  if (!snapshot) return null;
  const lines: string[] = [];
  lines.push('🧭 Sector Classification Snapshot (ADR-0423):');
  lines.push(`  • snapshotCoverage: ${snapshot.classification.snapshotCoverage}`);
  lines.push(`  • classifiedSymbols: ${snapshot.classification.classifiedSymbols}`);
  lines.push(`  • missingClassification: ${snapshot.classification.missingClassification}`);
  lines.push(`  • source=${snapshot.classification.source}`);
  lines.push(`  • confidence=${snapshot.classification.confidence}`);
  lines.push('');
  lines.push('📊 Grouped Sector Energy (ADR-0423):');
  lines.push(`  • groupedStatus: ${snapshot.groupedValidSectorCount > 0 ? 'GROUPED_ENERGY_OK' : 'GROUPED_ENERGY_NOT_EVALUATED'}`);
  lines.push(`  • groupedValidSectorCount: ${snapshot.groupedValidSectorCount}/${snapshot.expectedSectorCount}`);
  lines.push(`  • topGroupedSectors: ${snapshot.topGroupedSectors.join(', ') || 'none'}`);
  lines.push(`  • benchmarkStatus: ${snapshot.benchmarkStatus}`);
  lines.push(`  • sourceTier: ${snapshot.sourceTier}`);
  lines.push(`  • leadershipConfidence: ${snapshot.leadershipConfidence}`);
  lines.push(`  • sectorBoostAllowed=${snapshot.sectorBoostAllowed}`);
  lines.push(`  • strongBuyAllowed=${snapshot.strongBuyAllowed}`);
  lines.push(`  • executionImpact=${snapshot.executionImpact}`);
  return lines.join('\n');
}

export function getSnapshotSectorName(symbol: string): string | undefined {
  return getSymbolSectorSnapshotRow(symbol)?.sectorName;
}
