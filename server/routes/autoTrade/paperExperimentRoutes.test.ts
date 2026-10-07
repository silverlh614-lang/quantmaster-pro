// @responsibility Verify paper experiment API behavior.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  view: vi.fn(), paperScan: vi.fn(), publicScan: vi.fn(), mode: 'SHADOW',
  legacyRead: vi.fn(), legacySave: vi.fn(), brokerQuote: vi.fn(), reconcile: vi.fn(),
  morning: vi.fn(), recommendation: vi.fn(), evaluation: vi.fn(), bot: vi.fn(), financials: vi.fn(),
  accountRead: vi.fn(), accountStart: vi.fn(), accountPause: vi.fn(),
}));
vi.mock('../../trading/paper/paperAccountRuntime.js', () => ({ readVirtualAccount: mocks.accountRead,
  startVirtualAccount: mocks.accountStart, pauseVirtualAccountBuys: mocks.accountPause }));
vi.mock('../../trading/paper/paperEvaluation.js', () => ({ buildPaperEvaluation: mocks.evaluation }));
vi.mock('../../persistence/paperBotRepo.js', () => ({ loadPaperBotState: mocks.bot }));
vi.mock('../../persistence/paperFinancialRepo.js', () => ({ loadPaperFinancialCache: mocks.financials }));
vi.mock('../../alerts/globalNewsRuntime.js', () => ({ getGlobalMorningPreview: mocks.morning }));
vi.mock('../../trading/paper/paperMorningRuntime.js', () => ({ getPaperMorningReview: mocks.recommendation,
  getPaperMorningReviewSafely: () => ({ report: null, results: [], asOf: '2026-09-18T07:00:00.000Z' }) }));
vi.mock('../../trading/paper/paperExperimentRunner.js', () => ({
  getPaperExperimentView: mocks.view, runPaperExperimentScan: mocks.paperScan,
}));
vi.mock('../../trading/signalScanner.js', () => ({ runAutoSignalScan: mocks.publicScan }));
vi.mock('../../state.js', () => ({ getTradingMode: () => mocks.mode }));
vi.mock('../../orchestrator/tradingOrchestrator.js', () => ({ getShadowTrades: mocks.legacyRead }));
vi.mock('../../persistence/shadowTradeRepo.js', () => ({
  loadShadowTrades: mocks.legacyRead, saveShadowTrades: mocks.legacySave,
  getRemainingQty: vi.fn(), appendShadowLog: vi.fn(),
}));
vi.mock('../../persistence/shadowAccountRepo.js', () => ({
  computeShadowAccount: vi.fn(), reconcileShadowQuantities: mocks.reconcile,
}));
vi.mock('../../persistence/tradingSettingsRepo.js', () => ({ loadTradingSettings: vi.fn() }));
vi.mock('../../clients/kisClient.js', () => ({ fetchCurrentPrice: mocks.brokerQuote }));
vi.mock('../../clients/kisStreamClient.js', () => ({ getRealtimePrice: vi.fn() }));
vi.mock('../../screener/sectorMap.js', () => ({ getSectorByCode: vi.fn() }));
vi.mock('../../screener/stockScreener.js', () => ({
  getScreenerCache: vi.fn(), preScreenStocks: vi.fn(), autoPopulateWatchlist: vi.fn(),
}));
vi.mock('../../persistence/watchlistRepo.js', () => ({ loadWatchlist: vi.fn() }));
vi.mock('../../persistence/dartRepo.js', () => ({ getDartAlerts: vi.fn() }));
vi.mock('../../alerts/dartPoller.js', () => ({ pollDartDisclosures: vi.fn() }));

import shadowRouter from './shadowRouter.js';
import screenerRouter from './screenerRouter.js';

