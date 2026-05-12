import { afterEach, describe, expect, it } from 'vitest';
import { SECTOR_INDEX_MASTER, type SectorKey } from './sectorEnergyMaster.js';
import {
  KIS_REPRESENTATIVE_SECTOR_BASKET,
  buildKisSectorBasketRowsFromSeries,
  buildKisSectorEnergyBasketFromSeries,
  buildKisSectorEnergyInputsWithMeta,
  rankKisSectorEnergyInputs,
  resetKisSectorEnergyProviderOverridesForTests,
  setKisSectorEnergyProviderOverridesForTests,
  type KisSectorEnergyIndexRow,
} from './kisSectorEnergyProvider.js';
import { scoreSectorEnergyAdr0462 } from './sectorEnergyScorer.js';
import type { SectorCoverageReport } from './sectorCoverage.js';
import type { SectorSymmetryValidationResult } from './sectorSymmetryValidator.js';
import type { KisChartCandle } from '../screener/kisChartDataFetcher.js';

function candles(start: number, end: number): KisChartCandle[] {
  const rows: KisChartCandle[] = [];
  for (let i = 0; i < 25; i += 1) {
    const t = i / 24;
    const close = Math.round(start + (end - start) * t);
    rows.push({
      date: `202604${String(i + 1).padStart(2, '0')}`,
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1000 + i * 20,
    });
  }
  return rows;
}

function allBasketSeries(strongSector?: SectorKey): Record<string, KisChartCandle[]> {
  const series: Record<string, KisChartCandle[]> = {};
  for (const [sectorKey, codes] of Object.entries(KIS_REPRESENTATIVE_SECTOR_BASKET)) {
    const isStrong = sectorKey === strongSector;
    for (const code of codes) {
      series[code] = isStrong ? candles(100, 150) : candles(100, 101);
    }
  }
  return series;
}

function officialRows(): KisSectorEnergyIndexRow[] {
  return SECTOR_INDEX_MASTER.map((entry, idx) => ({
    sectorKey: entry.sectorKey,
    sectorReturn5d: 3 + idx,
    sectorReturn20d: 7 + idx,
    turnoverAcceleration: 10 + idx,
    breadthAbove20ma: 80,
    foreignInstitutionFlowAlignment: 60,
  }));
}

function coverageWith(indexValid: number): SectorCoverageReport {
  const metric = { valid: 10, total: 10, ratio: 1 };
  return {
    sectorCoverage: metric,
    indexCodeCoverage: { valid: indexValid, total: 10, ratio: indexValid / 10 },
    aliasCoverage: metric,
    providerCoverage: metric,
  };
}

const okSymmetry: SectorSymmetryValidationResult = {
  ok: true,
  failedReasons: [],
  duplicateAliases: [],
  missingIndexCodes: [],
  unresolvedAliases: [],
  reverseLookupFailures: [],
  aggregateIgnored: 0,
};

afterEach(() => {
  resetKisSectorEnergyProviderOverridesForTests();
  delete process.env.KIS_SECTOR_ENERGY_PROVIDER_ENABLED;
});

