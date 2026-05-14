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

function sectorSeriesEnding(days: number, endDate: string, startClose = 100): KisSectorIndexDaily['series'] {
  const end = Date.UTC(Number(endDate.slice(0, 4)), Number(endDate.slice(4, 6)) - 1, Number(endDate.slice(6, 8)));
  return Array.from({ length: days }, (_, idx) => {
    const d = new Date(end - (days - idx - 1) * 24 * 60 * 60 * 1000);
    const baseDate = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    return {
      baseDate,
      close: startClose + idx,
      open: startClose + idx - 0.5,
      high: startClose + idx + 1,
      low: startClose + idx - 1,
      volume: 1000 + idx * 10,
      value: 100000 + idx * 1000,
    };
  });
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

function dailyResultEnding(iscd: string, endDate: string, days = 25): KisSectorIndexDaily {
  return {
    ...dailyResult(iscd, days),
    series: sectorSeriesEnding(days, endDate),
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
      if (iscd === '0021' || iscd === '0029') return Promise.resolve({ ...dailyResult(iscd), series: [] });
      return Promise.resolve(dailyResult(iscd));
    });

    const report = await mod.fetchKisSectorIndexRowsDryRun(1000);
    const section = mod.formatKisSectorIndexDryRunSection(report);

    expect(report.failed).toBe(2);
    for (const row of report.rows.filter((item) => !item.success)) {
      expect(section).toContain(`<code>${row.sectorKey}</code> / ${row.label} / iscd=<code>${row.iscd}</code> / layer=<code>KIS_SECTOR_INDEX_DAILY_DRYRUN</code> / errorClass=<code>${row.errorClass}</code>`);
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
      errorClass: 'EMPTY',
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
      if (iscd === '0021' || iscd === '0029') return Promise.resolve({ ...dailyResult(iscd), series: [] });
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

  it('0021/0029 EMPTY는 safe alias 후보로 분리되어 PENDING_IDXCODE_MST_VERIFY가 된다', async () => {
    process.env.KIS_SECTOR_INDEX_DAILY_ENABLED = 'true';
    _fetchKisSectorIndexDaily.mockImplementation((iscd: string) => {
      if (iscd === '0021' || iscd === '0029') return Promise.resolve({ ...dailyResult(iscd), series: [] });
      return Promise.resolve(dailyResult(iscd));
    });

    const report = await mod.fetchKisSectorIndexRowsDryRun(1000);
    const failed = report.rows.filter((row) => row.iscd === '0021' || row.iscd === '0029');
    expect(failed).toHaveLength(2);
    for (const row of failed) {
      expect(row.errorClass).toBe('EMPTY');
      expect(row.errorClass).not.toBe('UNRESOLVED_EMPTY');
      expect(row.verificationStatus).toBe('SAFE_ALIAS_CANDIDATE_FOUND');
      expect(row.resolutionStatus).toBe('PENDING_IDXCODE_MST_VERIFY');
      expect(row.providerIssue).toBe(false);
      expect(row.marketSignal).toBe(false);
      expect(row.verificationAction).toBe('VERIFY_WITH_IDXCODE_MST_BEFORE_L4_WIRING');
    }
    expect(report.executionImpact).toBe('NONE');
    expect(report.marketSignal).toBe(false);
  });

  it('formatter는 UNRESOLVED_EMPTY와 SAFE_ALIAS_CANDIDATE를 동시에 표시하지 않는다', async () => {
    process.env.KIS_SECTOR_INDEX_DAILY_ENABLED = 'true';
    _fetchKisSectorIndexDaily.mockImplementation((iscd: string) => {
      if (iscd === '0029') return Promise.resolve({ ...dailyResult(iscd), series: [] });
      return Promise.resolve(dailyResult(iscd));
    });

    const report = await mod.fetchKisSectorIndexRowsDryRun(1000);
    const section = mod.formatKisSectorIndexDryRunSection(report);

    expect(section).not.toContain('errorClass=<code>UNRESOLVED_EMPTY</code> / verification=<code>SAFE_ALIAS_CANDIDATE');
    expect(section).toContain('errorClass=<code>EMPTY</code> / verification=<code>SAFE_ALIAS_CANDIDATE_FOUND</code> / resolutionStatus=<code>PENDING_IDXCODE_MST_VERIFY</code>');
  });

  it('idxcode master alias candidates require endpoint compatibility before VERIFIED', async () => {
    const verified = await mod.verifySectorIndexCodeWithIdxMaster({
      sectorKey: 'FINANCE',
      sectorNameKo: '금융',
      currentCandidateIscd: '2006',
      aliasCandidates: ['금융', '은행'],
    }, {
      nowMs: Date.UTC(2026, 4, 14),
      masterRows: [
        { iscd: '2006', koreanName: '금융', englishKey: 'FINANCE', aliases: ['금융'] },
        { iscd: '2106', koreanName: '은행', englishKey: 'BANK', aliases: ['은행'] },
      ],
      endpointFetcher: async (iscd) => iscd === '2106' ? dailyResultEnding(iscd, '20260514') : { ...dailyResult(iscd), series: [] },
    });

    expect(verified).toMatchObject({
      verification: 'VERIFIED',
      resolutionStatus: 'IDXCODE_MST_VERIFIED',
      verifiedIscd: '2106',
      marketSignal: false,
      executionImpact: 'NONE',
    });
    expect(verified.candidatesTried[0]).toMatchObject({ iscd: '2006', compatible: false });
    expect(verified.candidatesTried.at(-1)).toMatchObject({
      iscd: '2106',
      endpointRows: 25,
      latestDate: '20260514',
      return5dAvailable: true,
      return20dAvailable: true,
      compatible: true,
    });
  });

  it('rows/latest/return/index value failures are not VERIFIED', async () => {
    const base = {
      sectorKey: 'IT_INTERNET',
      sectorNameKo: '인터넷/플랫폼',
      currentCandidateIscd: '2005',
      aliasCandidates: ['인터넷', '플랫폼'],
    };
    const masterRows = [{ iscd: '2005', koreanName: '인터넷/플랫폼', englishKey: 'IT_INTERNET', aliases: ['인터넷', '플랫폼'] }];
    const nowMs = Date.UTC(2026, 4, 14);

    const shortRows = await mod.verifySectorIndexCodeWithIdxMaster(base, {
      nowMs,
      masterRows,
      endpointFetcher: async (iscd) => dailyResultEnding(iscd, '20260514', 19),
    });
    expect(shortRows.verification).not.toBe('VERIFIED');
    expect(shortRows.candidatesTried[0]).toMatchObject({ compatible: false, reason: 'ROWS_LT_20_19' });

    const stale = await mod.verifySectorIndexCodeWithIdxMaster(base, {
      nowMs,
      masterRows,
      endpointFetcher: async (iscd) => dailyResultEnding(iscd, '20260430', 25),
    });
    expect(stale.verification).not.toBe('VERIFIED');
    expect(stale.candidatesTried[0]).toMatchObject({ compatible: false, reason: 'LATEST_DATE_STALE' });

    const badValues = await mod.verifySectorIndexCodeWithIdxMaster(base, {
      nowMs,
      masterRows,
      endpointFetcher: async (iscd) => ({
        ...dailyResultEnding(iscd, '20260514', 25),
        series: sectorSeriesEnding(25, '20260514', 0).map((row) => ({ ...row, close: 0 })),
      }),
    });
    expect(badValues.verification).not.toBe('VERIFIED');
    expect(badValues.candidatesTried[0]).toMatchObject({ compatible: false, reason: 'ROWS_LT_20_0' });
  });

  it('probe-verified FINANCE and IT_INTERNET keep dry-run at 12/12 while safety flags stay closed', async () => {
    process.env.KIS_SECTOR_INDEX_DAILY_ENABLED = 'true';
    _fetchKisSectorIndexDaily.mockImplementation((iscd: string) => {
      return Promise.resolve(dailyResultEnding(iscd, '20260514'));
    });

    const report = await mod.fetchKisSectorIndexRowsDryRun(Date.UTC(2026, 4, 14));
    const section = mod.formatKisSectorIndexDryRunSection(report);

    expect(report).toMatchObject({
      attempted: 12,
      succeeded: 12,
      failed: 0,
      candidateCoverage: 1,
      promotionStage: 'OBSERVE',
      strongBuyAllowed: false,
      sectorBoostAllowed: false,
      executionImpact: 'NONE',
      officialBenchmark: false,
      marketSignal: false,
      providerIssue: false,
    });
    expect(report.rows.find((row) => row.sectorKey === 'FINANCE')).toMatchObject({
      iscd: '0021',
      verificationStatus: 'VERIFIED',
      resolutionStatus: 'NONE',
    });
    expect(report.rows.find((row) => row.sectorKey === 'IT_INTERNET')).toMatchObject({
      iscd: '0029',
      verificationStatus: 'VERIFIED',
      resolutionStatus: 'NONE',
    });
    expect(section).toContain('nextAction: <code>OBSERVE_20D_THEN_PROMOTION_AUDIT</code>');
  });

});
