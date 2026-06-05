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
  // seed 4452bd3 후 trancheExecutor LIVE 주문이 submitBuyOrder 헬퍼(kisClient 단일 통로)로
  // 이관됨 — import-time 해석을 위해 stub 추가 (본 테스트는 호출하지 않음).
  submitBuyOrder:       vi.fn(async () => ({ kind: 'SUBMITTED', ordNo: 'TEST-ORD' })),
  placeKisSellOrder:    vi.fn(async () => ({ ordNo: null, placed: false, outcome: 'SHADOW_ONLY' })),
}));

vi.mock('../persistence/watchlistRepo.js', () => ({
  loadWatchlist: vi.fn(() => []),
}));

// seed 4452bd3 후 import 그래프 확장(trancheExecutor→reserveSell→shadowTradeRepo)으로
// loadShadowTrades 외 export 도 import-time 해석 필요 — importOriginal spread 로 보강하되
// 본 테스트가 의존하는 loadShadowTrades 만 stub override.
vi.mock('../persistence/shadowTradeRepo.js', async () => {
  const actual = await vi.importActual<any>('../persistence/shadowTradeRepo.js');
  return { ...actual, loadShadowTrades: vi.fn(() => []) };
});

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
  assignSection: vi.fn((entry: { section?: string }) => entry.section ?? 'MOMENTUM'),
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

// import 그래프 확장으로 getRegimeDiagnostics 등 추가 export 가 import-time 필요.
// getLiveRegime 만 R3_NEUTRAL 고정 override, 나머지(getRegimeDiagnostics 등)는 실 구현
// 사용(importOriginal spread) — diagnostics 가 marketStateResolver 에서 실제로 소비되므로
// 임의 stub 은 형상 불일치(activeR6Triggers 등) 유발.
vi.mock('./regimeBridge.js', async () => {
  const actual = await vi.importActual<any>('./regimeBridge.js');
  return { ...actual, getLiveRegime: vi.fn(() => 'R3_NEUTRAL') };
});

// ADR-0531: dryRunScanner 는 resolveCanonicalRegimeLevel(macroState) → REGIME_CONFIGS[regime]
// 로 레짐 설정을 조회한다. macroState=null 일 때 canonical resolver 는 marketState 의
// EffectiveMarketRegime('R3_NORMAL' 등 — RegimeLevel 보다 넓은 타입)을 그대로 캐스팅해
// 내보내므로, REGIME_CONFIGS 에 없는 키가 흘러들 수 있다. 본 테스트의 검증 대상은
// SHADOW/LIVE 계좌 격리(fetchAccountBalance vs computeShadowAccount)이므로, 레짐 plumbing 은
// 실제 config 키(R4_NEUTRAL)로 결정화한다. REGIME_CONFIGS 는 실 구현을 사용해 kellyMultiplier/
// maxPositions/stopLoss 형상이 정확하게 유지되도록 한다(임의 partial stub 금지).
vi.mock('./regime/canonicalRegimeAccess.js', () => ({
  resolveCanonicalRegimeLevel: vi.fn(() => 'R4_NEUTRAL'),
  isCanonicalR6Defense: vi.fn(() => false),
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
import { loadWatchlist } from '../persistence/watchlistRepo.js';

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

  it('실제 scanner처럼 MOMENTUM 후보도 shadow dry-run 평가 대상에 포함한다', async () => {
    process.env.AUTO_TRADE_MODE = 'SHADOW';
    vi.mocked(loadWatchlist).mockReturnValueOnce([
      {
        code: '005930',
        name: 'SAMSUNG',
        entryPrice: 75_000,
        stopLoss: 71_000,
        targetPrice: 84_000,
        addedAt: '2026-05-04T00:00:00.000Z',
        addedBy: 'AUTO',
        section: 'MOMENTUM',
        gateScore: 8,
      },
    ]);

    const result = await runDryRunScan();

    expect(result.totalCandidates).toBe(1);
    expect(result.results[0]?.stockCode).toBe('005930');
    expect(result.results[0]?.blockedBy).toBe('PRICE_FETCH_FAIL');
  });
});