describe('KIS SectorEnergy provider', () => {
  it('selects KIS official sector index as WEIGHTED without live execution', async () => {
    const result = await buildKisSectorEnergyInputsWithMeta({
      fetchOfficialIndexRows: async () => officialRows(),
    });

    expect(result.sourceTier).toBe('KIS_OFFICIAL_INDEX');
    expect(result.dataQuality).toBe('OK');
    expect(result.leadershipConfidence).toBe('WEIGHTED');
    expect(result.coverageBreakdown.kisOfficialCoverage).toBe(1);
    expect(result.liveExecutionAllowed).toBe(false);
    expect(result.executionImpact).toBe('NONE');
    expect(result.marketSignal).toBe(false);
  });

  it('uses KIS official price basket as PARTIAL when official index is missing', async () => {
    const series = allBasketSeries();
    const result = await buildKisSectorEnergyInputsWithMeta({
      fetchOfficialIndexRows: async () => [],
      fetchOfficialDailyRows: async () => [],
      fetchCandles: async (code) => series[code] ?? [],
    });

    expect(result.sourceTier).toBe('KIS_STOCK_BASKET_DERIVED');
    expect(result.dataQuality).toBe('PARTIAL');
    expect(result.validSectorCount).toBe(12);
    expect(result.coverageBreakdown.verifiedIndexCodeCoverage).toBe(0);
    expect(result.coverageBreakdown.kisBasketCoverage).toBe(1);
    expect(result.confidence).toBe(0.65);
    expect(result.leadershipConfidence).toBe('READY_FOR_SHADOW');
    expect(result.liveExecutionAllowed).toBe(false);
    expect(result.providerIssue).toBe(false);
    expect(result.marketSignal).toBe(false);
  });

  it('generates KIS sector basket rows from representative daily chart prices only as PARTIAL shadow data', () => {
    const rows = buildKisSectorBasketRowsFromSeries(allBasketSeries('SHIPBUILDING'));

    expect(rows).toHaveLength(12);
    expect(rows[0]).toMatchObject({
      sectorKey: 'SHIPBUILDING',
      displayName: '조선',
      validPriceCount: 4,
      source: 'KIS_DAILY_CHART',
      confidence: 'PARTIAL',
    });
    expect(rows[0]?.return1d).toBeGreaterThan(0);
    expect(rows[0]?.return5d).toBeGreaterThan(0);
    expect(rows[0]?.return20d).toBeGreaterThan(0);
    expect(rows[0]?.representativeCodes).toEqual(['329180', '042660', '010140', '009540']);
  });

  it('ranks top sectors from KIS basket returns', () => {
    const series = allBasketSeries('SEMICONDUCTOR');
    const inputs = buildKisSectorEnergyBasketFromSeries(series);
    const top = rankKisSectorEnergyInputs(inputs)[0];
    const semiconductorName = SECTOR_INDEX_MASTER.find((entry) => entry.sectorKey === 'SEMICONDUCTOR')?.displayName;

    expect(inputs).toHaveLength(12);
    expect(top?.name).toBe(semiconductorName);
    expect(top?.sourceTier).toBe('KIS_STOCK_BASKET_DERIVED');
  });

  it('marks all-missing KIS sector data as provider issue but not market signal', async () => {
    const result = await buildKisSectorEnergyInputsWithMeta({
      fetchOfficialIndexRows: async () => [],
      fetchOfficialDailyRows: async () => [],
      fetchCandles: async () => [],
    });

    expect(result.sourceTier).toBe('MISSING');
    expect(result.dataQuality).toBe('FAILED');
    expect(result.providerIssue).toBe(true);
    expect(result.marketSignal).toBe(false);
    expect(result.liveExecutionAllowed).toBe(false);
  });

  it('keeps KIS basket usable while internal proxy remains diagnostic-only', () => {
    const kisBasket = scoreSectorEnergyAdr0462({
      sourceTier: 'KIS_STOCK_BASKET_DERIVED',
      coverage: coverageWith(0),
      symmetryValidation: okSymmetry,
      rawLeadershipScore: 88,
    });
    expect(kisBasket.mode).toBe('LIMITED_SCORING');
    expect(kisBasket.leadershipConfidence).toBe('READY_FOR_SHADOW');
    expect(kisBasket.sectorBoost).toBe(0);
    expect(kisBasket.strongBuyBlocked).toBe(true);

    const internal = scoreSectorEnergyAdr0462({
      sourceTier: 'INTERNAL_PROXY',
      coverage: coverageWith(10),
      symmetryValidation: okSymmetry,
      rawLeadershipScore: 88,
    });
    expect(internal.mode).toBe('DIAGNOSTIC_ONLY');
    expect(internal.leadershipConfidence).toBe('BLOCKED');
    expect(internal.sectorBoost).toBe(0);
  });

  it('mounts KIS basket ahead of KRX/cache/Yahoo in the SectorEnergy provider chain', async () => {
    process.env.KIS_SECTOR_ENERGY_PROVIDER_ENABLED = 'true';
    const series = allBasketSeries('FINANCE');
    setKisSectorEnergyProviderOverridesForTests({
      fetchOfficialIndexRows: async () => [],
      fetchOfficialDailyRows: async () => [],
      fetchCandles: async (code) => series[code] ?? [],
    });

    const mod = await import('./sectorEnergyProvider.js');
    const result = await mod.buildSectorEnergyInputsWithMetaWithFallback();

    expect(result.sourceTier).toBe('KIS_STOCK_BASKET_DERIVED');
    expect(result.dataQuality).toBe('PARTIAL');
    expect(result.diagnostics?.finalSourceTier).toBe('KIS_STOCK_BASKET_DERIVED');
    expect(result.diagnostics?.coverageBreakdown?.kisBasketCoverage).toBe(1);
    expect(result.diagnostics?.liveExecutionAllowed).toBe(false);
    expect(result.diagnostics?.executionImpact).toBe('NONE');
  });
});
