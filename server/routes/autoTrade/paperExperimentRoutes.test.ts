// @responsibility Verify paper experiment API behavior.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  view: vi.fn(), paperScan: vi.fn(), publicScan: vi.fn(), mode: 'SHADOW',
  legacyRead: vi.fn(), legacySave: vi.fn(), brokerQuote: vi.fn(), reconcile: vi.fn(),
}));
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
vi.mock('../../trading/dryRunScanner.js', () => ({ runDryRunScan: vi.fn() }));
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
    await handler(shadowRouter, 'get', '/shadow/experiments')({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(view);
    expect(mocks.legacyRead).not.toHaveBeenCalled();
    expect(mocks.legacySave).not.toHaveBeenCalled();
    expect(mocks.brokerQuote).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
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
    await handler(shadowRouter, 'get', '/shadow/experiments')({}, res);
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

  it.each(['LIVE', 'PAPER'])('retains the existing automation guard in %s mode', async mode => {
    mocks.mode = mode;
    const res = response();
    await handler(screenerRouter, 'post', '/auto-trade/scan')({}, res);
    expect(res.statusCode).toBe(403);
    expect(mocks.publicScan).not.toHaveBeenCalled();
    expect(mocks.paperScan).not.toHaveBeenCalled();
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
