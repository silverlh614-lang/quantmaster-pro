// @responsibility SECTOR-CLASSIFICATION-SNAPSHOT grouped SectorEnergy shadow diagnostics regression tests.

import { describe, expect, it } from 'vitest';
import {
  SYMBOL_SECTOR_SNAPSHOT,
  evaluateSectorClassificationSnapshotCoverage,
} from './sectorClassificationSnapshot.js';
import {
  buildGroupedSectorEnergyFromSnapshotQuotes,
  formatGroupedSectorEnergyDiagnosticSection,
  type SymbolGroupedEnergyQuote,
} from './groupedSectorEnergyProvider.js';

function quote(symbol: string, idx: number): SymbolGroupedEnergyQuote {
  const close = 100 + idx;
  return {
    symbol,
    close,
    previousClose: close * 0.99,
    close5dAgo: close * 0.96,
    close20dAgo: close * 0.90,
    tradingValue: 150,
    tradingValue20dAvg: 100,
    volume: 170,
    volume20dAvg: 100,
    ma20: close * 0.95,
    high20d: close * 1.01,
  };
}

describe('SECTOR-CLASSIFICATION-SNAPSHOT grouped sector energy', () => {
  it('classifies the 46-symbol internal snapshot without forcing missing rows into OTHER', () => {
    const symbols = SYMBOL_SECTOR_SNAPSHOT.map((row) => row.symbol);
    expect(symbols).toHaveLength(46);

    const coverage = evaluateSectorClassificationSnapshotCoverage(symbols);

    expect(coverage.snapshotCoverage).toBe('46/46');
    expect(coverage.classifiedSymbols).toBe(46);
    expect(coverage.missingClassification).toBe(0);
    expect(coverage.source).toBe('INTERNAL_SNAPSHOT');
    expect(coverage.confidence).toBe('VERIFIED');
    expect(coverage.executionImpact).toBe('NONE');
  });

  it('keeps grouped energy available when KRX benchmark coverage is unavailable', () => {
    const quotes = SYMBOL_SECTOR_SNAPSHOT.map((row, index) => quote(row.symbol, index));

    const snapshot = buildGroupedSectorEnergyFromSnapshotQuotes(quotes);

    expect(snapshot.groupedValidSectorCount).toBeGreaterThan(0);
    expect(snapshot.results.every((result) => result.status !== 'GROUPED_ENERGY_NOT_EVALUATED')).toBe(true);
    expect(snapshot.benchmarkStatus).toMatch(/KRX_BENCHMARK_/);
    expect(snapshot.sourceTier).toBe('INTERNAL_GROUPED_SNAPSHOT');
    expect(snapshot.leadershipConfidence).toBe('SHADOW_SCORE');
    expect(snapshot.sectorBoostAllowed).toBe(false);
    expect(snapshot.strongBuyAllowed).toBe(false);
    expect(snapshot.executionImpact).toBe('NONE');
    expect(snapshot.marketSignal).toBe(false);
  });

  it('reports missing classification separately instead of silently absorbing it into OTHER', () => {
    const quotes = [quote('005930', 1), quote('999999', 2)];

    const snapshot = buildGroupedSectorEnergyFromSnapshotQuotes(quotes);

    expect(snapshot.classification.classifiedSymbols).toBe(1);
    expect(snapshot.classification.missingClassification).toBe(1);
    expect(snapshot.classification.missingSymbols).toEqual(['999999']);
    expect(snapshot.results.every((result) => result.sectorKey !== 'OTHER')).toBe(true);
  });

  it('/scan_blockers sector formatter exposes snapshot coverage, grouped counts, benchmark status, and shadow-only safety flags', () => {
    const snapshot = buildGroupedSectorEnergyFromSnapshotQuotes(
      SYMBOL_SECTOR_SNAPSHOT.slice(0, 8).map((row, index) => quote(row.symbol, index)),
    );

    const section = formatGroupedSectorEnergyDiagnosticSection(snapshot);

    expect(section).toContain('Sector Classification Snapshot');
    expect(section).toContain('snapshotCoverage: 8/8');
    expect(section).toContain('Grouped Sector Energy');
    expect(section).toContain('groupedValidSectorCount:');
    expect(section).toContain('internalGroupedSnapshotCoverage:');
    expect(section).toContain('benchmarkStatus:');
    expect(section).toContain('sourceTier: INTERNAL_GROUPED_SNAPSHOT');
    expect(section).toContain('sectorBoostAllowed=false');
    expect(section).toContain('strongBuyAllowed=false');
    expect(section).toContain('executionImpact=NONE');
  });
});
