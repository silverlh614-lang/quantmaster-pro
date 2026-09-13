// @responsibility Verify pending tranche orders use existing plans and actual cash limits without regime or Kelly decisions.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  saved: '[]', trades: [] as Array<Record<string, unknown>>,
  balance: vi.fn(async (): Promise<number | null> => 25000),
  price: vi.fn(async (): Promise<number | null> => 10000),
  submit: vi.fn(async (_input: unknown) => ({ kind: 'SUBMITTED', ordNo: 'order-test' })),
  approval: vi.fn(async (_input: unknown) => 'APPROVE'),
  alert: vi.fn(async () => undefined), addOrder: vi.fn(), mode: vi.fn(() => 'LIVE'),
  regime: vi.fn(() => { throw new Error('REGIME_RETIRED'); }),
  shadowAccount: vi.fn((_trades: Array<Record<string, unknown>>, _capital: number) => ({ totalAssets: 1000000, cashBalance: 25000 })),
  exposure: vi.fn((capital: number, cash: number, _trades: Array<Record<string, unknown>>) => Math.max(0, capital - cash)),
}));
vi.mock('fs', () => ({ default: {
  existsSync: () => true, readFileSync: () => mocks.saved,
  writeFileSync: (_path: string, content: string) => { mocks.saved = content; },
} }));
vi.mock('../persistence/paths.js', () => ({ TRANCHE_FILE: '/tranches-test.json', ensureDataDir: () => undefined }));
vi.mock('../persistence/conditionWeightsRepo.js', () => ({ loadConditionWeights: () => ({}) }));
vi.mock('../quantFilter.js', () => ({ evaluateServerGate: () => ({ signalType: 'BUY', gateScore: 6 }) }));
vi.mock('../clients/kisClient.js', () => ({ submitBuyOrder: mocks.submit, fetchCurrentPrice: mocks.price, fetchAccountBalance: mocks.balance }));
vi.mock('../alerts/telegramClient.js', () => ({ sendTelegramAlert: mocks.alert }));
vi.mock('./fillMonitor.js', () => ({ fillMonitor: { addOrder: mocks.addOrder } }));
vi.mock('../screener/adapters/technicalQuoteRouter.js', () => ({ fetchTechnicalQuoteByCode: async () => null }));
vi.mock('../persistence/shadowTradeRepo.js', () => ({ loadShadowTrades: () => mocks.trades }));
vi.mock('../persistence/tradingSettingsRepo.js', () => ({ loadTradingSettings: () => ({ startingCapital: 1000000, positionLimit: { enabled: true, maxSingleStockPercent: 15 } }) }));
vi.mock('../persistence/shadowAccountRepo.js', () => ({ computeShadowAccount: mocks.shadowAccount }));
vi.mock('../state.js', () => ({ getTradingMode: mocks.mode }));
vi.mock('./sizing/currentEquityExposure.js', () => ({ resolveCurrentEquityExposure: mocks.exposure }));
vi.mock('../telegram/buyApproval.js', () => ({ requestBuyApproval: mocks.approval }));
vi.mock('../telegram/shadowApprovalDedupeStore.js', () => ({ deriveShadowApprovalContext: () => ({ tradeDate: '2026-09-14', marketSession: 'REGULAR' }) }));
vi.mock('./regime/canonicalRegimeAccess.js', () => ({ resolveCanonicalRegimeLevel: mocks.regime }));
import { trancheExecutor } from './trancheExecutor.js';

function plan(id = 'tr2-test', stockCode = '005930', quantity = 10) {
  return { id, parentTradeId: `parent-${stockCode}`, stockCode, stockName: '시험종목', trancheNumber: 2,
    scheduledDate: '2000-01-01', quantity, entryPrice: 9500, stopLoss: 9000, targetPrice: 13000, status: 'PENDING' };
}
function installPlans(plans = [plan()]) {
  mocks.saved = JSON.stringify(plans);
  mocks.trades = plans.map((item) => ({ id: item.parentTradeId, stockCode: item.stockCode,
    status: 'ACTIVE', quantity: 1, mode: 'LIVE', entryRegime: 'R1_TURBO' }));
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('KIS_APP_KEY', 'test_key');
  vi.stubEnv('AUTO_TRADE_ENABLED', 'true');
  vi.stubEnv('AUTO_TRADE_ASSETS', '1000000');
  mocks.balance.mockResolvedValue(25000);
  mocks.price.mockResolvedValue(10000);
  mocks.approval.mockResolvedValue('APPROVE');
  mocks.mode.mockReturnValue('LIVE');
  installPlans();
});
afterEach(() => vi.unstubAllEnvs());

