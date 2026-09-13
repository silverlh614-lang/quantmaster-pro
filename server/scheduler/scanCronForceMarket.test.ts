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
const _paperBotTick = vi.hoisted(() => vi.fn(async () => {}));
const _marketInputs = vi.hoisted(() => ({
  refresh: vi.fn(), closes: vi.fn(), save: vi.fn(), ocoConfirm: vi.fn(),
  macro: { mhs: 55, updatedAt: '2026-09-14T00:00:00Z', vix: 18 },
}));
vi.mock('../alerts/paperBot.js', () => ({ runPaperBotTick: _paperBotTick }));

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
vi.mock('../persistence/macroStateRepo.js', () => ({
  loadMacroState: () => ({ ..._marketInputs.macro }), saveMacroState: _marketInputs.save,
}));
vi.mock('../trading/regimeBridge.js', () => ({
  getLiveRegime: () => 'R3_NEUTRAL',
  // mock-drift fix: ADR-0531 canonical 레짐 도입으로 screenerJobs 가 regimeBridge 의
  // getRegimeDiagnostics 까지 transitively 요구. 단순 고정 진단 stub 추가.
  getRegimeDiagnostics: () => ({ rawRegime: 'R3_NEUTRAL' }),
}));
// mock-drift fix: stage2_3 cron 이 resolveCanonicalRegimeLevel(=resolveRegimeSnapshot
// 전체 체인) 경유로 레짐을 구함. 테스트 의도는 고정 레짐(R3_NEUTRAL)이므로 단일
// 접근자를 직접 stub 해 깊은 resolver 체인 의존을 차단한다.
vi.mock('../trading/regime/canonicalRegimeAccess.js', () => ({
  resolveCanonicalRegimeLevel: () => 'R3_NEUTRAL',
  isCanonicalR6Defense: () => false,
}));

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
vi.mock('../trading/marketDataRefresh.js', () => ({
  refreshMarketRegimeVars: _marketInputs.refresh, fetchCloses: _marketInputs.closes,
}));
vi.mock('../trading/ocoConfirmLoop.js', () => ({ pollOcoConfirm: _marketInputs.ocoConfirm }));
vi.mock('../trading/ocoCloseLoop.js', () => ({ cancelAllActiveOco: vi.fn(), pollOcoSurvival: vi.fn() }));
vi.mock('../trading/ocoRecoveryAgent.js', () => ({ runOcoRecoveryRound: vi.fn() }));
vi.mock('../trading/fillMonitor.js', () => ({ SELL_POLL_INTERVAL: 30_000, pollSellFills: vi.fn() }));
vi.mock('../trading/portfolioRiskEngine.js', () => ({ runPortfolioRiskCheck: vi.fn() }));
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
  _marketInputs.refresh.mockReset();
  _marketInputs.closes.mockReset().mockResolvedValue([19, 20]);
  _marketInputs.save.mockReset();
  _marketInputs.ocoConfirm.mockReset();
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

  it('does not register the retired regime/Gate screening stages', () => {
    const names = _scheduledJob.mock.calls.map(call => call[2]);
    expect(names).not.toContain('stage1_pre_screening');
    expect(names).not.toContain('stage2_3_final_screening');
    expect(names).toContain('cleanup_watchlist');
    expect(_runStage1).not.toHaveBeenCalled();
    expect(_runStage2_3).not.toHaveBeenCalled();
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

describe('market-data schedules after retiring regime policies', () => {
  it('keeps DART collection without Bear or IPS regime alerts', async () => {
    const { registerAlertJobs } = await import('./alertJobs.js');
    registerAlertJobs();
    const names = _scheduledJob.mock.calls.map(call => call[2]);
    expect(names).toContain('dart_poll_30min');
    expect(names).toContain('dart_fast_check');
    expect(names).not.toContain('bear_regime');
    expect(names).not.toContain('bear_regime_pre');
    expect(names).not.toContain('ips_alert');
  });

  it('stores observed VIX and preserves execution monitoring without regime alignment', async () => {
    const { registerTradeFlowJobs } = await import('./tradeFlowJobs.js');
    registerTradeFlowJobs();
    const names = _scheduledJob.mock.calls.map(call => call[2]);
    expect(names).toContain('sell_poll_start');
    expect(names).toContain('oco_confirm');
    expect(names).not.toContain('macro_sync_day_open');
    expect(names).not.toContain('macro_sector_alignment');
    await findCallback('market_volatility_open')();
    expect(_marketInputs.closes).toHaveBeenCalledWith('^VIX', '1d');
    expect(_marketInputs.save).toHaveBeenCalledWith({
      ..._marketInputs.macro, vix: 20, updatedAt: expect.any(String),
    });
    await findCallback('oco_confirm')();
    expect(_marketInputs.ocoConfirm).toHaveBeenCalledOnce();
  });

  it('keeps saved volatility when a fresh observation is unavailable', async () => {
    const { refreshMarketVolatility } = await import('../trading/macroSectorSync.js');
    _marketInputs.closes.mockResolvedValueOnce(null);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await refreshMarketVolatility();
      expect(_marketInputs.save).not.toHaveBeenCalled();
      expect(warning).toHaveBeenCalledOnce();
    } finally { warning.mockRestore(); }
  });

  it('reports volatility collection failures to the existing schedule guard', async () => {
    const { refreshMarketVolatility } = await import('../trading/macroSectorSync.js');
    _marketInputs.closes.mockRejectedValueOnce(new Error('provider unavailable'));
    await expect(refreshMarketVolatility()).rejects.toThrow('provider unavailable');
    expect(_marketInputs.save).not.toHaveBeenCalled();
  });
});

describe('reportJobs — current Shadow notifications', () => {
  beforeEach(async () => {
    const { registerReportJobs } = await import('./reportJobs.js');
    registerReportJobs();
  });

  it('replaces report-only scans with one coordinator while keeping internal refresh jobs', async () => {
    const names = _scheduledJob.mock.calls.map(call => call[2]);
    expect(names).toEqual(['paper_bot', 'circuit_auto_reset', 'market_data_refresh_morning', 'market_data_refresh_intraday_ttl', 'market_data_refresh_close', 'hourly_canary']);
    const cb = findCallback('paper_bot');
    await cb();
    expect(_paperBotTick).toHaveBeenCalledOnce();
    expect(_sendNewHigh).not.toHaveBeenCalled();
  });
});
