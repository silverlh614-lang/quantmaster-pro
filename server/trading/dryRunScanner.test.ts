/**
 * dryRunScanner.test.ts — PR-5 #11 follow-up 회귀 가드.
 *
 * SHADOW 모드의 /dryrun 시뮬레이션은 KIS 실/모의 잔고를 호출하지 않고
 * computeShadowAccount 독립 원장만 사용해야 한다 (signalScanner 정합).
 * LIVE 모드는 기존 fetchAccountBalance 경로 유지.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../clients/kisClient.js', () => ({
  fetchCurrentPrice:    vi.fn(async () => 0),
  fetchAccountBalance:  vi.fn(async () => 50_000_000),
}));

vi.mock('../persistence/watchlistRepo.js', () => ({
  loadWatchlist: vi.fn(() => []),
}));

vi.mock('../persistence/shadowTradeRepo.js', () => ({
  loadShadowTrades: vi.fn(() => []),
}));

vi.mock('../persistence/macroStateRepo.js', () => ({
  loadMacroState: vi.fn(() => null),
}));

vi.mock('../persistence/conditionWeightsRepo.js', () => ({
  loadConditionWeights: vi.fn(() => ({})),
}));

vi.mock('../persistence/tradingSettingsRepo.js', () => ({
  loadTradingSettings: vi.fn(() => ({ startingCapital: 100_000_000 })),
}));

vi.mock('../persistence/shadowAccountRepo.js', () => ({
  computeShadowAccount: vi.fn(() => ({
    cashBalance:   75_000_000,
    totalInvested: 25_000_000,
    totalAssets:  100_000_000,
  })),
}));

vi.mock('../screener/watchlistManager.js', () => ({
  computeFocusCodes: vi.fn(() => new Set<string>()),
}));

vi.mock('../screener/stockScreener.js', () => ({
  fetchYahooQuote:        vi.fn(),
  fetchKisQuoteFallback:  vi.fn(),
  enrichQuoteWithKisMTAS: vi.fn(),
  fetchKisIntraday:       vi.fn(),
}));

vi.mock('../quantFilter.js', () => ({
  evaluateServerGate: vi.fn(),
}));

vi.mock('./regimeBridge.js', () => ({
  getLiveRegime: vi.fn(() => 'R3_NEUTRAL'),
}));

vi.mock('../../src/services/quant/regimeEngine.js', () => ({
  REGIME_CONFIGS: {
    R3_NEUTRAL: { kellyMultiplier: 1.0, maxPositions: 5 },
  },
}));

vi.mock('./entryEngine.js', () => ({
  isOpenShadowStatus:        vi.fn(() => false),
  calculateOrderQuantity:    vi.fn(),
  reconcileDayOpen:          vi.fn(),
  evaluateEntryRevalidation: vi.fn(),
  buildStopLossPlan:         vi.fn(),
  getMinGateScore:           vi.fn(() => 5),
  getKstMarketElapsedMinutes: vi.fn(() => 0),
}));

vi.mock('../persistence/blacklistRepo.js', () => ({
  isBlacklisted: vi.fn(() => false),
}));

vi.mock('./riskManager.js', () => ({
  calcRRR:           vi.fn(() => 0),
  RRR_MIN_THRESHOLD: 2,
}));

vi.mock('./vixGating.js', () => ({
  getVixGating: vi.fn(() => ({ noNewEntry: false, kellyMultiplier: 1, reason: '' })),
}));

vi.mock('./fomcCalendar.js', () => ({
  getFomcProximity: vi.fn(() => ({ noNewEntry: false, kellyMultiplier: 1, description: '' })),
}));

vi.mock('./volumeClock.js', () => ({
  checkVolumeClockWindow: vi.fn(() => ({ allowEntry: true, reason: '' })),
}));

vi.mock('../../src/services/quant/sellEngine.js', () => ({
  PROFIT_TARGETS: {},
}));

import { runDryRunScan } from './dryRunScanner.js';
import { fetchAccountBalance } from '../clients/kisClient.js';
import { computeShadowAccount } from '../persistence/shadowAccountRepo.js';

describe('dryRunScanner — PR-5 #11 SHADOW account isolation', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('SHADOW 모드: fetchAccountBalance 미호출 + computeShadowAccount 사용', async () => {
    process.env.AUTO_TRADE_MODE = 'SHADOW';
    delete process.env.AUTO_TRADE_ASSETS;

    const result = await runDryRunScan();

    expect(fetchAccountBalance).not.toHaveBeenCalled();
    expect(computeShadowAccount).toHaveBeenCalledOnce();
    expect(computeShadowAccount).toHaveBeenCalledWith(expect.any(Array), 100_000_000);
    expect(result.dryRun).toBe(true);
  });

  it('SHADOW 모드 + AUTO_TRADE_ASSETS 오버라이드: 환경변수 우선', async () => {
    process.env.AUTO_TRADE_MODE   = 'SHADOW';
    process.env.AUTO_TRADE_ASSETS = '50000000';

    await runDryRunScan();

    expect(fetchAccountBalance).not.toHaveBeenCalled();
    expect(computeShadowAccount).toHaveBeenCalledWith(expect.any(Array), 50_000_000);
  });

  it('LIVE 모드: fetchAccountBalance 호출 + computeShadowAccount 미호출', async () => {
    process.env.AUTO_TRADE_MODE = 'LIVE';
    delete process.env.AUTO_TRADE_ASSETS;

    await runDryRunScan();

    expect(fetchAccountBalance).toHaveBeenCalledOnce();
    expect(computeShadowAccount).not.toHaveBeenCalled();
  });

  it('AUTO_TRADE_MODE 미설정: SHADOW 기본 (fetchAccountBalance 미호출)', async () => {
    delete process.env.AUTO_TRADE_MODE;
    delete process.env.AUTO_TRADE_ASSETS;

    await runDryRunScan();

    expect(fetchAccountBalance).not.toHaveBeenCalled();
    expect(computeShadowAccount).toHaveBeenCalledOnce();
  });
});
