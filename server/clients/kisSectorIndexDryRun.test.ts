// @responsibility KIS sector index daily diagnostic-only dry-run 회귀
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KIS_SECTOR_ISCD_MAP } from './kisClient/query.js';
import { buildKisSectorEnergyInputsWithMeta } from './kisSectorEnergyProvider.js';
import type { KisSectorIndexDaily } from './kisClient/types.js';

const _fetchKisSectorIndexDaily = vi.fn();

vi.mock('./kisClient/query.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./kisClient/query.js')>();
  return {
    ...actual,
    fetchKisSectorIndexDaily: (iscd: string) => _fetchKisSectorIndexDaily(iscd),
  };
});

function sectorSeries(days: number, startClose = 100): KisSectorIndexDaily['series'] {
  return Array.from({ length: days }, (_, idx) => ({
    baseDate: `202605${String(idx + 1).padStart(2, '0')}`,
    close: startClose + idx,
    open: startClose + idx - 0.5,
    high: startClose + idx + 1,
    low: startClose + idx - 1,
    volume: 1000 + idx * 10,
    value: 100000 + idx * 1000,
  }));
}

function dailyResult(iscd: string, days = 25): KisSectorIndexDaily {
  return {
    sectorIscd: iscd,
    sectorName: `sector-${iscd}`,
    currentIndex: 100,
    changePct: 1,
    series: sectorSeries(days),
    fetchedAt: '2026-05-14T00:00:00.000Z',
    source: 'KIS_API',
  };
}

describe('KIS_SECTOR_INDEX_DRYRUN diagnostic-only', () => {
  let mod: typeof import('./kisSectorEnergyProvider.js');

  beforeEach(async () => {
    vi.resetModules();
    _fetchKisSectorIndexDaily.mockReset();
    delete process.env.KIS_SECTOR_INDEX_DAILY_ENABLED;
    mod = await import('./kisSectorEnergyProvider.js');
    mod.resetKisSectorIndexDryRunCacheForTests();
  });

  afterEach(() => {
    delete process.env.KIS_SECTOR_INDEX_DAILY_ENABLED;
    vi.clearAllMocks();
  });

  it('ENV off이면 attempted=0 + KIS 호출 0건', async () => {
    const report = await mod.fetchKisSectorIndexRowsDryRun();
    expect(report.enabled).toBe(false);
    expect(report.attempted).toBe(0);
    expect(report.rows).toEqual([]);
    expect(report.dataQuality).toBe('PARTIAL');
    expect(report.executionImpact).toBe('NONE');
    expect(_fetchKisSectorIndexDaily).not.toHaveBeenCalled();
  });

  it('ENV on이면 12개 map 순회 + 성공 row return5d/return20d 계산', async () => {
    process.env.KIS_SECTOR_INDEX_DAILY_ENABLED = 'true';
    _fetchKisSectorIndexDaily.mockImplementation((iscd: string) => Promise.resolve(dailyResult(iscd)));

    const report = await mod.fetchKisSectorIndexRowsDryRun(1000);

    expect(report.enabled).toBe(true);
    expect(report.attempted).toBe(12);
    expect(report.succeeded).toBe(12);
    expect(report.failed).toBe(0);
    expect(_fetchKisSectorIndexDaily).toHaveBeenCalledTimes(12);
    expect(_fetchKisSectorIndexDaily.mock.calls.map((call) => call[0])).toEqual(
      KIS_SECTOR_ISCD_MAP.map((row) => row.iscd),
    );
    expect(report.rows[0].success).toBe(true);
    expect(report.rows[0].seriesCount).toBe(25);
    expect(report.rows[0].latestDate).toBe('20260525');
    expect(report.rows[0].return5d).toBeGreaterThan(0);
    expect(report.rows[0].return20d).toBeGreaterThan(0);
  });

  it('실패 row는 throw 없이 기록하고 providerIssue=true로 남긴다', async () => {
    process.env.KIS_SECTOR_INDEX_DAILY_ENABLED = 'true';
    _fetchKisSectorIndexDaily.mockImplementation((iscd: string) => {
      if (iscd === KIS_SECTOR_ISCD_MAP[0].iscd) return Promise.resolve(null);
      return Promise.resolve(dailyResult(iscd));
    });

    const report = await mod.fetchKisSectorIndexRowsDryRun(1000);
    expect(report.failed).toBe(1);
    expect(report.rows[0]).toMatchObject({
      success: false,
      providerIssue: true,
      error: 'KIS_EMPTY_OR_DISABLED',
    });
  });

  it('보고서 안전 플래그는 live 매매 영향 없음으로 고정', async () => {
    process.env.KIS_SECTOR_INDEX_DAILY_ENABLED = 'true';
    _fetchKisSectorIndexDaily.mockResolvedValue(null);
    const report = await mod.fetchKisSectorIndexRowsDryRun(1000);
    expect(report.dataQuality).toBe('PARTIAL');
    expect(report.dataQuality).not.toBe('OK');
    expect(report.sectorBoostAllowed).toBe(false);
    expect(report.strongBuyAllowed).toBe(false);
    expect(report.executionImpact).toBe('NONE');
    expect(report.marketSignal).toBe(false);
    expect(report.providerIssue).toBe(true);
  });

  it('sectorEnergyProvider live fallback은 dry-run을 호출하지 않는다', async () => {
    process.env.KIS_SECTOR_INDEX_DAILY_ENABLED = 'true';
    await buildKisSectorEnergyInputsWithMeta({
      fetchOfficialIndexRows: async () => [],
      fetchOfficialDailyRows: async () => [],
      fetchCandles: async () => [],
    });
    expect(_fetchKisSectorIndexDaily).not.toHaveBeenCalled();
  });
});
