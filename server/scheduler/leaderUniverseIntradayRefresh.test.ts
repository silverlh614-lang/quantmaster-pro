/**
 * @responsibility ADR-0639 주도주 장중 갱신 cron 등록·flag 단락·카탈로그 stagger 회귀 검증
 *
 * 검증:
 *   - leader_universe_intraday_refresh 가 TRADING_DAY_ONLY + cronExpr '32 0-6 * * 1-5' 로 등록
 *   - flag OFF → 콜백 진입 시 runLeaderUniverseDailyRefresh 미호출 (byte-identical)
 *   - flag ON  → runLeaderUniverseDailyRefresh 1회 호출
 *   - SCHEDULE_CATALOG 항목 존재 + daily 슬롯과 분 stagger 충돌 없음
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MockCron = [string, string, string, () => Promise<unknown> | unknown, unknown];

const { _scheduledJob, _runLeaderRefresh, _isLeaderEnabled } = vi.hoisted(() => ({
  _scheduledJob: vi.fn(),
  _runLeaderRefresh: vi.fn(async (): Promise<void> => undefined),
  _isLeaderEnabled: vi.fn<() => boolean>(() => false),
}));

vi.mock('./scheduleGuard.js', () => ({
  scheduledJob: (...args: MockCron) => _scheduledJob(...args),
}));

vi.mock('../utils/forceMarketGuard.js', () => ({
  withForcedMarket: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  isForcedMarketActive: () => false,
}));

vi.mock('../screener/universeScanner.js', () => ({
  runStage1PreScreening: vi.fn(),
  runStage2_3FinalScreening: vi.fn(),
}));
vi.mock('../screener/watchlistManager.js', () => ({ cleanupWatchlist: vi.fn() }));
vi.mock('../screener/dynamicUniverseExpander.js', () => ({
  runDynamicUniverseExpansion: vi.fn(),
  runLeaderUniverseDailyRefresh: _runLeaderRefresh,
  isLeaderUniverseDailyRefreshEnabled: () => _isLeaderEnabled(),
}));
vi.mock('../alerts/globalScanAgent.js', () => ({ runGlobalScanAgent: vi.fn() }));
vi.mock('../alerts/supplyChainAgent.js', () => ({ runSupplyChainScan: vi.fn() }));
vi.mock('../learning/newsSupplyLogger.js', () => ({ trackPendingRecords: vi.fn() }));
vi.mock('../persistence/macroStateRepo.js', () => ({ loadMacroState: () => null }));
vi.mock('../trading/regime/canonicalRegimeAccess.js', () => ({
  resolveCanonicalRegimeLevel: () => 'R3_NEUTRAL',
  isCanonicalR6Defense: () => false,
}));
// scheduleCatalog 모듈 로드 시 디스크 JobMetrics 영속 I/O 를 차단 — 테스트 결정성 확보.
vi.mock('../persistence/jobMetricsRepo.js', () => ({
  loadJobMetrics: () => ({}),
  saveJobMetrics: vi.fn(),
  __resetJobMetricsFileForTests: vi.fn(),
}));

const INTRADAY_JOB = 'leader_universe_intraday_refresh';

function findCall(jobName: string): MockCron {
  const call = _scheduledJob.mock.calls.find((c) => c[2] === jobName);
  if (!call) throw new Error(`scheduledJob('${jobName}', ...) 미등록`);
  return call as MockCron;
}

beforeEach(() => {
  _scheduledJob.mockClear();
  _runLeaderRefresh.mockClear();
  _isLeaderEnabled.mockReset();
  _isLeaderEnabled.mockReturnValue(false);
});

afterEach(() => {
  vi.resetModules();
});

describe('ADR-0639 — leader_universe_intraday_refresh 등록', () => {
  beforeEach(async () => {
    const { registerScreenerJobs } = await import('./screenerJobs.js');
    registerScreenerJobs();
  });

  it('TRADING_DAY_ONLY + cronExpr 32 0-6 * * 1-5 + UTC timezone 으로 정확히 1건 등록', () => {
    const calls = _scheduledJob.mock.calls.filter((c) => c[2] === INTRADAY_JOB);
    expect(calls).toHaveLength(1);
    const [cronExpr, mode, , , opts] = findCall(INTRADAY_JOB);
    expect(cronExpr).toBe('32 0-6 * * 1-5');
    expect(mode).toBe('TRADING_DAY_ONLY');
    expect(opts).toEqual({ timezone: 'UTC' });
  });

  it('flag OFF → 콜백 진입 시 runLeaderUniverseDailyRefresh 미호출 (byte-identical)', async () => {
    _isLeaderEnabled.mockReturnValue(false);
    const [, , , cb] = findCall(INTRADAY_JOB);
    await cb();
    expect(_runLeaderRefresh).not.toHaveBeenCalled();
  });

  it('flag ON → runLeaderUniverseDailyRefresh 1회 호출', async () => {
    _isLeaderEnabled.mockReturnValue(true);
    const [, , , cb] = findCall(INTRADAY_JOB);
    await cb();
    expect(_runLeaderRefresh).toHaveBeenCalledOnce();
  });

  it('daily(10 23 * * 0-4) 와 동일 flag 재사용 — intraday cron 은 별도 분(32) stagger', () => {
    const [dailyCron] = findCall('leader_universe_daily_refresh');
    const [intradayCron] = findCall(INTRADAY_JOB);
    expect(dailyCron).toBe('10 23 * * 0-4');
    expect(intradayCron).toBe('32 0-6 * * 1-5');
    // 분이 서로 달라 동시각 슬롯 혼잡 회피
    expect(dailyCron.split(' ')[0]).not.toBe(intradayCron.split(' ')[0]);
  });
});

describe('ADR-0639 — SCHEDULE_CATALOG 항목 + stagger 충돌 점검', () => {
  it('카탈로그에 leader_universe_intraday_refresh 항목이 정확히 1건 (screener·무음)', async () => {
    const { SCHEDULE_CATALOG } = await import('./scheduleCatalog.js');
    const entries = SCHEDULE_CATALOG.filter((e) => e.jobName === INTRADAY_JOB);
    expect(entries).toHaveLength(1);
    expect(entries[0].group).toBe('screener');
    expect(entries[0].silentWhen).toBeTruthy();
    expect(entries[0].label).toContain('ADR-0639');
  }, 30000);
});