describe('pending tranche budget integration', () => {
  it('caps the approved quantity to actual cash while preserving stop, target and order identity', async () => {
    await trancheExecutor.checkPendingTranches();
    expect(mocks.regime).not.toHaveBeenCalled();
    expect(mocks.approval).toHaveBeenCalledWith(expect.objectContaining({ quantity: 10, stopLoss: 9000, targetPrice: 13000 }));
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ quantity: 2, orderIntentId: 'tr2-test', correlationId: 'parent-005930' }));
    expect(JSON.parse(mocks.saved)[0]).toMatchObject({ quantity: 2, stopLoss: 9000, targetPrice: 13000, status: 'EXECUTED' });
    expect(mocks.addOrder).toHaveBeenCalledWith(expect.objectContaining({ quantity: 2 }));
  });
  it('does not enlarge an existing planned quantity when cash is ample', async () => {
    mocks.balance.mockResolvedValue(1000000);
    installPlans([plan('tr2-test', '005930', 3)]);
    await trancheExecutor.checkPendingTranches();
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ quantity: 3 }));
  });
  it('keeps an unverified LIVE balance pending without asking for approval or ordering', async () => {
    mocks.balance.mockResolvedValue(null);
    await trancheExecutor.checkPendingTranches();
    expect(mocks.approval).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(JSON.parse(mocks.saved)[0]).toMatchObject({ quantity: 10, status: 'PENDING' });
  });
  it('does not reuse the same cash across two pending plans', async () => {
    installPlans([plan(), plan('tr2-second', '000660')]);
    await trancheExecutor.checkPendingTranches();
    expect(mocks.submit).toHaveBeenCalledOnce();
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ quantity: 2 }));
    expect(JSON.parse(mocks.saved)[1]).toMatchObject({ status: 'CANCELLED' });
  });
  it('includes existing stock holdings in the user position limit', async () => {
    mocks.balance.mockResolvedValue(1000000);
    mocks.trades[0]!.quantity = 14;
    await trancheExecutor.checkPendingTranches();
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ quantity: 1 }));
  });
  it.each(['LIVE', 'SHADOW', 'PAPER'])('does not charge another execution mode against the %s stock limit', async (mode) => {
    mocks.mode.mockReturnValue(mode);
    const isLive = mode === 'LIVE';
    mocks.trades[0]!.mode = isLive ? 'LIVE' : 'SHADOW';
    mocks.trades.push({ id: 'other-mode', stockCode: '005930', status: 'ACTIVE', quantity: 100,
      mode: isLive ? 'SHADOW' : 'LIVE' });
    await trancheExecutor.checkPendingTranches();
    expect(JSON.parse(mocks.saved)[0]).toMatchObject({ status: 'EXECUTED', quantity: 2 });
    const accountTrades = [mocks.trades[0]!];
    expect(mocks.exposure).toHaveBeenCalledWith(1000000, 25000, accountTrades);
    if (isLive) {
      expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ quantity: 2 }));
      expect(mocks.shadowAccount).not.toHaveBeenCalled();
    } else {
      expect(mocks.submit).not.toHaveBeenCalled();
      expect(mocks.shadowAccount).toHaveBeenCalledWith(accountTrades, 1000000);
    }
  });
  it('preserves user rejection and never submits the order', async () => {
    mocks.approval.mockResolvedValue('REJECT');
    await trancheExecutor.checkPendingTranches();
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(JSON.parse(mocks.saved)[0]).toMatchObject({ status: 'CANCELLED', cancelReason: '사용자 REJECT' });
  });
  it('preserves the stop-loss and add-buy-block plan checks', async () => {
    mocks.price.mockResolvedValue(8900);
    await trancheExecutor.checkPendingTranches();
    expect(mocks.approval).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(JSON.parse(mocks.saved)[0]).toMatchObject({ status: 'CANCELLED', cancelReason: '1차 포지션 손절선 하회' });
  });
  it('never turns a Shadow pending plan into a real order', async () => {
    mocks.mode.mockReturnValue('SHADOW');
    await trancheExecutor.checkPendingTranches();
    expect(mocks.balance).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.approval).toHaveBeenCalledWith(expect.objectContaining({ mode: 'SHADOW' }));
  });
});
