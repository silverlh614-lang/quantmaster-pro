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

    const section = mod.formatKisSectorIndexDryRunSection(report);
    expect(section).toContain('successTop:');
    expect(section).toContain('latest=<code>20260525</code>');
    expect(section).toContain('rows=<b>25</b>');
    expect(section).toContain('return5d=<code>');
    expect(section).toContain('return20d=<code>');
    expect(section).toContain('candidateCoverage: <b>100.0%</b>');
    expect(section).toContain('promotionStage: <code>OBSERVE</code>');
    expect(section).toContain('sectorBoostAllowed: <b>false</b>');
    expect(section).toContain('strongBuyAllowed: <b>false</b>');
    expect(section).toContain('executionImpact: <code>NONE</code>');
  });

  it('실패 row는 sectorKey/label/iscd/errorClass를 formatter에 노출한다', async () => {
    process.env.KIS_SECTOR_INDEX_DAILY_ENABLED = 'true';
    _fetchKisSectorIndexDaily.mockImplementation((iscd: string) => {
      if (iscd === '2005' || iscd === '2006') return Promise.resolve({ ...dailyResult(iscd), series: [] });
      return Promise.resolve(dailyResult(iscd));
    });

    const report = await mod.fetchKisSectorIndexRowsDryRun(1000);
    const section = mod.formatKisSectorIndexDryRunSection(report);

    expect(report.failed).toBe(2);
    for (const row of report.rows.filter((item) => !item.success)) {
      expect(section).toContain(`<code>${row.sectorKey}</code> / ${row.label} / iscd=<code>${row.iscd}</code> / errorClass=<code>UNRESOLVED_EMPTY</code>`);
    }
    expect(section).not.toContain('failedIscd');
  });

  it('실패 원인을 INVALID_CODE/PROVIDER_500/TIMEOUT/INSUFFICIENT_SERIES로 분류한다', async () => {
    process.env.KIS_SECTOR_INDEX_DAILY_ENABLED = 'true';
    const invalidIscd = KIS_SECTOR_ISCD_MAP[0].iscd;
    const provider500Iscd = KIS_SECTOR_ISCD_MAP[1].iscd;
    const timeoutIscd = KIS_SECTOR_ISCD_MAP[2].iscd;
    const insufficientIscd = KIS_SECTOR_ISCD_MAP[3].iscd;
    const disabledIscd = KIS_SECTOR_ISCD_MAP[4].iscd;
    _fetchKisSectorIndexDaily.mockImplementation((iscd: string) => {
      if (iscd === invalidIscd) throw new Error('invalid code');
      if (iscd === provider500Iscd) throw new Error('provider 500 internal server');
      if (iscd === timeoutIscd) throw new Error('request timeout');
      if (iscd === insufficientIscd) return Promise.resolve(dailyResult(iscd, 10));
      if (iscd === disabledIscd) throw new Error('KIS sector index disabled');
      return Promise.resolve(dailyResult(iscd));
    });

    const report = await mod.fetchKisSectorIndexRowsDryRun(1000);
    expect(report.rows.find((row) => row.iscd === invalidIscd)?.errorClass).toBe('INVALID_CODE');
    expect(report.rows.find((row) => row.iscd === provider500Iscd)?.errorClass).toBe('PROVIDER_500');
    expect(report.rows.find((row) => row.iscd === timeoutIscd)?.errorClass).toBe('TIMEOUT');
    expect(report.rows.find((row) => row.iscd === insufficientIscd)?.errorClass).toBe('INSUFFICIENT_SERIES');
    expect(report.rows.find((row) => row.iscd === disabledIscd)?.errorClass).toBe('DISABLED');
  });

  it('failed iscd는 10분 negative cooldown 동안 재호출하지 않는다', async () => {
    process.env.KIS_SECTOR_INDEX_DAILY_ENABLED = 'true';
    const failedIscd = KIS_SECTOR_ISCD_MAP[0].iscd;
    _fetchKisSectorIndexDaily.mockImplementation((iscd: string) => {
      if (iscd === failedIscd) return Promise.resolve({ ...dailyResult(iscd), series: [] });
      return Promise.resolve(dailyResult(iscd));
    });

    await mod.fetchKisSectorIndexRowsDryRun(1000);
    mod.resetKisSectorIndexDryRunCacheForTests({ keepNegativeCooldown: true });
    await mod.fetchKisSectorIndexRowsDryRun(1000 + 9 * 60 * 1000);

    expect(_fetchKisSectorIndexDaily.mock.calls.filter((call) => call[0] === failedIscd)).toHaveLength(1);
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
      providerIssue: false,
      marketSignal: false,
      error: 'KIS_EMPTY_OR_DISABLED',
      errorClass: 'UNRESOLVED_EMPTY',
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
    expect(report.providerIssue).toBe(false);
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

  it('dry-run 10/12 성공은 candidateCoverage=83.3%로 표시하고 promotionStage=OBSERVE를 유지한다', async () => {
    process.env.KIS_SECTOR_INDEX_DAILY_ENABLED = 'true';
    _fetchKisSectorIndexDaily.mockImplementation((iscd: string) => {
      if (iscd === '2005' || iscd === '2006') return Promise.resolve({ ...dailyResult(iscd), series: [] });
      return Promise.resolve(dailyResult(iscd));
    });

    const report = await mod.fetchKisSectorIndexRowsDryRun(1000);
    const section = mod.formatKisSectorIndexDryRunSection(report);

    expect(report.succeeded).toBe(10);
    expect(report.failed).toBe(2);
    expect(report.candidateCoverage).toBeCloseTo(10 / 12, 5);
    expect(report.promotionStage).toBe('OBSERVE');
    expect(report.strongBuyAllowed).toBe(false);
    expect(section).toContain('candidateCoverage: <b>83.3%</b>');
    expect(section).toContain('sourceTier: <code>KIS_SECTOR_INDEX_DAILY_DRYRUN</code>');
  });

  it('2005/2006 EMPTY는 UNRESOLVED_EMPTY + marketSignal=false + executionImpact=NONE으로 유지한다', async () => {
    process.env.KIS_SECTOR_INDEX_DAILY_ENABLED = 'true';
    _fetchKisSectorIndexDaily.mockImplementation((iscd: string) => {
      if (iscd === '2005' || iscd === '2006') return Promise.resolve({ ...dailyResult(iscd), series: [] });
      return Promise.resolve(dailyResult(iscd));
    });

    const report = await mod.fetchKisSectorIndexRowsDryRun(1000);
    const failed = report.rows.filter((row) => row.iscd === '2005' || row.iscd === '2006');
    expect(failed).toHaveLength(2);
    for (const row of failed) {
      expect(row.errorClass).toBe('UNRESOLVED_EMPTY');
      expect(row.providerIssue).toBe(false);
      expect(row.marketSignal).toBe(false);
      expect(row.verificationAction).toBe('VERIFY_WITH_IDXCODE_MST_BEFORE_L4_WIRING');
    }
    expect(report.executionImpact).toBe('NONE');
    expect(report.marketSignal).toBe(false);
  });

});