interface ResponseStub {
  statusCode: number;
  body: unknown;
  status(code: number): ResponseStub;
  json(body: unknown): ResponseStub;
}
type Handler = (request: Record<string, unknown>, response: ResponseStub) => unknown;
interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Handler }> };
}
function handler(router: unknown, method: string, path: string): Handler {
  const layer = (router as { stack: RouteLayer[] }).stack.find(item =>
    item.route?.path === path && item.route.methods[method]);
  if (!layer?.route) throw new Error(`Missing route: ${method} ${path}`);
  return layer.route.stack[0].handle;
}
function response(): ResponseStub {
  return {
    statusCode: 200, body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

describe('paper experiment API registration', () => {
  it('configures only the isolated virtual account and rejects malformed setup', async () => {
    const config = { initialCash: 10000000, maxPositionPct: 20, includeExploration: false };
    mocks.accountStart.mockReturnValue({ account: { id: 'virtual' } });
    const res = response();
    await handler(shadowRouter, 'post', '/shadow/virtual-account')({ body: config }, res);
    expect(res.statusCode).toBe(201); expect(mocks.accountStart).toHaveBeenCalledWith(config);
    const invalid = response();
    await handler(shadowRouter, 'post', '/shadow/virtual-account')({ body: { ...config, initialCash: -1 } }, invalid);
    expect(invalid.statusCode).toBe(400); expect(mocks.accountStart).toHaveBeenCalledTimes(1);
    mocks.accountStart.mockImplementationOnce(() => { throw new Error('VIRTUAL_ACCOUNT_EXISTS: exists'); });
    const conflict = response();
    await handler(shadowRouter, 'post', '/shadow/virtual-account')({ body: config }, conflict);
    expect(conflict.statusCode).toBe(409);
    expect(mocks.brokerQuote).not.toHaveBeenCalled(); expect(mocks.paperScan).not.toHaveBeenCalled(); expect(mocks.legacySave).not.toHaveBeenCalled();
  });
  it('exposes account read failures and validates pause payloads', async () => {
    mocks.accountRead.mockImplementationOnce(() => { throw new Error('corrupt ledger'); });
    const failed = response(); await handler(shadowRouter, 'get', '/shadow/virtual-account')({}, failed);
    expect(failed.statusCode).toBe(500); expect(failed.body).toEqual({ error: 'corrupt ledger' });
    const invalid = response();
    await handler(shadowRouter, 'patch', '/shadow/virtual-account/buys')({ body: { id: 'virtual', paused: 'false' } }, invalid);
    expect(invalid.statusCode).toBe(400); expect(mocks.accountPause).not.toHaveBeenCalled();
  });
  it('returns older strategy records beyond the 200-trade preview without running collection', async () => {
    const trades = Array.from({ length: 205 }, (_, index) => ({ id: `trade-${index}` }));
    mocks.view.mockImplementation((full: boolean) => ({ strategy: { totalCount: trades.length, trades: full ? trades : trades.slice(-200) } }));
    const res = response();
    await handler(shadowRouter, 'get', '/shadow/experiments')({ query: { section: 'strategy' } }, res);
    expect(mocks.view).toHaveBeenCalledWith(true);
    expect(res.body).toEqual({ totalCount: 205, trades });
    expect(mocks.paperScan).not.toHaveBeenCalled();
    expect(mocks.brokerQuote).not.toHaveBeenCalled();
    const preview = response();
    await handler(shadowRouter, 'get', '/shadow/experiments')({ query: {} }, preview);
    expect(mocks.view).toHaveBeenLastCalledWith(false);
  });
  it('reads an archived morning recommendation without scanning or placing orders', async () => {
    mocks.recommendation.mockReturnValue({ report: { id: 'paper:recommendation:2026-09-18', message: '동결된 추천' }, results: [] });
    const res = response();
    await handler(shadowRouter, 'get', '/shadow/morning-recommendation')({ query: { date: '2026-09-18' } }, res);
    expect(mocks.recommendation).toHaveBeenCalledWith('2026-09-18');
    expect(res.body).toMatchObject({ report: { message: '동결된 추천' } });
    expect(mocks.paperScan).not.toHaveBeenCalled();
    expect(mocks.brokerQuote).not.toHaveBeenCalled();
    const bad = response();
    await handler(shadowRouter, 'get', '/shadow/morning-recommendation')({ query: { date: '../private' } }, bad);
    expect(bad.statusCode).toBe(400);
    expect(mocks.recommendation).toHaveBeenCalledTimes(1);
  });
  it('evaluates complete ledgers and keeps optional source failures visible', async () => {
    mocks.view.mockReturnValue({ totalCount: 4248 });
    mocks.bot.mockImplementationOnce(() => { throw new Error('unreadable'); });
    mocks.financials.mockReturnValue({ schemaVersion: 1, records: {} });
    mocks.evaluation.mockReturnValue({ baseline: { count: 4248 } });
    const res = response(); await handler(shadowRouter, 'get', '/shadow/evaluation')({}, res);
    expect(mocks.view).toHaveBeenCalledWith(true);
    expect(mocks.evaluation).toHaveBeenCalledWith({ totalCount: 4248 }, null, { schemaVersion: 1, records: {} }, expect.any(Date));
    expect(res.body).toEqual({ baseline: { count: 4248 }, issues: ['알림 원장: Error'] });
    expect(mocks.brokerQuote).not.toHaveBeenCalled();
  });
  it('previews the stored morning brief without collecting or sending', async () => {
    mocks.morning.mockReturnValue({ ready: true, message: '해외 뉴스·국내 연관주', items: [] });
    const res = response();
    await handler(shadowRouter, 'get', '/shadow/morning-report')({}, res);
    expect(res.body).toEqual({ ready: true, message: '해외 뉴스·국내 연관주', items: [] });
    expect(mocks.brokerQuote).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mode = 'SHADOW';
    vi.stubEnv('AUTO_TRADE_ENABLED', 'false');
    mocks.publicScan.mockResolvedValue({});
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('returns the new view without consulting legacy trade or quote services', async () => {
    const view = { mode: 'SHADOW', totalCount: 0, outcomes: [{ horizon: 1, count: 0, meanNetReturnPct: null }] };
    mocks.view.mockReturnValue(view);
    const res = response();
    await handler(shadowRouter, 'get', '/shadow/experiments')({ query: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(view);
    expect(mocks.legacyRead).not.toHaveBeenCalled();
    expect(mocks.legacySave).not.toHaveBeenCalled();
    expect(mocks.brokerQuote).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
  it('previews the complete closing report without scanning, changing records or sending a message', async () => {
    mocks.view.mockReturnValue({ mode: 'SHADOW', totalCount: 0, experiments: [], lastRun: null, outcomes: [] });
    const res = response();
    await handler(shadowRouter, 'get', '/shadow/close-report')({}, res);
    expect(res.statusCode).toBe(200);
    expect(mocks.view).toHaveBeenCalledWith(true);
    expect(res.body).toMatchObject({ sourceAsOf: null, message: expect.stringContaining('Shadow 마감 요약') });
    expect(mocks.paperScan).not.toHaveBeenCalled();
    expect(mocks.legacySave).not.toHaveBeenCalled();
    expect(mocks.brokerQuote).not.toHaveBeenCalled();
  });

  it('runs explicit paper observations with broker automation disabled', async () => {
    const scan = { snapshotId: 'paper-1', openedCount: 1, missingPriceCount: 0 };
    mocks.paperScan.mockResolvedValue(scan);
    const res = response();
    await handler(shadowRouter, 'post', '/shadow/experiments/scan')({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(scan);
    expect(mocks.paperScan).toHaveBeenCalledOnce();
    expect(mocks.publicScan).not.toHaveBeenCalled();
    expect(mocks.legacySave).not.toHaveBeenCalled();
  });

  it('surfaces unreadable records instead of returning an empty success', async () => {
    mocks.view.mockImplementation(() => { throw new Error('PAPER_LEDGER_UNREADABLE'); });
    const res = response();
    await handler(shadowRouter, 'get', '/shadow/experiments')({ query: {} }, res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'PAPER_LEDGER_UNREADABLE' });
  });

  it('surfaces persistence failure instead of claiming a successful scan', async () => {
    mocks.paperScan.mockRejectedValue(new Error('PAPER_LEDGER_WRITE_FAILED'));
    const res = response();
    await handler(shadowRouter, 'post', '/shadow/experiments/scan')({}, res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'PAPER_LEDGER_WRITE_FAILED' });
  });

  it('allows the public manual scan in Shadow without enabling broker automation', async () => {
    const res = response();
    await handler(screenerRouter, 'post', '/auto-trade/scan')({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    expect(mocks.publicScan).toHaveBeenCalledOnce();
  });

  it.each(['LIVE', 'PAPER'])('continues observation scans in %s mode with broker automation disabled', async mode => {
    mocks.mode = mode;
    const res = response();
    await handler(screenerRouter, 'post', '/auto-trade/scan')({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    expect(mocks.publicScan).toHaveBeenCalledOnce();
    expect(mocks.paperScan).not.toHaveBeenCalled();
    expect(mocks.legacySave).not.toHaveBeenCalled();
    expect(mocks.brokerQuote).not.toHaveBeenCalled();
  });

  it('forwards an enabled broker-mode manual scan to the public dispatcher', async () => {
    mocks.mode = 'PAPER';
    vi.stubEnv('AUTO_TRADE_ENABLED', 'true');
    const res = response();
    await handler(screenerRouter, 'post', '/auto-trade/scan')({}, res);
    expect(res.statusCode).toBe(200);
    expect(mocks.publicScan).toHaveBeenCalledOnce();
  });
});
