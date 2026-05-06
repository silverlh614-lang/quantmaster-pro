/**
 * @responsibility scanCronForceMarket 회귀 테스트
 *
 * 검증:
 *   - SCHEDULE_CATALOG 에 06:00 global_scan_agent 항목 등록
 *   - 시간대 게이트 차단 가능성 있는 스캔 cron 의 콜백이 withForcedMarket() 으로
 *     wrap 되어 호출 시 시간대 게이트가 강제 통과됨
 *   - ADR-0403: us_premarket_scan / us_postmarket_scan 은 KR runAutoSignalScan() 을
 *     호출하지 않고 global diagnostics 만 실행한다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MockCron = [string, string, string, () => Promise<unknown> | unknown, unknown];

const _scheduledJob = vi.fn<(...args: MockCron) => unknown>();
const _withForcedMarket = vi.fn((fn: () => Promise<unknown>): Promise<unknown> => fn());

const _runStage1 = vi.fn(async (): Promise<void> => undefined);
const _runStage2_3 = vi.fn(async (): Promise<void> => undefined);
const _runAutoSignal = vi.fn(async (): Promise<void> => undefined);
const _runGlobalScan = vi.fn(async (): Promise<void> => undefined);
const _runAdrGap = vi.fn(async (): Promise<void> => undefined);
const _runSectorEtf = vi.fn(async (): Promise<void> => undefined);
const _sendNewHigh = vi.fn(async (): Promise<void> => undefined);

vi.mock('./scheduleGuard.js', () => ({
  scheduledJob: (...args: MockCron) => _scheduledJob(...args),
}));

vi.mock('../utils/forceMarketGuard.js', () => ({
  withForcedMarket: <T>(fn: () => Promise<T>): Promise<T> =>
    _withForcedMarket(fn as () => Promise<unknown>) as Promise<T>,
  isForcedMarketActive: () => false,
}));

vi.mock('../screener/universeScanner.js', () => ({
  runStage1PreScreening: _runStage1,
  runStage2_3FinalScreening: _runStage2_3,
}));

vi.mock('../screener/watchlistManager.js', () => ({ cleanupWatchlist: vi.fn() }));
vi.mock('../screener/dynamicUniverseExpander.js', () => ({ runDynamicUniverseExpansion: vi.fn() }));
vi.mock('../trading/signalScanner.js', () => ({ runAutoSignalScan: _runAutoSignal }));
vi.mock('../alerts/globalScanAgent.js', () => ({ runGlobalScanAgent: _runGlobalScan }));
vi.mock('../alerts/supplyChainAgent.js', () => ({ runSupplyChainScan: vi.fn() }));
vi.mock('../learning/newsSupplyLogger.js', () => ({ trackPendingRecords: vi.fn() }));
vi.mock('../persistence/macroStateRepo.js', () => ({ loadMacroState: () => null }));
vi.mock('../trading/regimeBridge.js', () => ({ getLiveRegime: () => 'R3_NEUTRAL' }));

vi.mock('../alerts/dartPoller.js', () => ({ fastDartCheck: vi.fn(), pollDartDisclosures: vi.fn() }));
vi.mock('../alerts/bearRegimeAlert.js', () => ({ pollBearRegime: vi.fn() }));
vi.mock('../alerts/ipsAlert.js', () => ({ pollIpsAlert: vi.fn() }));
vi.mock('../alerts/mhsAlert.js', () => ({ pollMhsMorningAlert: vi.fn() }));
vi.mock('../alerts/adrGapCalculator.js', () => ({ runAdrGapScan: _runAdrGap }));
vi.mock('../alerts/preMarketSignal.js', () => ({ runPreMarketSignal: vi.fn() }));
vi.mock('../alerts/dxyMonitor.js', () => ({ runDxyMonitor: vi.fn(), runDxyIntradayMonitor: vi.fn() }));
vi.mock('../alerts/sectorEtfMomentum.js', () => ({ runSectorEtfMomentumScan: _runSectorEtf }));
vi.mock('../alerts/intradayYieldTicker.js', () => ({ tickIntradayYield: vi.fn() }));
vi.mock('../alerts/ackTracker.js', () => ({ sweepPendingAcks: vi.fn() }));
vi.mock('../alerts/foreignFlowLeadingAlert.js', () => ({ checkForeignFlowLeadingAlert: vi.fn() }));
vi.mock('../trading/holidayResumeAlert.js', () => ({ runHolidayResumeAlert: vi.fn() }));
vi.mock('../alerts/macroDigestReport.js', () => ({ runMacroDigest: vi.fn() }));
vi.mock('../alerts/weeklySelfCritiqueReport.js', () => ({ runWeeklySelfCritique: vi.fn() }));

vi.mock('../alerts/reportGenerator.js', () => ({
  generateWeeklyReport: vi.fn(),
  sendIntradayCheckIn: vi.fn(),
  sendIntradayMarketReport: vi.fn(),
  sendPostMarketReport: vi.fn(),
  sendPreMarketReport: vi.fn(),
  sendWatchlistBriefing: vi.fn(),
}));
vi.mock('../trading/marketDataRefresh.js', () => ({ refreshMarketRegimeVars: vi.fn() }));
vi.mock('../trading/fomcCalendar.js', () => ({ checkFomcProximityAlert: vi.fn() }));
vi.mock('../alerts/stockPickReporter.js', () => ({ generateDailyPickReport: vi.fn() }));
vi.mock('../clients/kisClient.js', () => ({ resetKisCircuits: vi.fn() }));
vi.mock('../clients/krxOpenApi.js', () => ({ _resetKrxOpenApiBreaker: vi.fn() }));
vi.mock('../alerts/qualityScorecard.js', () => ({ generateQualityScorecard: vi.fn() }));
vi.mock('../alerts/scanReviewReport.js', () => ({ sendScanReviewReport: vi.fn() }));
vi.mock('../alerts/positionMorningCard.js', () => ({ sendPositionMorningCard: vi.fn() }));
vi.mock('../alerts/weeklyConditionScorecard.js', () => ({ sendWeeklyConditionScorecard: vi.fn() }));
vi.mock('../alerts/sectorCycleDashboard.js', () => ({ sendSectorCycleDashboard: vi.fn() }));
vi.mock('../alerts/newHighMomentumScanner.js', () => ({ sendNewHighMomentumScan: _sendNewHigh }));
vi.mock('../alerts/weeklyDeepAnalysis.js', () => ({ sendWeeklyDeepAnalysis: vi.fn() }));
vi.mock('../alerts/weeklyQuantInsight.js', () => ({ sendWeeklyQuantInsight: vi.fn() }));
vi.mock('../alerts/shadowProgressBriefing.js', () => ({
  sendDailyShadowProgress: vi.fn(),
  sendSampleStallAlertIfNeeded: vi.fn(),
}));
vi.mock('../alerts/weeklyIntegrityReport.js', () => ({ sendWeeklyIntegrityReport: vi.fn() }));
vi.mock('../alerts/weeklyHygieneAudit.js', () => ({ sendWeeklyHygieneAudit: vi.fn() }));

beforeEach(() => {
  _scheduledJob.mockClear();
  _withForcedMarket.mockClear();
  _runStage1.mockClear();
  _runStage2_3.mockClear();
  _runAutoSignal.mockClear();
  _runGlobalScan.mockClear();
  _runAdrGap.mockClear();
  _runSectorEtf.mockClear();
  _sendNewHigh.mockClear();
});

afterEach(() => {
  vi.resetModules();
});

function findCallback(jobName: string): () => Promise<unknown> | unknown {
  const call = _scheduledJob.mock.calls.find((c) => c[2] === jobName);
  if (!call) throw new Error(`scheduledJob('${jobName}', ...) 미등록`);
  return call[3];
}

describe('SCHEDULE_CATALOG — 06:00 global_scan_agent 항목 등록', () => {
  it('카탈로그에 06:00 KST global_scan_agent 항목이 정확히 1건 존재', async () => {
    const { SCHEDULE_CATALOG } = await import('./scheduleCatalog.js');
    const entries = SCHEDULE_CATALOG.filter((e) => e.jobName === 'global_scan_agent');
    expect(entries).toHaveLength(1);
    expect(entries[0].timeKst).toBe('06:00');
    expect(entries[0].group).toBe('screener');
    expect(entries[0].label).toContain('글로벌 스캔');
  });
});

describe('screenerJobs — 스캔 cron force-market 격리', () => {
  beforeEach(async () => {
    const { registerScreenerJobs } = await import('./screenerJobs.js');
    registerScreenerJobs();
  });

  it('stage1_pre_screening 콜백 호출 시 withForcedMarket + runStage1PreScreening', async () => {
    const cb = findCallback('stage1_pre_screening');
    await cb();
    expect(_withForcedMarket).toHaveBeenCalledOnce();
    expect(_runStage1).toHaveBeenCalledOnce();
  });

  it('stage2_3_final_screening 콜백 호출 시 withForcedMarket + runStage2_3FinalScreening', async () => {
    const cb = findCallback('stage2_3_final_screening');
    await cb();
    expect(_withForcedMarket).toHaveBeenCalledOnce();
    expect(_runStage2_3).toHaveBeenCalledOnce();
  });

  it('us_premarket_scan 콜백 호출 시 global diagnostics만 실행하고 KR runAutoSignalScan은 호출하지 않는다', async () => {
    const cb = findCallback('us_premarket_scan');
    await cb();
    expect(_withForcedMarket).toHaveBeenCalledOnce();
    expect(_runGlobalScan).toHaveBeenCalledOnce();
    expect(_runAutoSignal).not.toHaveBeenCalled();
  });

  it('us_postmarket_scan 콜백 호출 시 global diagnostics만 실행하고 KR runAutoSignalScan은 호출하지 않는다', async () => {
    const cb = findCallback('us_postmarket_scan');
    await cb();
    expect(_withForcedMarket).toHaveBeenCalledOnce();
    expect(_runGlobalScan).toHaveBeenCalledOnce();
    expect(_runAutoSignal).not.toHaveBeenCalled();
  });

  it('global_scan_agent 콜백 호출 시 withForcedMarket + runGlobalScanAgent', async () => {
    const cb = findCallback('global_scan_agent');
    await cb();
    expect(_withForcedMarket).toHaveBeenCalledOnce();
    expect(_runGlobalScan).toHaveBeenCalledOnce();
  });
});

describe('alertJobs — 2 스캔 cron 콜백이 withForcedMarket wrap', () => {
  beforeEach(async () => {
    const { registerAlertJobs } = await import('./alertJobs.js');
    registerAlertJobs();
  });

  it('adr_gap_scan 콜백 호출 시 withForcedMarket + runAdrGapScan', async () => {
    const cb = findCallback('adr_gap_scan');
    await cb();
    expect(_withForcedMarket).toHaveBeenCalledOnce();
    expect(_runAdrGap).toHaveBeenCalledOnce();
  });

  it('sector_etf_momentum 콜백 호출 시 withForcedMarket + runSectorEtfMomentumScan', async () => {
    const cb = findCallback('sector_etf_momentum');
    await cb();
    expect(_withForcedMarket).toHaveBeenCalledOnce();
    expect(_runSectorEtf).toHaveBeenCalledOnce();
  });
});

describe('reportJobs — high_52w_scan 콜백이 withForcedMarket wrap', () => {
  beforeEach(async () => {
    const { registerReportJobs } = await import('./reportJobs.js');
    registerReportJobs();
  });

  it('high_52w_scan 콜백 호출 시 withForcedMarket + sendNewHighMomentumScan', async () => {
    const cb = findCallback('high_52w_scan');
    await cb();
    expect(_withForcedMarket).toHaveBeenCalledOnce();
    expect(_sendNewHigh).toHaveBeenCalledOnce();
  });
});
